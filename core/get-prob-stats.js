import { scrapeContestProblems } from "./services/scraping-service";

/**
 * Fetches problem metadata and solve counts for a contest.
 * For official contests, scrapes the standings page totals row.
 * For gym contests, uses the API to count solves, excluding ghost entries.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @param {CodeforcesService} [cfService] - Required for gym contests
 * @returns {{ contestName: string, problems: object[] }}
 */
export async function getProblemStats(type, contestId, cfService = null) {
  if (type === "gym") {
    const { contestName, problems } = await scrapeContestProblems(
      type,
      contestId,
    );
    await populateSolveCountsFromApi(cfService, contestId, problems);
    return { contestName, problems };
  }

  return scrapeContestProblems(type, contestId);
}

async function populateSolveCountsFromApi(cfService, contestId, problems) {
  const standings = await cfService.getContestStandings(contestId);
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
