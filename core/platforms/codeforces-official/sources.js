/**
 * Everything this platform reads from Codeforces — one section per endpoint.
 *
 * Named `sources.js` rather than `scraping.js` because scraping is what
 * `scrapers/` does: turning markup into facts. Nothing here scrapes — an
 * official add is pure signed JSON API, which is why this folder has no
 * `scrapers/` at all.
 *
 * The fetching is not here either: `api.js` builds and signs the requests and
 * `services/request-pacer.js` spaces them. What each source owns is *which*
 * endpoint answers its question, and what an unusable answer means for it.
 */


// ---------------------------------------------------------------------------
// contest.standings — the roster, ratings, tags, start time and solve counts
// ---------------------------------------------------------------------------

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
 * @param {CodeforcesService} cfService
 */
export async function readSolveStats(contestId, cfService) {
  const standings = await cfService.getPublicContestStandings(contestId);

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
export async function isInProblemset(cfService, contestId) {
  const problemset = await cfService.getProblemsetProblems();
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some(
    (problem) => String(problem.contestId) === wanted,
  );
}
