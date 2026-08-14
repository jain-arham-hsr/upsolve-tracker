import { scrapeContestProblems } from "./services/scraping-service";

/**
 * Fetches problem metadata and solve counts for a contest.
 * For official contests, scrapes the standings page totals row.
 * For gym contests, uses the API to count solves, excluding ghost entries.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @param {CodeforcesService} [cfService] - Required for gym contests
 * @returns {{ contestName: string, problems: object[], tagsSynced: boolean }}
 */
export async function getProblemStats(type, contestId, cfService = null) {
  const { contestName, problems } = await scrapeContestProblems(type, contestId);

  if (type !== "gym") {
    // Official tags come from the problemset in bulk — see tag-service.js.
    return { contestName, problems, tagsSynced: false };
  }

  const standings = await cfService.getContestStandings(contestId);
  populateSolveCountsFromApi(standings, problems);

  // The same response is the only tag source gyms have, so take it while
  // we're here rather than paying for the call twice.
  const tagsSynced = populateTagsFromStandings(standings, problems);

  return { contestName, problems, tagsSynced };
}

function populateTagsFromStandings(standings, problems) {
  const apiProblems = standings?.problems;
  if (!apiProblems?.length) return false;

  const tagsByIndex = new Map(
    apiProblems.map((problem) => [problem.index, problem.tags ?? []]),
  );
  problems.forEach((problem) => {
    problem.tags = tagsByIndex.get(problem.index) ?? [];
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
