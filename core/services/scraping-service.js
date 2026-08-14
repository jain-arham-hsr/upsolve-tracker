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
    tags: [], // Filled from the API; the standings page doesn't carry tags.
  }));

  populateSolveCountsFromTable(standingsTable, problems);

  return { contestName, problems };
}

/**
 * Standings pages are rank-ordered, which drives how the field is sampled.
 *
 * A page is therefore a narrow band of near-identical ratings, not a random
 * slice — so picking pages at random gives a handful of tight clusters rather
 * than an independent sample, and the estimate wanders by hundreds of points.
 * Two strata fix that:
 *
 *   HEAD - the strongest competitors, read in full. Small, but it decides the
 *          hard problems: when three people solve something, the answer rests
 *          entirely on how strong those three were.
 *   TAIL - everyone else, sampled at even intervals down the rank order, which
 *          covers the whole spread instead of clumping.
 *
 * Cost stops scaling with turnout: ~30 requests whether 2,000 or 40,000 enter.
 */
const HEAD_PAGES = 10;
const TAIL_PAGES = 20;

/**
 * Reads enough of the official standings to characterise the field.
 *
 * @returns {{ groups: Array<{handles: string[], scale: number}>, total: number }}
 *   Each group's scale is how many real competitors one sampled competitor
 *   stands for. A fully-read contest comes back as a single group at scale 1.
 */
export async function sampleParticipantHandles(contestId, onProgress = () => {}) {
  const firstDoc = await fetchStandingsPage("contest", contestId, 1);
  const firstHandles = extractHandles(firstDoc);
  if (firstHandles.length === 0) return { groups: [], total: 0 };

  const perPage = firstHandles.length;
  const lastPage = highestPageNumber(firstDoc);

  // Small enough that sampling would cost as much as reading it properly.
  if (lastPage <= HEAD_PAGES + TAIL_PAGES) {
    return walkAllPages(contestId, firstHandles, onProgress);
  }

  // The final page is usually partial, so measure it rather than assume.
  const lastDoc = await fetchStandingsPage("contest", contestId, lastPage);
  const lastHandles = extractHandles(lastDoc);

  // A wrong page count would undercount the field and skew every rating, so
  // confirm the last page really is last before trusting the arithmetic.
  if (hasPageLink(lastDoc, lastPage + 1)) {
    console.warn(
      `[Scraping Service] Page count looked wrong for ${contestId}; reading every page.`,
    );
    return walkAllPages(contestId, firstHandles, onProgress);
  }

  const total = (lastPage - 1) * perPage + lastHandles.length;

  const head = [...firstHandles];
  for (let page = 2; page <= HEAD_PAGES; page++) {
    onProgress(`Reading the top of the field (${page} of ${HEAD_PAGES})…`);
    head.push(
      ...extractHandles(await fetchStandingsPage("contest", contestId, page)),
    );
  }

  const tailPages = spreadPages(HEAD_PAGES + 1, lastPage, TAIL_PAGES);
  const tail = [];
  for (const [index, page] of tailPages.entries()) {
    onProgress(`Sampling the field (${index + 1} of ${tailPages.length})…`);
    // The last page was already fetched to size the field.
    const pageHandles =
      page === lastPage
        ? lastHandles
        : extractHandles(await fetchStandingsPage("contest", contestId, page));
    tail.push(...pageHandles);
  }

  console.log(
    `[Scraping Service] Read ${head.length} + sampled ${tail.length} of ~${total} ` +
      `participants from ${HEAD_PAGES + tailPages.length} of ${lastPage} pages.`,
  );

  return {
    groups: [
      { handles: head, scale: 1 },
      { handles: tail, scale: (total - head.length) / tail.length },
    ],
    total,
  };
}

async function walkAllPages(contestId, firstHandles, onProgress) {
  const handles = [...firstHandles];
  let page = 1;

  while (true) {
    const doc = await fetchStandingsPage("contest", contestId, page + 1);
    const pageHandles = extractHandles(doc);
    if (pageHandles.length === 0) break;

    page++;
    onProgress(`Reading the standings (page ${page})…`);
    handles.push(...pageHandles);
    if (!hasPageLink(doc, page + 1)) break;
  }

  console.log(
    `[Scraping Service] Read ${handles.length} participants across ${page} page(s) for contest ${contestId}.`,
  );
  return { groups: [{ handles, scale: 1 }], total: handles.length };
}

/**
 * Evenly spaced page numbers across [from, to], taken at interval midpoints so
 * the sample doesn't lean toward either end of the range.
 */
function spreadPages(from, to, count) {
  const span = to - from + 1;
  if (span <= count) {
    return Array.from({ length: span }, (_, i) => from + i);
  }

  const step = span / count;
  const pages = new Set();
  for (let i = 0; i < count; i++) {
    pages.add(from + Math.min(span - 1, Math.floor(i * step + step / 2)));
  }
  return [...pages].sort((a, b) => a - b);
}

function extractHandles(doc) {
  const standingsTable = doc.querySelector("table.standings");
  if (!standingsTable) return [];

  const handles = [];
  standingsTable.querySelectorAll('a[href*="/profile/"]').forEach((link) => {
    const handle = link.textContent.trim();
    if (handle) handles.push(handle);
  });
  return handles;
}

function highestPageNumber(doc) {
  const pages = Array.from(doc.querySelectorAll('a[href*="standings/page/"]'))
    .map((link) => Number(link.getAttribute("href").match(/page\/(\d+)/)?.[1]))
    .filter((page) => Number.isFinite(page));
  return pages.length > 0 ? Math.max(...pages) : 1;
}

function hasPageLink(doc, page) {
  return !!doc.querySelector(`a[href*="standings/page/${page}"]`);
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
