import { HttpClient } from "./http-client.js";
import {
  extractHandles,
  extractProblems,
  extractSolveCounts,
  findContestName,
  findStandingsTable,
  hasPageLink,
  highestPageNumber,
} from "./standings-dom.js";

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
 *
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[], solveCountsRead: boolean }}
 *   solveCountsRead is false when the totals row couldn't be parsed. The
 *   counts are left at 0, which is only safe if nothing goes on to estimate
 *   ratings from them — so the caller has to check.
 */
export async function scrapeContestProblems(type, contestId) {
  const doc = await fetchStandingsPage(type, contestId);

  const standingsTable = findStandingsTable(doc);
  if (!standingsTable) {
    throw new Error(
      `Couldn't read the standings for ${type} ${contestId} — the page didn't contain a standings table. ` +
        `Codeforces may have changed its layout, or the contest may be private.`,
    );
  }

  const parsed = extractProblems(standingsTable);
  if (!parsed) {
    throw new Error(
      `Couldn't read the problem list for ${type} ${contestId} from the standings header. ` +
        `Codeforces may have changed its layout.`,
    );
  }

  const problems = parsed.map((problem) => ({
    ...problem,
    rating: null,
    ratingSource: null,
    officialSolves: 0,
    solved: false,
    tags: [], // Filled from the API; the standings page doesn't carry tags.
  }));

  const counts = extractSolveCounts(standingsTable, problems.length);
  if (counts) {
    counts.forEach((count, i) => {
      problems[i].officialSolves = count;
    });
  } else {
    console.warn(
      `[Scraping Service] Solve counts unreadable for ${type} ${contestId}.`,
    );
  }

  return {
    contestName: findContestName(doc) ?? `Contest ${contestId}`,
    problems,
    solveCountsRead: counts !== null,
  };
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
 *
 * Exported for tests: the sampling accuracy this file relies on is only
 * meaningful if the spread is genuinely even.
 */
export function spreadPages(from, to, count) {
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
