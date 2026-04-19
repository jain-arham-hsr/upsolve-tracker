import { HttpClient } from "./services/http-client.js";

/**
 * Fetches problem metadata and solve counts for a contest.
 * For official contests, scrapes the standings page bottom row.
 * For gyms, uses the API to count solves manually, excluding ghost entries.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @param {CodeforcesService} [cfService] - Required for gym contests
 * @param {string} [groupId] - Required for group contest URLs
 * @returns {{ contestName: string, problems: object[] }}
 */
export async function getProblemStats(type, contestId, cfService = null) {
  const rawHtml = await HttpClient.get(
    `https://codeforces.com/${type}/${contestId}/standings?showUnofficial=false`,
  );
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const standingsTable = doc.querySelector("table.standings");
  if (!standingsTable) throw new Error("Could not find the standings table.");

  const contestName =
    doc.querySelector(".contest-name")?.innerText ?? `Contest ${contestId}`;
  const problems = extractProblems(standingsTable);

  if (type === "gym") {
    await populateSolveCountsFromApi(cfService, contestId, problems);
  } else {
    populateSolveCountsFromTable(standingsTable, problems);
  }

  return { contestName, problems };
}

function extractProblems(standingsTable) {
  return Array.from(
    standingsTable.querySelector("tr").querySelectorAll('a[href*="/problem/"]'),
  ).map((a) => ({
    index: a.textContent.trim(),
    name: parseProblemName(a.getAttribute("title")),
    url: `https://codeforces.com${a.getAttribute("href")}`,
    rating: null,
    officialSolves: 0,
    solved: false,
  }));
}

function parseProblemName(title) {
  if (!title) return "Unknown Problem";
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ") : title;
}

/**
 * For official contests: read solve counts from the pre-computed bottom totals row.
 */
function populateSolveCountsFromTable(standingsTable, problems) {
  const totalsRow = Array.from(standingsTable.querySelectorAll("tr")).find(
    (row) => row.innerText.includes("Accepted"),
  );
  if (!totalsRow) return;

  Array.from(totalsRow.querySelectorAll("td"))
    .slice(-problems.length)
    .forEach((cell, i) => {
      problems[i].officialSolves = parseSolveCount(cell);
    });
}

function parseSolveCount(cell) {
  const firstTextNode = Array.from(cell.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== "",
  );

  const raw =
    firstTextNode?.nodeValue.trim() ??
    cell.firstElementChild?.innerText ??
    cell.innerText;

  return parseInt(raw.split(/[\n\s]/)[0].replace(/\D/g, ""), 10) || 0;
}

/**
 * For gym contests: fetch standings via API, exclude ghost entries,
 * and manually count accepted submissions per problem.
 */
async function populateSolveCountsFromApi(cfService, contestId, problems) {
  const standings = await cfService.getContestStandings(contestId);
  if (!standings?.rows?.length) return;

  const validRows = standings.rows.filter((row) => !row.party.ghost);

  const solveCountMap = {};
  validRows.forEach((row) => {
    row.problemResults.forEach((result, i) => {
      const index = problems[i]?.index;
      if (!index) return;
      // A problem is solved if it has an accepted submission (bestSubmissionTimeSeconds is set)
      if (result.bestSubmissionTimeSeconds != null) {
        solveCountMap[index] = (solveCountMap[index] ?? 0) + 1;
      }
    });
  });

  problems.forEach((problem) => {
    problem.officialSolves = solveCountMap[problem.index] ?? 0;
  });
}
