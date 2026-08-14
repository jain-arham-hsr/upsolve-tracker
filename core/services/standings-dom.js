/**
 * Every assumption this extension makes about Codeforces' HTML lives here.
 *
 * Problem names and official solve counts aren't in the API, so they're read
 * off the standings page. That page is not a contract — when Codeforces
 * changes its markup, this is the file that needs updating, and ideally the
 * only one.
 *
 * Extractors return null rather than a plausible default when they can't find
 * what they're looking for. A missing solve count that reads as zero produces
 * a confident, wrong rating that gets stored and sorted like a real one; a
 * null forces the caller to decide, loudly.
 */

export const SELECTORS = {
  // Ordered fallbacks: first match wins.
  standingsTable: ["table.standings"],
  contestName: [".contest-name", ".caption", "title"],

  problemLink: 'a[href*="/problem/"]',
  profileLink: 'a[href*="/profile/"]',
  pageLink: 'a[href*="standings/page/"]',
};

/** Node.TEXT_NODE, inlined so this module parses outside a browser too. */
const TEXT_NODE = 3;

/** Text the totals row is identified by. */
const TOTALS_ROW_MARKER = "Accepted";

function queryFirst(root, selectors) {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

export function findStandingsTable(doc) {
  return queryFirst(doc, SELECTORS.standingsTable);
}

/** @returns {string|null} */
export function findContestName(doc) {
  const element = queryFirst(doc, SELECTORS.contestName);
  const text = element?.innerText ?? element?.textContent;
  return text?.replace(/\s+/g, " ").trim() || null;
}

/**
 * Problem metadata from the standings header row.
 * @returns {Array<{index: string, name: string, url: string}>|null}
 *   null when the header row can't be read at all.
 */
export function extractProblems(standingsTable) {
  const headerRow = standingsTable.querySelector("tr");
  if (!headerRow) return null;

  const links = Array.from(headerRow.querySelectorAll(SELECTORS.problemLink));
  if (links.length === 0) return null;

  const problems = links.map((link) => ({
    index: link.textContent.trim(),
    name: parseProblemName(link.getAttribute("title")),
    url: `https://codeforces.com${link.getAttribute("href")}`,
  }));

  // An indexless problem would silently mismatch every later lookup by index.
  return problems.every((problem) => problem.index) ? problems : null;
}

export function extractHandles(doc) {
  const standingsTable = findStandingsTable(doc);
  if (!standingsTable) return [];

  const handles = [];
  standingsTable.querySelectorAll(SELECTORS.profileLink).forEach((link) => {
    const handle = link.textContent.trim();
    if (handle) handles.push(handle);
  });
  return handles;
}

/**
 * Per-problem solve counts from the totals row.
 * @returns {number[]|null} One count per problem, or null if the row is
 *   missing or any cell won't parse — callers must not treat that as zeroes.
 */
export function extractSolveCounts(standingsTable, problemCount) {
  const totalsRow = Array.from(standingsTable.querySelectorAll("tr")).find(
    (row) => (row.innerText ?? row.textContent ?? "").includes(TOTALS_ROW_MARKER),
  );
  if (!totalsRow) return null;

  const cells = Array.from(totalsRow.querySelectorAll("td")).slice(
    -problemCount,
  );
  if (cells.length !== problemCount) return null;

  const counts = cells.map(parseSolveCount);
  return counts.some((count) => count === null) ? null : counts;
}

/** @returns {number|null} */
function parseSolveCount(cell) {
  const firstTextNode = Array.from(cell.childNodes).find(
    (node) => node.nodeType === TEXT_NODE && node.nodeValue.trim() !== "",
  );
  const raw =
    firstTextNode?.nodeValue.trim() ??
    cell.firstElementChild?.innerText ??
    cell.innerText ??
    cell.textContent;

  if (!raw) return null;
  const digits = raw.split(/[\n\s]/)[0].replace(/\D/g, "");
  if (digits === "") return null;

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function highestPageNumber(doc) {
  const pages = Array.from(doc.querySelectorAll(SELECTORS.pageLink))
    .map((link) => Number(link.getAttribute("href").match(/page\/(\d+)/)?.[1]))
    .filter((page) => Number.isFinite(page));
  return pages.length > 0 ? Math.max(...pages) : 1;
}

export function hasPageLink(doc, page) {
  return !!doc.querySelector(`a[href*="standings/page/${page}"]`);
}

function parseProblemName(title) {
  if (!title) return "Unknown Problem";
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ") : title;
}
