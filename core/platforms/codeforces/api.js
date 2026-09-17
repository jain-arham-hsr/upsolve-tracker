/**
 * Codeforces' JSON: every route, the signing, and the reading of the payloads.
 *
 * One class serves both platforms. The routes an official round needs are all
 * JSON and one is deliberately unsigned; the routes a gym needs are signed;
 * and what the account needs — `identity`, `accepted`, `fromSettings` — is
 * what the platforms' defaults call. What a payload means is the pure half at
 * the bottom of this file: a `contest.standings` or `contest.status` response
 * in, problems or a summary out, testable against a fixture with no network.
 *
 * One instance per key pair, not one per platform: `buildSession` builds it
 * from settings, and Settings builds a second to check credentials you have
 * typed but not saved. Both share the signed client, so neither gets a fresh
 * allowance.
 *
 * The field both platforms' estimates fit against is read here too — its shape,
 * the three ways of reading it, and the team collapse every reading ends in —
 * because one file reading every Codeforces field is what stops the two
 * platforms from each keeping a copy. `rating-models/` holds only the
 * statistical models; what a Codeforces field *is* belongs to Codeforces.
 */
import { Api } from "../api.js";
import { withTtlCache } from "../../services/ttl-cache.js";
import { createSiteClient } from "../../services/site-client.js";

const ORIGIN = "https://codeforces.com";

/** The API publishes a rate limit; two seconds keeps every add inside it. */
const GAP_MS = 2000;

/**
 * problemset.problems is ~2 MB and an add reads it twice: once to ask whether
 * Codeforces has published the contest, once to apply the ratings it carries.
 * Short-lived on purpose — it is a publication check, and a stale "not
 * published" would strand a contest for the length of the window.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

const USERS_PER_CALL = 250;

/** `contest.status` page size, and how many submissions a gym may have before rebuilding it is refused. */
const PAGE_SIZE = 10000;
const MAX_SUBMISSIONS = 50000;

/**
 * The one client for every signed call, on both platforms.
 *
 * Through `services/site-client.js` like every other client, with two
 * deliberate parameters: a direct `fetchImpl`, since the API works anonymously
 * and is never challenged, so routing it through a tab would add a dependency
 * it does not need; and `refusal: () => null`, since this API does not refuse
 * at the transport — a bad key comes back as a 200 with `status: "FAILED"`,
 * which `#call` reads.
 *
 * `budget` rather than a bare pacer: two platforms each honouring a 2 s gap
 * would serve one request per second to codeforces.com. Naming a shared budget
 * makes every instance queue as one. The page client in `scraper.js` is a
 * different surface on a different pace, and deliberately not in it.
 */
const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: GAP_MS, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

export class CodeforcesApi extends Api {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: ORIGIN });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * The instance a session carries, from a key pair.
   *
   * @throws when the extension has not been configured yet.
   */
  static fromSettings(values) {
    if (!values.api_key || !values.api_secret) {
      throw new Error(
        "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
      );
    }
    return new CodeforcesApi(values.api_key, values.api_secret);
  }

  /** Test seam: the signed client and the problemset memo. */
  static reset(spacingMs = 0) {
    CodeforcesApi.#problemset.clear();
    signed.reset(spacingMs);
  }

  /** Issues one signed API call; a FAILED status becomes the comment Codeforces gave. */
  async #call(methodName, params) {
    try {
      const data = await this.json(await signedUrl(this, methodName, params));
      if (data.status !== "OK") {
        throw new Error(data.comment || "Codeforces API Error");
      }
      return data.result;
    } catch (error) {
      console.error(`CF API ${methodName} failed:`, error);
      throw error;
    }
  }

  // ── the account ───────────────────────────────────────────────────────

  /** The whole account's submissions, in one call. */
  async userStatus(handle) {
    return this.#call("user.status", { handle, from: 1, count: 1000 });
  }

  /** @param {string[]} handles */
  async usersInfo(handles) {
    return this.#call("user.info", { handles: handles.join(";") });
  }

  /**
   * What `user.info` says about a handle: its canonical casing and rating, or
   * null when Codeforces does not know it. Codeforces has no "who am I"
   * endpoint, so this verifies that the handle exists, not that it is yours.
   */
  async identity(handle) {
    const users = await this.usersInfo([handle]);
    const user = users?.[0];
    if (!user?.handle) return null;
    return {
      // Codeforces' own casing, so "Tourist" over "tourist" is not a new account.
      username: user.handle,
      rating: typeof user.rating === "number" ? user.rating : null,
    };
  }

  /** The accepted pairs in the whole account's `user.status`, in one call. */
  async accepted(handle) {
    const submissions = await this.userStatus(handle);
    return submissions
      .filter((submission) => submission.verdict === "OK")
      .map((submission) => ({
        contest: { id: submission.problem.contestId },
        problem: { index: submission.problem.index },
      }));
  }

  /**
   * Contest metadata in bulk, ~400 KB. Official rounds by default; gyms are a
   * separate list, and private gyms and mashups are absent from it entirely —
   * those are dated from `standings.contest.startTimeSeconds` at add time
   * instead.
   */
  async contestList({ gym = false } = {}) {
    return this.#call("contest.list", gym ? { gym: true } : {});
  }

  // ── official rounds ───────────────────────────────────────────────────

  // One slot, not one per instance: the problemset is the same ~2 MB response
  // whoever asks, and Settings builds a second instance to check typed
  // credentials. Not `this.memo`, which is per-instance for that reason.
  static #problemset = withTtlCache(
    (_key, api) => api.#call("problemset.problems", {}),
    { ttlMs: PROBLEMSET_TTL_MS },
  );

  /** The entire public problemset, ~2 MB, memoised for a minute. */
  async problemsetProblems() {
    return CodeforcesApi.#problemset("", this);
  }

  async contestRatingChanges(contestId) {
    return this.#call("contest.ratingChanges", { contestId });
  }

  /**
   * Standings for an **official** contest, fetched without signing.
   *
   * Codeforces answers a non-gym `contest.standings` only for *"anonymous GET
   * requests with no extra parameters"* — and `apiKey` and `time`, which
   * `#call` always appends, are extra parameters. A signed request is refused
   * with that exact complaint whatever the key. The same rule forbids
   * trimming the response: `count`, `from`, `handles`, `showUnofficial` and
   * `participantTypes` are all rejected. A Div. 2 round is ~8.5 MB for seven
   * problem objects; read what is needed and drop the reference.
   *
   * Worth the bytes because `problemset.problems` lists each problem once,
   * under the contest it originated in — a Div. 1 / Div. 2 pair's shared
   * problems are filed under Div. 1 only — while this reports them under
   * *this* contest's indices with the published rating attached. Nothing else
   * exposes the pairing: not the API, not the HTML, and matching on start
   * time or problem name is unsound.
   */
  async publicContestStandings(contestId) {
    const data = await this.json(`/api/contest.standings?contestId=${encodeURIComponent(contestId)}`);

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  // ── the field ─────────────────────────────────────────────────────────

  /**
   * The official field: pre-contest ratings for everyone who entered.
   * `contest.ratingChanges` carries the whole field's `oldRating` in one
   * request; when a round is not rated yet — the freshly finished contest you
   * most want to upsolve — the standings rows the add already holds are
   * stratified and resolved through `user.info`.
   *
   * @param {object} standings - the `contest.standings` response the add
   *   fetched for the roster, so the field is measured from rows already in
   *   memory rather than a second ~8.5 MB request.
   * @returns {Promise<{strata: Array<{ratings: number[], scale: number}>}>}
   *   empty when there was nothing to measure.
   */
  async officialField(contestId, standings, onProgress = () => {}) {
    try {
      const ratingChanges = await this.contestRatingChanges(contestId);
      if (ratingChanges?.length > 0) {
        return fullField(ratingChanges.map((user) => user.oldRating));
      }
    } catch (error) {
      console.warn(`[Codeforces] ratingChanges failed for ${contestId}:`, error.message);
    }

    console.warn(`[Codeforces] ratingChanges empty for ${contestId}. Falling back to standings.`);
    return this.#sampledField(standings, onProgress);
  }

  async #sampledField(standings, onProgress) {
    try {
      const { groups, total } = stratifyRows(standings?.rows);
      if (groups.length === 0) {
        console.warn("[Codeforces] Standings carried no rows to sample.");
        return fullField([]);
      }

      onProgress("Looking up competitor ratings…");

      // One lookup pass over every sampled party, then split back into strata,
      // so the rate-limited `user.info` chunking does not happen twice.
      const rated = await this.partyRatings(groups.flatMap((group) => group.parties));

      let offset = 0;
      const strata = [];
      for (const group of groups) {
        const ratings = rated.slice(offset, offset + group.parties.length);
        offset += group.parties.length;
        if (ratings.length > 0) strata.push({ ratings, scale: group.scale });
      }

      console.log(
        `[Codeforces] Rated ${rated.length} of ~${total} participants across ${strata.length} stratum/strata.`,
      );

      return strata.length > 0 ? { strata } : fullField([]);
    } catch (error) {
      console.warn(`[Codeforces] Standings sampling failed:`, error.message);
      return fullField([]);
    }
  }

  // ── gyms ──────────────────────────────────────────────────────────────

  /** Standings for a gym, signed. */
  async contestStandings(contestId) {
    try {
      return await this.#call("contest.standings", {
        contestId,
        showUnofficial: true,
        participantTypes: "CONTESTANT,VIRTUAL",
      });
    } catch (error) {
      // The one place a message match is unavoidable, converted to a flag here
      // so nothing downstream matches on prose: a setter who hides a gym's
      // standings gets this exact comment and no distinct status code.
      if (/standings are not available/i.test(error.message)) {
        error.isStandingsHidden = true;
      }
      throw error;
    }
  }

  /**
   * Submissions for a contest — the only window into a gym whose standings
   * Codeforces has hidden. `contest.standings` answers FAILED for those;
   * `contest.status` still answers.
   */
  async contestStatus(contestId, { from = 1, count = 10000 } = {}) {
    return this.#call("contest.status", { contestId, from, count });
  }

  /**
   * Every submission to a contest, paged.
   *
   * @param {string|number} contestId
   * @returns {Promise<object[]>}
   */
  async contestSubmissions(contestId) {
    const submissions = [];
    let from = 1;

    while (true) {
      const page = await this.contestStatus(contestId, { from, count: PAGE_SIZE });
      if (!page?.length) break;

      submissions.push(...page);
      if (page.length < PAGE_SIZE) break;

      from += PAGE_SIZE;

      // Truncating silently would understate every solve count, and an
      // understated count reads as a harder problem rather than as a failure.
      if (submissions.length >= MAX_SUBMISSIONS) {
        throw new Error(
          `Gym ${contestId} has more than ${MAX_SUBMISSIONS} submissions, which is too many to ` +
            `rebuild its standings from.`,
        );
      }
    }

    return submissions;
  }

  /**
   * A gym's field, whole: 5–76 parties in one `contest.standings` response,
   * so there is nothing to sample — and far too few to sample from.
   *
   * @param {object} [prefetched] - the response the add already paid for;
   *   the hidden path has none, and a re-check fetches its own.
   */
  async gymField(contestId, prefetched) {
    try {
      const standings = prefetched ?? (await this.contestStandings(contestId));

      if (!standings?.rows?.length) {
        console.warn(`[Codeforces] Standings API returned empty for ${contestId}.`);
        return fullField([]);
      }

      return fullField(
        await this.partyRatings(standings.rows.map((row) => row.party.members.map((m) => m.handle))),
      );
    } catch (error) {
      console.warn(`[Codeforces] Standings method failed for ${contestId}:`, error.message);
      return fullField([]);
    }
  }

  /**
   * The field of a hidden-standings gym, recovered from who submitted. It is
   * narrower than a standings field — it sees only parties that submitted at
   * least once — but a party that entered and submitted nothing solved
   * nothing either, so the counts stay consistent with it.
   *
   * @param {string[][]} partyHandles - from `summariseSubmissions`
   */
  async partyField(partyHandles) {
    if (!partyHandles?.length) return fullField([]);

    try {
      return fullField(await this.partyRatings(partyHandles));
    } catch (error) {
      console.warn(`[Codeforces] Submission-derived field failed:`, error.message);
      return fullField([]);
    }
  }

  /**
   * Handles to one effective rating per party — what every Codeforces field
   * ends in. Each field decides *which* parties; everything below the handles
   * is one path, so they cannot drift: the same `user.info` chunking, the
   * same team collapsing in `teamRating`.
   *
   * @param {string[][]} parties - member handles, one array per party
   * @returns {Promise<number[]>} one rating per party, in order
   */
  async partyRatings(parties) {
    const allHandles = [...new Set(parties.flat().filter(Boolean))];

    console.log(`[Codeforces] Found ${allHandles.length} unique handles across ${parties.length} parties.`);
    if (allHandles.length === 0) return [];

    const handleToRating = {};
    for (let i = 0; i < allHandles.length; i += USERS_PER_CALL) {
      try {
        const usersInfo = await this.usersInfo(allHandles.slice(i, i + USERS_PER_CALL));
        usersInfo?.forEach((u) => {
          handleToRating[u.handle] = u.rating ?? 800;
        });
      } catch {
        console.warn(`[Codeforces] Chunk ${Math.floor(i / USERS_PER_CALL) + 1} rejected. Skipping.`);
      }
    }

    // An unknown handle counts as 800 rather than dropping out, or a party whose
    // members all failed to resolve would collapse to the search's floor and drag
    // the whole field down with it.
    return parties.map((members) => {
      const ratings = members.map((handle) => handleToRating[handle] ?? 800);
      return teamRating(ratings.length > 0 ? ratings : [800]);
    });
  }
}

// ---------------------------------------------------------------------------
// The field: its shape, and the team collapse every reading of it ends in.
// ---------------------------------------------------------------------------

/**
 * A rating distribution the estimator can work from, as one or more strata.
 *
 * Each stratum's `scale` is how many real competitors one of its members
 * stands for: 1 where the whole group was read, higher where it was sampled.
 * Expected solve counts are weighted by it, so a partially-read field answers
 * as if it had been read whole. `rating-models/rasch.js` consumes the strata
 * flattened to weighted abilities; this says what they are. AtCoder has no
 * strata — a field that is always read whole has nothing to scale up from.
 *
 * @typedef {{ strata: Array<{ratings: number[], scale: number}> }} RatingDistribution
 */

/** Every competitor read, at scale 1 — nothing was sampled. */
export const fullField = (ratings) => ({ strata: [{ ratings, scale: 1 }] });

/** Total competitors represented, sampled or not. */
export function distributionSize(distribution) {
  return (distribution?.strata ?? []).reduce((sum, { ratings }) => sum + ratings.length, 0);
}

/**
 * Collapsing a team into the one rating that behaves like it.
 *
 * An ICPC-style gym is entered by teams, but the model is written in terms of
 * *a* competitor's ability. So a team of three needs a single number standing
 * in for it, and the honest choice is the rating at which a lone competitor
 * would be as likely to fail a problem as the team is:
 *
 *   ∏ 1 / (1 + 10^((rᵢ − R) / 400)) = 0.5
 *
 * Each factor is one member's probability of *not* solving against ability R,
 * under the same logistic the Rasch fit uses; their product is the team's. The
 * left side falls monotonically in R, so a binary search converges. Note this
 * lands **above** the strongest member, which is the point: three 1500s solve
 * more than one 1500 does.
 *
 * `mean` and `max` were both tried as cheaper substitutes and measured worse;
 * `tests/platforms/codeforces/estimator-accuracy.test.js` records the numbers
 * so neither is retried.
 *
 * @param {number[]} memberRatings
 * @returns {number} the effective team rating, rounded.
 */
export function teamRating(memberRatings) {
  if (memberRatings.length === 1) return memberRatings[0];

  let low = -1000;
  let high = 4000;

  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const teamLossProbability = memberRatings.reduce(
      (product, rating) => product * (1 / (1 + Math.pow(10, (rating - mid) / 400))),
      1,
    );
    if (teamLossProbability > 0.5) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return Math.round(high);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * The URL for one signed API call: `apiKey` and `time` appended, the query
 * sorted, and `apiSig` = six random digits + SHA-512 over
 * `rand/method?sortedParams#secret`. The secret signs the request and never
 * travels with it. `tests/platforms/codeforces/api.test.js` pins the string
 * that is hashed, since a wrong signature comes back as an ordinary FAILED.
 */
async function signedUrl({ apiKey, apiSecret }, methodName, params) {
  const time = Math.floor(Date.now() / 1000);
  const rand = Math.floor(100000 + Math.random() * 900000).toString();

  const authParams = { ...params, apiKey, time };
  const queryString = Object.keys(authParams)
    .sort()
    .map((key) => `${key}=${authParams[key]}`)
    .join("&");

  const apiSig = `${rand}${await sha512(`${rand}/${methodName}?${queryString}#${apiSecret}`)}`;
  return `${ORIGIN}/api/${methodName}?${queryString}&apiSig=${apiSig}`;
}

async function sha512(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// What the payloads mean. Pure: a response in, the stored shape out. Nothing
// here fetches, and nothing here decides what to do with the answer.
// ---------------------------------------------------------------------------

/**
 * Applies the tags and the rating Codeforces attaches to a contest's
 * problems, off a `contest.standings` response.
 *
 * On an official round this is the only source that reports a shared
 * Div. 1 / Div. 2 problem's rating under this contest's own index; on a gym
 * about a third of problems carry a rating inherited from the archive.
 *
 * @returns {boolean} whether the API answered with problems at all, which
 *   is what `publishedDataCheckedAt` records.
 */
export function applyStandingsProblemData(standings, problems) {
  const apiProblems = standings?.problems;
  if (!apiProblems?.length) return false;

  const byIndex = new Map(apiProblems.map((problem) => [problem.index, problem]));
  problems.forEach((problem) => {
    const published = byIndex.get(problem.index);
    problem.tags = published?.tags ?? [];

    if (typeof published?.rating === "number") {
      problem.rating = published.rating;
      problem.ratingSource = "official";
    }
  });

  return true;
}

/** In-contest solves per problem, from the rows, ghosts excluded. */
export function populateSolveCounts(standings, problems) {
  if (!standings?.rows?.length) return;

  const validRows = standings.rows.filter((row) => !row.party.ghost);
  const solveCountMap = {};

  validRows.forEach((row) => {
    row.problemResults.forEach((result, i) => {
      const index = problems[i]?.index;
      if (!index) return;
      if (result.bestSubmissionTimeSeconds != null) {
        solveCountMap[index] = (solveCountMap[index] ?? 0) + 1;
      }
    });
  });

  problems.forEach((problem) => {
    problem.officialSolves = solveCountMap[problem.index] ?? 0;
  });
}

/**
 * The problems a `contest.standings` response describes, in the stored
 * shape: blank, then Codeforces' published ratings and tags applied, then
 * in-contest solves counted from the rows.
 *
 * @throws flagged `isSourceUnreachable` when the response names no problems —
 *   there is nothing to store, and an unreachable API is a reason to retry.
 *   That is a fact about the payload, and both platforms would otherwise
 *   repeat it.
 */
export function problemsFrom(contestId, standings) {
  const problems = (standings?.problems ?? []).map((problem) => ({
    index: problem.index,
    name: problem.name,
    rating: null,
    ratingSource: null,
    officialSolves: 0,
    solved: false,
    tags: [],
  }));

  if (problems.length === 0) {
    throw Object.assign(
      new Error(`Codeforces returned no problems for ${contestId}, so there is nothing to store.`),
      { isSourceUnreachable: true },
    );
  }

  applyStandingsProblemData(standings, problems);
  populateSolveCounts(standings, problems);
  return problems;
}

const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

/**
 * Derives everything the add path needs from a contest's submissions.
 *
 * Practice submissions are excluded throughout: they happen after the contest,
 * so counting them would overstate how many people solved a problem under
 * contest conditions, which is exactly the quantity the estimator is fitted
 * to. Ghost parties are excluded for the same reason the standings path
 * excludes them.
 *
 * @param {object[]} submissions - contest.status rows
 * @returns {{
 *   solveCounts: Record<string, number>,
 *   problemMeta: Map<string, {name: string, rating: number|null, tags: string[]}>,
 *   partyHandles: string[][],
 *   startTimeSeconds: number|null,
 * }}
 */
export function summariseSubmissions(submissions) {
  const solvers = new Map(); // problem index -> Set of party id
  const problemMeta = new Map();
  const parties = new Map(); // party id -> string[] of handles
  const startTimes = new Map(); // startTimeSeconds -> party count

  for (const submission of submissions ?? []) {
    const problem = submission?.problem;
    const author = submission?.author;
    if (!problem?.index || !author) continue;

    // Problem metadata is worth taking from any submission, including a
    // practice one: it describes the problem, not the attempt.
    if (!problemMeta.has(problem.index)) {
      problemMeta.set(problem.index, {
        name: problem.name ?? null,
        rating: typeof problem.rating === "number" ? problem.rating : null,
        tags: problem.tags ?? [],
      });
    }

    if (!OFFICIAL_PARTICIPANT_TYPES.has(author.participantType)) continue;
    if (author.ghost) continue;

    const partyId = author.participantId;
    if (partyId == null) continue;

    if (!parties.has(partyId)) {
      parties.set(
        partyId,
        (author.members ?? []).map((member) => member.handle).filter(Boolean),
      );
      if (author.startTimeSeconds != null) {
        startTimes.set(author.startTimeSeconds, (startTimes.get(author.startTimeSeconds) ?? 0) + 1);
      }
    }

    if (submission.verdict !== "OK") continue;

    // A party that solves the same problem twice still solved it once.
    if (!solvers.has(problem.index)) solvers.set(problem.index, new Set());
    solvers.get(problem.index).add(partyId);
  }

  const solveCounts = {};
  for (const [index, partySet] of solvers) solveCounts[index] = partySet.size;

  return {
    solveCounts,
    problemMeta,
    partyHandles: [...parties.values()],
    startTimeSeconds: mostCommon(startTimes),
  };
}

/**
 * Virtual entrants each carry their own start time, so the contest's own is
 * the one the most parties share rather than the first one seen.
 */
function mostCommon(tally) {
  let best = null;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Sampling: which standings rows an official field is measured from.
// ---------------------------------------------------------------------------

/**
 * Characterising an official contest's field without rating all of it.
 *
 * ## Why sample at all, when the whole field is in hand
 *
 * `contest.standings` returns every row, so the *rows* are free. What is not
 * free is turning them into ratings: that costs one `user.info` call per 250
 * handles, each throttled. A Div. 3 with 15,000 entrants is ~60 throttled calls
 * — two minutes — where a sample of ~1,500 is seven.
 *
 * ## Why these strata, and not something simpler
 *
 * Standings are **rank-ordered**, so a contiguous block of rows is a narrow
 * band of near-identical ratings rather than a random slice. Picking blocks at
 * random is cluster sampling with near-total intra-cluster correlation — 20
 * blocks of 50 behaves like 20 draws, not 1,000 — and estimates land 400–800
 * points off. Spreading them evenly fixes the variance but biases estimates
 * *downward*, because a random start offset can skip the very top of the field,
 * and hard problems are decided almost entirely by the strongest few.
 *
 *   HEAD - the strongest competitors, taken in full. Small, but it decides the
 *          hard problems: when three people solve something, the answer rests
 *          entirely on how strong those three were.
 *   TAIL - everyone else, sampled at even intervals down the rank order, which
 *          covers the whole spread instead of clumping.
 *
 * **Do not replace this with a uniform random sample.** It was tried and
 * measured; `tests/platforms/codeforces/estimator.sampling.test.js`
 * reproduces the failure so the rejected design cannot quietly come back.
 *
 * `BLOCK` is 50 because that is what a standings page held when this read
 * paginated HTML, and the accuracy fixtures were captured against those block
 * boundaries. Reading the rows the API already returned removed the page-count
 * guard, the partial-last-page measurement and the walk-every-page fallback,
 * all of which were consequences of pagination rather than of sampling.
 */
const BLOCK = 50;
const HEAD_BLOCKS = 10;
const TAIL_BLOCKS = 20;

/**
 * @param {object[]} rows - `contest.standings`' rows, in rank order.
 * @returns {{ groups: Array<{parties: string[][], scale: number}>, total: number }}
 *   Each group's `scale` is how many real competitors one of its members stands
 *   for. A field small enough to take whole comes back as one group at scale 1.
 */
export function stratifyRows(rows) {
  const parties = (rows ?? []).map((row) =>
    (row?.party?.members ?? []).map((member) => member.handle).filter(Boolean),
  );

  if (parties.length === 0) return { groups: [], total: 0 };

  const blockCount = Math.ceil(parties.length / BLOCK);

  // Small enough that sampling would save nothing worth the loss of precision.
  if (blockCount <= HEAD_BLOCKS + TAIL_BLOCKS) {
    return { groups: [{ parties, scale: 1 }], total: parties.length };
  }

  const head = parties.slice(0, HEAD_BLOCKS * BLOCK);
  const tail = spreadPages(HEAD_BLOCKS + 1, blockCount, TAIL_BLOCKS).flatMap((block) =>
    parties.slice((block - 1) * BLOCK, block * BLOCK),
  );

  return {
    groups: [
      { parties: head, scale: 1 },
      { parties: tail, scale: (parties.length - head.length) / tail.length },
    ],
    total: parties.length,
  };
}

/**
 * Evenly spaced block numbers across [from, to], taken at interval midpoints so
 * the sample doesn't lean toward either end of the range.
 *
 * Still named for pages, and still exported, because
 * `tests/platforms/codeforces/estimator.sampling.test.js` is written against
 * it directly: the accuracy claim this file rests on is only meaningful if the
 * spread is genuinely even.
 */
export function spreadPages(from, to, count) {
  const span = to - from + 1;
  if (span <= count) {
    return Array.from({ length: span }, (_, i) => from + i);
  }

  const step = span / count;
  const pages = new Set();
  for (let i = 0; i < count; i++) {
    pages.add(from + Math.min(span - 1, Math.floor(i * step + step / 2)));
  }
  return [...pages].sort((a, b) => a - b);
}
