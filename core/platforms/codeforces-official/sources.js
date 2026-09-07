/**
 * Everything the official platform reads from Codeforces, beyond what
 * `codeforces/sources.js` already covers.
 *
 * An official add is pure signed JSON API, which is why this folder has no
 * `scrapers/`: nothing here reads markup. Endpoints: `contest.ratingChanges`,
 * `problemset.problems`, `contest.list`, and the deliberately unsigned
 * `contest.standings`.
 */
import { CodeforcesSources } from "../codeforces/sources.js";
import { withTtlCache } from "../../services/ttl-cache.js";

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

  async getContestRatingChanges(contestId) {
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
  async getPublicContestStandings(contestId) {
    const url = `${this.baseUrl}contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const data = await this.json(url);

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /** Contest metadata in bulk, ~400 KB. Official rounds only. */
  async getContestList() {
    return this._callMethod("contest.list", {});
  }

  /** The entire public problemset, ~2 MB, memoised for a minute. */
  async getProblemsetProblems() {
    return OfficialSources.#problemset("", this);
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    OfficialSources.#problemset.clear();
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
  OfficialSources.clearProblemsetCache();
  CodeforcesSources.reset(spacingMs);
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
 * @param {OfficialSources} this
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
