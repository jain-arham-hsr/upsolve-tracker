/**
 * Everything an official contest needs, from one response.
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
