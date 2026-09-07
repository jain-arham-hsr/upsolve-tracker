/**
 * Everything this platform reads from Codeforces — the client and its endpoints.
 *
 * An official add is pure signed JSON API, which is why this folder has no
 * `scrapers/`: nothing here reads markup. Endpoints used: `user.status`,
 * `user.info`, `contest.list`, `contest.ratingChanges`, `problemset.problems`,
 * and the deliberately unsigned `contest.standings`.
 *
 * ## Two copies of this file, deliberately
 *
 * `codeforces-official/` and `codeforces-gyms/` are separate platforms with no
 * shared folder between them, so each carries its own client — trimmed to the
 * endpoints it actually calls, which is why neither is the whole of what they
 * were split from.
 *
 * What they genuinely share is `_callMethod` and its SHA-512 signing, and that
 * is the one duplication with a real failure mode: a fix applied to one file
 * only. `tests/module-boundaries.test.js` pins those two methods against each
 * other, and `tests/codeforces-api.test.js` pins the string they hash.
 *
 * `Source` supplies the plumbing — path joining, `json`, the memo and the reset
 * seam. What is left here is which endpoints exist and how they are signed.
 */
import { Source } from "../source.js";
import { createSiteClient } from "../../services/site-client.js";
import { withTtlCache } from "../../services/ttl-cache.js";

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
 * `budget` rather than a bare pacer, because Codeforces is two platforms —
 * official and gyms — each with its own copy of this. Two clients each honouring
 * a 2 s gap would serve one request per second to codeforces.com; naming a
 * shared budget makes them queue as one. Settings builds a second instance
 * through `createSessionFrom` to check credentials you have typed but not saved,
 * and that must not come with a fresh allowance either.
 */
const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: 2000, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

/**
 * problemset.problems is ~2 MB and an add reads it twice: once to ask whether
 * Codeforces has published the contest, once to apply the ratings it carries.
 * Without a cache that doubles the cost of every official add. Short-lived on
 * purpose — it is a publication check, and a stale "not published" would strand
 * a contest for the length of the window.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

export class CodeforcesService extends Source {
  // One slot, not one per instance: the problemset is the same ~2 MB response
  // whoever asks, and Settings builds a second service to check typed
  // credentials. Not `this.memo`, which is per-instance for that reason.
  static #problemset = withTtlCache(
    (_key, service) => service._callMethod("problemset.problems", {}),
    { ttlMs: PROBLEMSET_TTL_MS },
  );

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
   * Fetches rating changes for a specific contest.
   * @param {string|number} contestId
   */
  async getContestRatingChanges(contestId) {
    return this._callMethod("contest.ratingChanges", { contestId: contestId });
  }

  /**
   * Standings for an **official** contest, fetched without signing.
   *
   * ## Why this cannot go through `_callMethod`
   *
   * Codeforces answers a non-gym `contest.standings` only for *"anonymous GET
   * requests with no extra parameters"* — and `apiKey` and `time`, which
   * `_callMethod` always appends, are extra parameters. A signed request is
   * refused with that exact complaint, independently of whether the key is
   * valid. So this is a bare GET on purpose, not an oversight; signing it would
   * break it.
   *
   * The same rule forbids trimming the response: `count`, `from`, `handles`,
   * `showUnofficial` and `participantTypes` are all rejected, verified across
   * five contests. A Div. 2 round is ~8.5 MB, and there is no smaller shape —
   * we want seven problem objects and must accept eleven thousand rows to get
   * them. **Read what is needed and drop the reference**; this must not be
   * retained.
   *
   * ## Why it is worth the bytes
   *
   * `problemset.problems` lists each problem once, under the contest it
   * originated in. A Div. 1 / Div. 2 pair shares problems, and the shared ones
   * are filed under Div. 1 only — so Round 1079's Div. 2 (2197) lists just A
   * and B, while C–F live under 2196 with Div. 1 indices. Looking them up by
   * `contestId-index` finds nothing and the estimator then rates problems
   * Codeforces has already rated, storing numbers up to 100 off.
   *
   * Nothing exposes that pairing: not the API — the contest and problem objects
   * carry no such field — and not the HTML, where the contest page, the problem
   * statement and the standings page never mention the twin's id. Matching on
   * start time is unsound (13% of same-start groups are unrelated contests, such
   * as ICPC problem sets), and matching on problem name is unsound too (contest
   * 100 also has a "Friendly Numbers").
   *
   * This response sidesteps all of it: asked about 2197 it returns that
   * contest's own indices with the correct published ratings attached, because
   * a rating belongs to the problem rather than to the contest. No inference.
   */
  async getPublicContestStandings(contestId) {
    const url = `${this.baseUrl}contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const response = await paced(url);
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /**
   * Contest metadata (including startTimeSeconds) in bulk, ~400 KB.
   *
   * Official rounds only — the gym list is a separate call, and lives in the
   * sibling platform's client. The `gym` parameter this used to take is gone
   * with the branch that chose it.
   */
  async getContestList() {
    return this._callMethod("contest.list", {});
  }

  /**
   * Fetches the entire public problemset, which is the only bulk source of
   * problem tags. Roughly 2MB covering every official contest — cheaper than
   * contest.standings, whose response embeds every participant row (~12MB for
   * a single Div. 3).
   */
  async getProblemsetProblems() {
    return CodeforcesService.#problemset("", this);
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    CodeforcesService.#problemset.clear();
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

// ---------------------------------------------------------------------------
// contest.standings — the roster, ratings, tags, start time and solve counts
// ---------------------------------------------------------------------------


/**
 * Applies the tags and the difficulty Codeforces attaches to a gym's problems.
 *
 * The rating is on the same objects as the tags, in a response the add already
 * pays for. On an official round this is the *only* source that reports a
 * shared Div. 1 / Div. 2 problem's rating under this contest's own index, since
 * `problemset.problems` files such a problem under the contest it originated
 * in. Without it, Round 1079's D stored 1500 against a published 1600.
 *
 * `problemset-sync.js` then covers anything left unrated and is what re-checks
 * weekly, so this never sets `publishedDataCheckedAt` on its own.
 *
 * A near-identical copy lives in the gym platform, which reaches it for a
 * different reason — about a third of gym problems carry a rating inherited
 * from the archive. Same code, two justifications; neither folder imports the
 * other.
 *
 * @returns {boolean} whether the API answered with problems at all, which is
 *   what `publishedDataCheckedAt` records.
 */
export function applyStandingsProblemData(standings, problems) {
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

// ---------------------------------------------------------------------------
// problemset.problems — the readiness gate, and nothing else
// ---------------------------------------------------------------------------

/**
 * ## `problemset.problems` — whether Codeforces has published a contest yet — the readiness gate,
 * and now the only thing `problemset.problems` is used for.
 *
 * This module also held `syncOfficialProblemData`, the weekly pass that replaced
 * stored estimates with published ratings. That moved to `published-sync.js` and
 * reads `contest.standings` instead: the problemset files a shared Div. 1 /
 * Div. 2 problem under the originating contest, so for roughly a third of Div. 2
 * rounds it could never supply most of the ratings, and those contests were
 * re-fetched weekly forever without resolving.
 *
 * Asking whether a contest is *present* is a different question from asking what
 * its problems are rated, and the problemset answers the first one well: it is
 * one ~2.3 MB request, memoised for 60 s, against ~6.5 MB per contest.
 */


/**
 * Test seam. Takes a spacing because proving the signed API is paced needs an
 * observable gap, and it was paced by nothing at all until recently.
 */
export function resetApiState(spacingMs = 0) {
  CodeforcesService.clearProblemsetCache();
  signed.reset(spacingMs);
}

/**
 * ## `contest.standings` — everything an official contest needs, from one response.
 *
 * One unsigned `contest.standings` call carries the name, the problems in order
 * with their published ratings and tags, the start time, and rows enough to
 * count in-contest solves. That call is made regardless — it is the only thing
 * that reports a shared Div. 1 / Div. 2 problem's rating under this contest's
 * own index — so scraping the page for the same facts was paying twice.
 *
 * It saved no bytes to stop (~760 KB against ~8.5 MB either way). What it
 * removed is the failure mode: that scrape was the sole Cloudflare-exposed
 * request on this path, and a challenge there broke official adds outright.
 *
 * Failure is **hard** here, unlike the gym path's soft fallbacks: this is the
 * only source of the roster, so losing it means there is no contest to store.
 * It answers `sourceUnreachable` rather than refusing, because the API being
 * unreachable is a reason to retry — see contest-status.js. Deliberately no
 * fallback to a scrape; keeping one would preserve the exact HTML path this
 * removed, for a case Cloudflare has usually blocked anyway.
 *
 * @param {string} contestId
 * @param {CodeforcesService} this
 */
export async function readSolveStats(contestId, sources) {
  const standings = await sources.getPublicContestStandings(contestId);

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
        `Codeforces returned no problems for contest ${contestId}, so there is ` +
          `nothing to store.`,
      ),
      { isSourceUnreachable: true },
    );
  }

  // Published ratings and tags ride on the same entries.
  applyStandingsProblemData(standings, problems);

  // Verified to agree exactly with counting `points > 0` across all seven
  // problems of a real round. The ghost filter inside it is a no-op here, since
  // a parameterless official response is CONTESTANT-only — unlike the gym
  // response, which must exclude both ghosts and unofficial entrants.
  populateSolveCountsFromApi(standings, problems);

  return {
    contestName: standings?.contest?.name ?? `Contest ${contestId}`,
    problems,
    // Arrives here now, where it used to be null until `contest.list` was
    // fetched — which `start-times.js` then skips entirely.
    startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
    // There is no totals row left to misparse; counts come from rows or not at
    // all. Kept because the alternative is estimating from counts that were
    // never read, which invents ratings silently.
    solveCountsRead: true,
    // Carried, never stored. `field.js` needs the rows to measure the field
    // when contest.ratingChanges is empty, and this is the response it would
    // otherwise fetch a second time.
    standings,
  };
}

/**
 * Whether Codeforces has published this contest's problems yet.
 *
 * The publication check for an official round, and only that. **Present does not
 * mean rated**, and an earlier version of this comment claimed it did — that
 * "the 39 contests with nothing rated are April Fools and Testing Rounds that
 * were never going to be". Measured since: 41 of 2,007 contests in the
 * problemset have no rated problem at all, and the newest of them are ordinary
 * recent rounds still waiting on Codeforces. Being present and unrated is a
 * normal stage a round passes through, not an oddity.
 *
 * That does not weaken the gate, because it was never asking about ratings. A
 * contest Codeforces has not published has no problem list to store; one it has
 * published but not rated stores with estimates, which `published-sync.js` then
 * settles. So absence really is the only question worth asking here.
 *
 * Gyms are absent from the problemset entirely and must never be asked.
 */
export async function isInProblemset(sources, contestId) {
  const problemset = await sources.getProblemsetProblems();
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some(
    (problem) => String(problem.contestId) === wanted,
  );
}
