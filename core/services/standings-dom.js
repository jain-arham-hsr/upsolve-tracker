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

const SELECTORS = {
  // Ordered fallbacks: first match wins.
  standingsTable: ["table.standings"],
  problemsTable: ["table.problems"],
  contestName: [".contest-name", ".caption", "title"],

  /**
   * The contest name on a *problems* page, which is a different place.
   *
   * Deliberately not the chain above: that page has no `.contest-name`, and
   * its first `.caption` is the "→ About Contest" sidebox heading — so reusing
   * it named a contest "→ About Contest" in the queue. The name is the sidebar
   * contest box's header link, which points at the contest root.
   */
  problemsPageContestName: ["#sidebar .rtable th a", "#sidebar .rtable th"],

  problemLink: 'a[href*="/problem/"]',
  profileLink: 'a[href*="/profile/"]',
  pageLink: 'a[href*="standings/page/"]',
};

/** Node.TEXT_NODE, inlined so this module parses outside a browser too. */
const TEXT_NODE = 3;

/** Text the totals row is identified by. */
const TOTALS_ROW_MARKER = "Accepted";

/** Shared by both problem extractors so their fallbacks can't drift. */
const UNKNOWN_PROBLEM = "Unknown Problem";

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
  return cleanText(queryFirst(doc, SELECTORS.contestName));
}

function cleanText(element) {
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

/**
 * The contest name from a *problems* page.
 *
 * @param {Document} doc
 * @param {string} contestPath - e.g. "/gym/712373", the sidebar header's href
 * @returns {string|null}
 */
export function findContestNameOnProblemsPage(doc, contestPath) {
  // Most specific first: the sidebar box header links to the contest root.
  const linked = doc.querySelector(`#sidebar a[href="${contestPath}"]`);
  const fromLink = cleanText(linked);
  if (fromLink) return fromLink;

  const fromSidebar = cleanText(
    queryFirst(doc, SELECTORS.problemsPageContestName),
  );
  if (fromSidebar) return fromSidebar;

  // Codeforces titles pages "<section> - <contest> - Codeforces". Dropping the
  // suffix is worth doing; guessing at the section prefix is not, since a
  // slightly long name still reads correctly and a wrong split does not.
  const title = cleanText(doc.querySelector("title"));
  return title?.replace(/\s*-\s*Codeforces\s*$/i, "").trim() || null;
}

/**
 * Problem metadata from a contest's *problems* page, rather than its
 * standings header.
 *
 * A gym can be configured so its standings are never visible, which leaves the
 * problems page as the only place the problem list appears at all. Deriving it
 * from submissions instead would silently omit any problem nobody attempted,
 * so this page is the authority on what a contest contains.
 *
 * @returns {Array<{index: string, name: string, url: string}>|null}
 *   null when the table is missing or a row can't be read.
 */
export function extractProblemsFromList(doc) {
  const table = queryFirst(doc, SELECTORS.problemsTable);
  if (!table) return null;

  const problems = [];

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    // The header row has no id cell, so this skips it without matching on text.
    const indexLink = row.querySelector("td.id a");
    if (!indexLink) continue;

    const index = indexLink.textContent.trim();
    const href = indexLink.getAttribute("href");

    // An indexless problem would silently mismatch every later lookup by
    // index, exactly as in extractProblems.
    if (!index || !href) return null;

    // The name is the row's other link to the same problem. Matching on
    // position instead would break the first time a column is added.
    const nameLink = Array.from(
      row.querySelectorAll(SELECTORS.problemLink),
    ).find((link) => link !== indexLink && link.textContent.trim());

    problems.push({
      index,
      name: nameLink?.textContent.replace(/\s+/g, " ").trim() || UNKNOWN_PROBLEM,
      url: `https://codeforces.com${href}`,
    });
  }

  return problems.length > 0 ? problems : null;
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
  if (!title) return UNKNOWN_PROBLEM;
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ") : title;
}
