/**
 * Everything both Codeforces platforms read from Codeforces.
 *
 * `CodeforcesSources` holds the key pair, signs each call (SHA-512 over
 * `rand/method?sortedParams#secret`) and reads the routes both platforms use.
 * `OfficialSources` adds the routes an official round reads — all JSON, one of
 * them deliberately unsigned — and `GymSources` the routes a gym reads,
 * including the one page a hidden-standings gym still has to scrape. So a
 * signing fix lands in one place, and `tests/platforms/codeforces/sources.test.js`
 * pins the string that is hashed.
 *
 * One instance per key pair, not one per platform: `buildSession` builds it
 * from settings, and Settings builds a second to check credentials you have
 * typed but not saved. Both share the signed client, so neither gets a fresh
 * allowance.
 */
import { Source } from "../source.js";
import { createSiteClient } from "../../services/site-client.js";
import { withTtlCache } from "../../services/ttl-cache.js";
import { codeforcesGyms } from "./descriptor.js";
import { ProblemsPage } from "./scrapers/problems-page.js";

/**
 * The one client for every signed call, on both platforms.
 *
 * Through `services/site-client.js` like every other platform, with two
 * deliberate parameters: a direct `fetchImpl`, since the API works anonymously
 * and is never challenged, so routing it through a tab would add a dependency
 * it does not need; and `refusal: () => null`, since this API does not refuse
 * at the transport — a bad key comes back as a 200 with `status: "FAILED"`,
 * which `_callMethod` reads.
 *
 * `budget` rather than a bare pacer: two platforms each honouring a 2 s gap
 * would serve one request per second to codeforces.com. Naming a shared budget
 * makes every client on this host queue as one.
 */
const ORIGIN = "https://codeforces.com";

/** The API publishes a rate limit; two seconds keeps every add inside it. */
const GAP_MS = 2000;

const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: GAP_MS, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

export class CodeforcesSources extends Source {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: ORIGIN });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = `${ORIGIN}/api/`;
  }

  /** The whole account's submissions, in one call. */
  async userStatus(handle) {
    return this._callMethod("user.status", { handle, from: 1, count: 1000 });
  }

  /** @param {string[]} handles */
  async usersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

  /**
   * Test seam for the shared client. Takes a spacing because proving the API
   * is paced needs an observable gap.
   */
  static reset(spacingMs = 0) {
    signed.reset(spacingMs);
  }

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
  static applyStandingsProblemData(standings, problems) {
    const apiProblems = standings?.problems;
    if (!apiProblems?.length) return false;

    const byIndex = new Map(
      apiProblems.map((problem) => [problem.index, problem]),
    );
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
  static populateSolveCounts(standings, problems) {
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

  /** Signs and issues one API call; a FAILED status becomes the comment Codeforces gave. */
  async _callMethod(methodName, params) {
    const time = Math.floor(Date.now() / 1000);
    const rand = Math.floor(100000 + Math.random() * 900000).toString();

    const authParams = { ...params, apiKey: this.apiKey, time };
    const queryString = Object.keys(authParams)
      .sort()
      .map((key) => `${key}=${authParams[key]}`)
      .join("&");

    // rand/methodName?sortedParams#secret — the secret signs the request and
    // never travels with it.
    const hashHex = await this._sha512(`${rand}/${methodName}?${queryString}#${this.apiSecret}`);
    const apiSig = `${rand}${hashHex}`;

    const finalUrl = `${this.baseUrl}${methodName}?${queryString}&apiSig=${apiSig}`;

    try {
      const data = await this.json(finalUrl);
      if (data.status !== "OK") {
        throw new Error(data.comment || "Codeforces API Error");
      }
      return data.result;
    } catch (error) {
      console.error(`CF API ${methodName} failed:`, error);
      throw error;
    }
  }

  async _sha512(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

// ---------------------------------------------------------------------------
// Official rounds
// ---------------------------------------------------------------------------

/**
 * problemset.problems is ~2 MB and an add reads it twice: once to ask whether
 * Codeforces has published the contest, once to apply the ratings it carries.
 * Short-lived on purpose — it is a publication check, and a stale "not
 * published" would strand a contest for the length of the window.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

export class OfficialSources extends CodeforcesSources {
  // One slot, not one per instance: the problemset is the same ~2 MB response
  // whoever asks, and Settings builds a second instance to check typed
  // credentials. Not `this.memo`, which is per-instance for that reason.
  static #problemset = withTtlCache(
    (_key, sources) => sources._callMethod("problemset.problems", {}),
    { ttlMs: PROBLEMSET_TTL_MS },
  );

  async contestRatingChanges(contestId) {
    return this._callMethod("contest.ratingChanges", { contestId });
  }

  /**
   * Standings for an **official** contest, fetched without signing.
   *
   * Codeforces answers a non-gym `contest.standings` only for *"anonymous GET
   * requests with no extra parameters"* — and `apiKey` and `time`, which
   * `_callMethod` always appends, are extra parameters. A signed request is
   * refused with that exact complaint whatever the key. The same rule forbids
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
    const url = `${this.baseUrl}contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const data = await this.json(url);

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /** Contest metadata in bulk, ~400 KB. Official rounds only. */
  async contestList() {
    return this._callMethod("contest.list", {});
  }

  /** The entire public problemset, ~2 MB, memoised for a minute. */
  async problemsetProblems() {
    return OfficialSources.#problemset("", this);
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    OfficialSources.#problemset.clear();
  }

  /** Test seam: the problemset memo and the shared client. */
  static reset(spacingMs = 0) {
    OfficialSources.#problemset.clear();
    CodeforcesSources.reset(spacingMs);
  }
}

// ---------------------------------------------------------------------------
// Gyms
// ---------------------------------------------------------------------------

/**
 * The second client, for the one page this platform still reads.
 *
 * Separate from `signed` because it is a different site surface with different
 * rules: it needs the session cookie and the page transport, Cloudflare
 * challenges it, and its throttling is tuned against the live HTML rather than
 * the API's published limit.
 *
 * **Do not shorten these delays when optimising.** `measureFrom: "end"` is
 * load-bearing for the same reason: it waits the full gap after each request
 * finishes rather than letting a slow page count towards the next gap.
 * `tests/request-pacer.test.js` fails if that is collapsed.
 */
/** Tuned against the live site; do not shorten when optimising. */
const PAGE_GAP_MS = [1000, 2500];
const COOLDOWN = { everyNth: 15, gapMs: [6000, 12000] };

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const html = createSiteClient({
  // Routed through a Codeforces tab when one is open, so the request carries the
  // session and Cloudflare sees the user rather than a stranger. Falls back to a
  // direct fetch otherwise, which still reads anything public.
  site: codeforcesGyms,
  pacer: {
    gapMs: PAGE_GAP_MS,
    measureFrom: "end",
    cooldown: COOLDOWN,
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[Codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[Codeforces] Request ${count}: waiting ${seconds}s`);
      }
    },
  },

  /**
   * Cloudflare answers a challenge two ways, and both must be caught: a 403
   * with no useful body, or a 200 whose body is the interstitial. Measured
   * live — `cf-mitigated: challenge`, a page of scripts pointing at
   * challenges.cloudflare.com — so this is not a heuristic.
   *
   * Flagged rather than thrown bare. `contest-status.js` defines
   * `sourceUnreachable` as exactly this ("we failed to ask — network, 403,
   * anything"), but until the flag existed nothing converted the throw into
   * that status, so a challenge failed the add outright and was never retried.
   */
  refusal({ response, body }) {
    if (response.status !== 403 && !body.includes("Just a moment")) return null;
    return Object.assign(new Error(BLOCKED), { isSourceUnreachable: true });
  },
});

export class GymSources extends CodeforcesSources {
  /**
   * The one page this platform reads, through the HTML client above. A method,
   * so a test injects a page the same way it injects an API answer: by
   * assigning over the instance.
   */
  page(url) {
    return html.getDocument(url);
  }

  /** Standings for a gym, signed. */
  async contestStandings(contestId) {
    try {
      return await this._callMethod("contest.standings", {
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
    return this._callMethod("contest.status", { contestId, from, count });
  }

  /**
   * Contest metadata in bulk, for gyms. Private gyms and mashups (the 6xxxxx
   * ids) are absent from this list; those are dated from
   * `standings.contest.startTimeSeconds` at add time instead.
   */
  async contestList() {
    return this._callMethod("contest.list", { gym: true });
  }

  /**
   * Every submission to a contest, paged.
   *
   * @param {GymSources} sources
   * @param {string|number} contestId
   * @returns {Promise<object[]>}
   */
  async contestSubmissions(contestId) {
    const submissions = [];
    let from = 1;

    while (true) {
      const page = await this.contestStatus(contestId, {
        from,
        count: PAGE_SIZE,
      });
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
  static summariseSubmissions(submissions) {
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
          startTimes.set(
            author.startTimeSeconds,
            (startTimes.get(author.startTimeSeconds) ?? 0) + 1,
          );
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
   * A contest's own problems page, scraped: the contest name, whether it has
   * finished, and the definitive problem list — **including problems nobody
   * submitted to**, which is why the list cannot be derived from submissions.
   *
   * @returns {Promise<{contestName: string|null, problems: object[], finished: boolean|null}|null>}
   *   null when the page is not the shape the scraper knows.
   */
  async problemsPage(contestId) {
    const path = `/gym/${contestId}`;
    return ProblemsPage.scrape(await this.page(`https://codeforces.com${path}`), { contestPath: path });
  }

  /** Test seam: both clients, since a gym add may touch either. */
  static reset(spacingMs = 0) {
    html.reset(spacingMs);
    CodeforcesSources.reset(spacingMs);
  }
}

const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

const PAGE_SIZE = 10000;

const MAX_SUBMISSIONS = 50000;


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
