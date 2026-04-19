import { HttpClient } from "./http-client.js";

/**
 * Fetches and parses the standings page for a contest.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @returns {{ contestName: string, standingsTable: Element, doc: Document }}
 */
async function fetchStandingsPage(type, contestId, page = null) {
  const pageStr = page ? `/page/${page}` : "";
  const showUnofficial = type === "gym";
  const rawHtml = await HttpClient.get(
    `https://codeforces.com/${type}/${contestId}/standings${pageStr}?showUnofficial=${showUnofficial}`,
  );
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  return doc;
}

/**
 * Extracts problem metadata and solve counts from a contest standings page.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[] }}
 */
export async function scrapeContestProblems(type, contestId) {
  const doc = await fetchStandingsPage(type, contestId);
  const standingsTable = doc.querySelector("table.standings");
  if (!standingsTable) throw new Error("Could not find the standings table.");

  const contestName =
    doc.querySelector(".contest-name")?.innerText ?? `Contest ${contestId}`;

  const problems = Array.from(
    standingsTable.querySelector("tr").querySelectorAll('a[href*="/problem/"]'),
  ).map((a) => ({
    index: a.textContent.trim(),
    name: parseProblemName(a.getAttribute("title")),
    url: `https://codeforces.com${a.getAttribute("href")}`,
    rating: null,
    officialSolves: 0,
    solved: false,
  }));

  populateSolveCountsFromTable(standingsTable, problems);

  return { contestName, problems };
}

/**
 * Scrapes all participant handles from paginated official contest standings.
 * @param {string} contestId
 * @returns {string[]} Flat list of handles in standings order.
 */
export async function scrapeParticipantHandles(contestId) {
  const handles = [];
  let page = 1;

  while (true) {
    const doc = await fetchStandingsPage("contest", contestId, page);
    const standingsTable = doc.querySelector("table.standings");
    if (!standingsTable) break;

    const rows = Array.from(standingsTable.querySelectorAll("tr")).filter(
      (row) => row.querySelector('a[href*="/profile/"]'),
    );
    if (rows.length === 0) break;

    rows.forEach((row) => {
      row.querySelectorAll('a[href*="/profile/"]').forEach((a) => {
        handles.push(a.textContent.trim());
      });
    });

    const hasNextPage = !!doc.querySelector(
      `a[href*="standings/page/${page + 1}"]`,
    );
    if (!hasNextPage) break;
    page++;
  }

  console.log(
    `[Scraping Service] Scraped ${handles.length} handles across ${page} page(s) for contest ${contestId}.`,
  );
  return handles;
}

// --- Private helpers ---

function parseProblemName(title) {
  if (!title) return "Unknown Problem";
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ") : title;
}

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
