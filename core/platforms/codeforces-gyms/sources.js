/**
 * Everything this platform reads from Codeforces — the client and its endpoints.
 *
 * Three endpoints, in the order a gym add reaches them:
 *
 *   contest.standings   the roster, ratings, tags, times, solve counts
 *   contest.status      the same, rebuilt from submissions, when standings are hidden
 *   /gym/<id>           the definitive problem list, likewise
 *
 * Only the last reads markup, and even it just fetches the page and hands it to
 * `scrapers/problems-page.js`.
 *
 * ## Two copies of this file, deliberately
 *
 * `codeforces-official/` and `codeforces-gyms/` are separate platforms with no
 * shared folder between them, so each carries its own client — trimmed to the
 * endpoints it actually calls.
 *
 * What they genuinely share is `_callMethod` and its SHA-512 signing, and that
 * is the one duplication with a real failure mode: a fix applied to one file
 * only. `tests/module-boundaries.test.js` pins those two methods against each
 * other, and `tests/codeforces-api.test.js` pins the string they hash.
 *
 * `Source` supplies the plumbing — path joining, `json`/`document`, the memo and
 * the reset seam. What is left here is which endpoints exist and what an
 * unusable answer means for each.
 */
import { Source } from "../source.js";
import { codeforcesGyms } from "./descriptor.js";
import { createSiteClient } from "../../services/site-client.js";
import { ProblemsPage } from "./scrapers/problems-page.js";


/**
 * One client for both Codeforces platforms' signed calls.
 *
 * It goes through `services/site-client.js` like every other platform, but with
 * two deliberate parameters:
 *
 *   - **a direct `fetchImpl`, not the page transport.** The signed API works
 *     anonymously and is never challenged, so routing it through a tab would add
 *     a dependency it does not need.
 *   - **`refusal: () => null`.** This API does not refuse at the transport — a
 *     bad key comes back as a 200 with `status: "FAILED"`, which `_callMethod`
 *     reads. Saying so here is what lets the transport stay shared.
 *
 * `budget` rather than a bare pacer, because Codeforces is two platforms — each
 * with its own copy of this. Two clients each honouring a 2 s gap would serve one
 * request per second to codeforces.com; a shared budget makes them queue as one.
 * Settings builds a second instance through `createSessionFrom` to check
 * credentials you have typed but not saved, which must not get a fresh allowance.
 */
const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: 2000, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

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
const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const html = createSiteClient({
  // Routed through a Codeforces tab when one is open, so the request carries the
  // session and Cloudflare sees the user rather than a stranger. Falls back to a
  // direct fetch otherwise, which still reads anything public.
  site: codeforcesGyms,
  pacer: {
    gapMs: [1000, 2500],
    measureFrom: "end",
    cooldown: { everyNth: 15, gapMs: [6000, 12000] },
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[codeforces] Request ${count}: waiting ${seconds}s`);
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

/** Kept as an object so tests can stub the one page read. */
export const CodeforcesHttp = {
  /** @returns {Promise<Document>} the parsed page, ready for `scrapers/` */
  getDocument: (url, options = {}) => html.getDocument(url, options),
};

export class CodeforcesService extends Source {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: "https://codeforces.com" });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = "https://codeforces.com/api/";
  }

  /**
   * Fetches the user.status (submissions) for a specific handle.
   * @param {string} handle - The CF user handle
   */
  async getUserStatus(handle) {
    const params = {
      handle: handle,
      from: 1,
      count: 1000, // You can adjust this as needed
    };

    return this._callMethod("user.status", params);
  }

  /**
   * Fetches standings for a contest to extract contestant handles.
   * @param {string|number} contestId
   */
  async getContestStandings(contestId) {
    try {
      return await this._callMethod("contest.standings", {
        contestId: contestId,
        showUnofficial: true,
        participantTypes: "CONTESTANT,VIRTUAL",
      });
    } catch (error) {
      // **The one place a message match is unavoidable**, and it is converted to
      // a flag here so that nothing downstream ever matches on prose. A setter
      // who hides a gym's standings gets this exact comment and no distinct
      // status code, so Codeforces' wording is the only signal there is.
      //
      // `solve-stats.js` reads the flag to rebuild the contest from
      // `contest.status` instead. That used to be triggered by the standings
      // *page* failing to parse, which meant such a gym fetched and parsed
      // HTML purely to discover the fetch was pointless.
      if (/standings are not available/i.test(error.message)) {
        error.isStandingsHidden = true;
      }
      throw error;
    }
  }

  /**
   * Fetches submissions for a contest.
   *
   * This is the only window into a gym whose standings Codeforces has hidden:
   * contest.standings answers FAILED for those, but contest.status still
   * answers. See contest-submissions.js.
   *
   * @param {string|number} contestId
   * @param {{from?: number, count?: number}} [page]
   */
  async getContestStatus(contestId, { from = 1, count = 10000 } = {}) {
    return this._callMethod("contest.status", {
      contestId: contestId,
      from: from,
      count: count,
    });
  }

  /**
   * Contest metadata (including startTimeSeconds) in bulk, for gyms.
   *
   * Note private gyms and mashups (the 6xxxxx ids) are absent from this list
   * entirely; those are dated from `standings.contest.startTimeSeconds` at add
   * time instead.
   */
  async getContestList() {
    return this._callMethod("contest.list", { gym: true });
  }

  /**
   * Fetches user info for an array of handles.
   * @param {string[]} handles
   */
  async getUsersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

  /**
   * Private helper to handle signing and fetching
   */
  async _callMethod(methodName, params) {
    const time = Math.floor(Date.now() / 1000);
    const rand = Math.floor(100000 + Math.random() * 900000).toString();

    // 1. Add authentication parameters
    const authParams = {
      ...params,
      apiKey: this.apiKey,
      time: time,
    };

    // 2. Sort parameters alphabetically by key
    const sortedKeys = Object.keys(authParams).sort();
    const queryParts = sortedKeys.map((key) => `${key}=${authParams[key]}`);
    const queryString = queryParts.join("&");

    // 3. Construct the string to hash: rand/methodName?params#secret
    const textToHash = `${rand}/${methodName}?${queryString}#${this.apiSecret}`;

    // 4. Generate SHA-512 Hash
    const hashHex = await this._sha512(textToHash);

    // 5. Build final apiSig: rand + hash
    const apiSig = `${rand}${hashHex}`;

    // 6. Execute Request
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

  /**
   * Native Browser SHA-512 implementation
   */
  async _sha512(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

// -------------------------------------------------------------------------
// What each endpoint answers, and what an unusable answer means
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// contest.standings
// -------------------------------------------------------------------------

/**
 * Fetches a gym's problem metadata and solve counts.
 *
 * **One signed `contest.standings` call carries all of it** — the contest name,
 * the problems in order with their published ratings and tags, the start time,
 * the phase, and rows enough to count in-contest solves.
 *
 * ## This used to scrape the standings page first
 *
 * It fetched and parsed `/gym/<id>/standings` for the roster and the name, then
 * made this call anyway for everything else — and `populateSolveCountsFromApi`
 * *overwrote* the counts the page had just been parsed for. The scrape's only
 * surviving contribution was the contest name and the problem index/name list,
 * both of which are in this response. Verified against real gyms: 100001, 102253
 * and 702859 all return `contest.name` and a `problems[]` where every entry has
 * an index and a name.
 *
 * The recorded reason for scraping was that "a gym's roster has no API source:
 * its standings need signing". Needing a key is not an obstacle when the key is
 * in hand — this call is signed and works. The genuine obstacle applies only to
 * a gym whose standings the setter has hidden, which is the branch below.
 *
 * So a gym add now makes **no HTML request** unless the standings are hidden,
 * and therefore needs no codeforces.com tab: this is the signed JSON API, which
 * is not challenged and goes through the pacer rather than the page transport.
 *
 * @param {string} contestId
 * @param {CodeforcesService} sources
 * @returns {{ contestName: string, problems: object[], tagsSynced: boolean,
 *   startTimeSeconds: number|null, solveCountsRead: boolean,
 *   partyHandles: string[][]|null, finished: boolean|null, standings: object }}
 *   `partyHandles` is null except on the hidden-standings fallback, where it is
 *   the field the estimator would otherwise read from standings.
 */
export async function readSolveStats(contestId, sources) {
  let standings;
  try {
    standings = await sources.getContestStandings(contestId);
  } catch (error) {
    // Opens only where the add would otherwise fail outright: a gym whose
    // standings Codeforces has hidden. Anything else — a network fault, a bad
    // key — rethrows untouched, since routing around one would turn a broken
    // request into a silently shorter contest.
    if (!error.isStandingsHidden) throw error;
    return statsFromContestStatus(contestId, sources, error);
  }

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
      new Error(
        `Codeforces returned no problems for gym ${contestId}, so there is ` +
          `nothing to store.`,
      ),
      { isSourceUnreachable: true },
    );
  }

  populateSolveCountsFromApi(standings, problems);

  // The same response is the only source gyms have for tags *and* for the
  // difficulty Codeforces publishes, so take both while we are here.
  const tagsSynced = applyStandingsProblemData(standings, problems);

  return {
    contestName: standings?.contest?.name ?? `Gym ${contestId}`,
    problems,
    tagsSynced,
    // Matters for private gyms and mashups: those never appear in
    // contest.list, so this is the only place to get a start time for them.
    startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
    // `solveCountsRead: true` unconditionally, which looks like a hole and is
    // deliberate. Counts come from the API rather than a parsed totals row, and
    // `populateSolveCountsFromApi` does bail without deriving any when
    // `standings.rows` is empty — so this can claim counts it never read, and
    // the `!solveCountsRead` guard in estimator.js is unreachable.
    //
    // Empty rows also means an empty field, since field.js gates on the same
    // array: the estimator sets nothing and contest-manager refuses for missing
    // ratings. The add fails either way, and it fails with the *better*
    // sentence — "participants aren't visible" is exactly what happened, where a
    // solve-count message would blame a layout change that did not occur.
    solveCountsRead: true,
    partyHandles: null,
    finished: standings?.contest?.phase
      ? standings.contest.phase === "FINISHED"
      : null,
    // Carried, never stored. `field.js` measures the field from these rows, and
    // this is the response it would otherwise fetch a second time.
    standings,
  };
}

/**
 * Rebuilds a gym whose standings Codeforces has hidden.
 *
 * Both usual sources are gone at once: the standings page has no table and
 * contest.standings answers FAILED. The problems page still renders and is the
 * authority on what the contest contains — deriving the list from submissions
 * instead would silently drop any problem nobody attempted. contest.status
 * supplies everything else.
 *
 * @param {string} contestId
 * @param {CodeforcesService} sources
 * @param {Error} standingsError - what the standings scrape threw, so a
 *   failure here can name the original cause rather than replacing it.
 */
async function statsFromContestStatus(contestId, sources, standingsError) {
  const page = await scrapeProblemsPage(contestId);

  // Never fall back to a submission-derived list: it would look like a
  // shorter contest rather than a failure.
  if (!page) {
    throw new Error(
      `Gym ${contestId} has its standings hidden, and its problems page couldn't be read ` +
        `either, so there's nothing left to build the contest from. ` +
        `(${standingsError.message})`,
    );
  }

  const derived = summariseSubmissions(
    await fetchContestSubmissions(sources, contestId),
  );

  page.problems.forEach((problem) => {
    const meta = derived.problemMeta.get(problem.index);
    problem.officialSolves = derived.solveCounts[problem.index] ?? 0;
    problem.tags = meta?.tags ?? [];

    // Codeforces publishes a difficulty for the problems it recognises here.
    // It is the same quantity the estimator approximates, so prefer it and
    // leave the rest to be estimated from the field below.
    if (meta?.rating != null) {
      problem.rating = meta.rating;
      problem.ratingSource = "official";
    }
  });

  return {
    contestName: page.contestName,
    problems: page.problems,
    // Tags come from the same place they do on a visible gym, so they are as
    // synced as they are ever going to be.
    tagsSynced: derived.problemMeta.size > 0,
    startTimeSeconds: derived.startTimeSeconds,
    // With no official submissions at all, every count is zero — which is
    // indistinguishable from "nobody solved anything". Unlike the visible-gym
    // path above there is still a field here, recovered from the submissions,
    // so the estimator would run rather than stall: zero solves makes it aim
    // for 0.5 expected solves, which lands at the top of its search range
    // (~2400 against a 40-person field, not the 800 floor). Every problem
    // would read as maximally hard and sort to the *front* of the queue.
    solveCountsRead: derived.partyHandles.length > 0,
    partyHandles: derived.partyHandles,
    // No contest.standings to ask here, so it comes off the problems page the
    // list was read from — the sidebar says "Finished" or otherwise.
    finished: page.finished,
  };
}

/**
 * Applies the tags and the difficulty Codeforces attaches to a gym's problems.
 *
 * The rating is on the same objects as the tags, in a response the add already
 * pays for. About a third of gym problems carry one — those are problems the
 * setter picked from the archive rather than preparing themselves, so
 * Codeforces still recognises them and serves its own published number.
 * Preferring it is the same rule official contests already follow: the same
 * quantity, measured rather than inferred.
 *
 * It matters more here than the wording suggests. Measured over the 62 stored
 * gym problems Codeforces also rates, the estimate was a mean 211 off, with 14
 * of them out by 400 or more — not from a bias in the maths, but because a gym
 * field is 5-76 people where the estimator needs thousands.
 *
 * Anything Codeforces does not rate keeps `rating: null` and is estimated as
 * before, which is the other two thirds.
 *
 * @returns {boolean} whether the API answered with problems at all, which is
 *   what `publishedDataCheckedAt` records.
 */
function applyStandingsProblemData(standings, problems) {
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

function populateSolveCountsFromApi(standings, problems) {
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

// -------------------------------------------------------------------------
// contest.status — for gyms whose standings are hidden
// -------------------------------------------------------------------------

/**
 * Rebuilding a gym from its submissions, for contests whose standings
 * Codeforces has hidden.
 *
 * A gym can be set to "Standings will not be visible as original contest".
 * When it is, both halves of the usual acquisition path are gone at once: the
 * standings page carries no table, and contest.standings answers FAILED with
 * "Standings are not available". contest.status still answers, and it carries
 * everything the standings response was being mined for — problem metadata,
 * who competed, and what they solved.
 *
 * The derivation is pure so it can be tested against a captured contest
 * without a network stack, the way applySolvedStatus is. See
 * tests/contest-status.test.js, which pins it to a real hidden-standings gym.
 */

/** Matches getContestStandings' participantTypes, so both gym paths agree. */
const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

/** contest.status pages; 10k is accepted in one request. */
const PAGE_SIZE = 10000;

/**
 * Refuse rather than walk an unbounded contest. A submission is ~400 bytes of
 * JSON, so this is already a larger response than the ~12MB standings the
 * scraper pays for on a big Div. 3.
 */
const MAX_SUBMISSIONS = 50000;

/**
 * Every submission to a contest, paged.
 *
 * @param {CodeforcesService} sources
 * @param {string|number} contestId
 * @returns {Promise<object[]>}
 */
export async function fetchContestSubmissions(sources, contestId) {
  const submissions = [];
  let from = 1;

  while (true) {
    const page = await sources.getContestStatus(contestId, {
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

// -------------------------------------------------------------------------
// /gym/<id> — the one page this extension still reads
// -------------------------------------------------------------------------

/**
 * The last HTML the extension reads on Codeforces, and only for one case.
 *
 * A gym whose standings the setter hid answers `FAILED` to `contest.standings`,
 * so the roster has to come from somewhere — and the `/gym/<id>` problems page
 * is the one page those contests still render. Every other Codeforces path,
 * official and gym alike, is now pure JSON API.
 *
 * `scrapeContestProblems` used to live here and read a visible gym's standings
 * page for its roster, name and solve counts. It was redundant: the very next
 * call fetched `contest.standings`, which carries all three, and
 * `populateSolveCountsFromApi` overwrote the counts the page had just been
 * parsed for.
 */


/**
 * Problem metadata from a contest's own problems page.
 *
 * The page carries no solve counts and no field, so the caller sources those
 * from `contest.status` instead; what it does carry is the definitive problem
 * list, **including problems nobody submitted to** — which is why the list
 * cannot be derived from the submissions themselves.
 *
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[] }|null}
 *   null when the page can't be parsed, so the caller can refuse loudly.
 */
export async function scrapeProblemsPage(contestId) {
  const path = `/gym/${contestId}`;
  const doc = await CodeforcesHttp.getDocument(`https://codeforces.com${path}`);

  const page = ProblemsPage.scrape(doc, { contestPath: path });
  if (!page) return null;

  // Which selector finds the name is the scraper's business and now lives
  // there. What is left here is a *display* fallback and the stored shape,
  // neither of which is a fact about the page — a scraper that invented
  // "Contest 712373" would be doing the thing this folder forbids.
  return {
    contestName: page.contestName ?? `Contest ${contestId}`,
    problems: page.problems.map(blankProblem),
    finished: page.finished,
  };
}

/** The stored shape, before anything is known about difficulty or solves. */
function blankProblem(problem) {
  return {
    ...problem,
    rating: null,
    ratingSource: null,
    officialSolves: 0,
    solved: false,
    tags: [],
  };
}

/**
 * Test seam. Takes a spacing because proving the signed API is paced needs an
 * observable gap, and it was paced by nothing at all until recently.
 */
export function resetApiState(spacingMs = 0) {
  signed.reset(spacingMs);
}

/**
 * Test seam for the HTML half. Separate because the two clients are separately
 * paced, and a test proving one is throttled must not have the other's gap
 * standing in for it.
 */
export function resetHttpState(spacingMs = 0) {
  html.reset(spacingMs);
}
