import { CodeforcesHttp } from "./http.js";
import {
  extractProblems,
  extractProblemsFromList,
  extractSolveCounts,
  hasFinished,
  findContestName,
  findContestNameOnProblemsPage,
  findStandingsTable,
} from "./standings-dom.js";

/**
 * Fetches and parses the standings page for a contest.
 * @param {string} contestId
 * @returns {{ contestName: string, standingsTable: Element, doc: Document }}
 */
async function fetchStandingsPage(contestId) {
  // `showUnofficial=true` always: a gym's field includes out-of-competition
  // entrants, and the official platform — which passed false here — no longer
  // reads HTML at all.
  const rawHtml = await CodeforcesHttp.get(
    `https://codeforces.com/gym/${contestId}/standings?showUnofficial=true`,
  );
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  return doc;
}

/**
 * Extracts problem metadata and solve counts from a contest standings page.
 *
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[], solveCountsRead: boolean }}
 *   solveCountsRead is false when the totals row couldn't be parsed. The
 *   counts are left at 0, which is only safe if nothing goes on to estimate
 *   ratings from them — so the caller has to check.
 */
export async function scrapeContestProblems(contestId) {
  const doc = await fetchStandingsPage(contestId);

  const standingsTable = findStandingsTable(doc);
  if (!standingsTable) {
    const error = new Error(
      `Couldn't read the standings for gym ${contestId} — the page didn't contain a standings table. ` +
        `Codeforces may have changed its layout, or the contest may be private.`,
    );
    // A flag rather than a message match, the same idiom as isNotPublishedYet
    // and isIdentityMismatch: a copy edit to the sentence above must not
    // silently change which contests take the fallback. solve-stats.js
    // reads this to rebuild a gym from contest.status instead of giving up.
    error.isStandingsHidden = true;
    throw error;
  }

  const parsed = extractProblems(standingsTable);
  if (!parsed) {
    throw new Error(
      `Couldn't read the problem list for gym ${contestId} from the standings header. ` +
        `Codeforces may have changed its layout.`,
    );
  }

  // Tags are filled from the API; the standings page doesn't carry them.
  const problems = parsed.map(blankProblem);

  const counts = extractSolveCounts(standingsTable, problems.length);
  if (counts) {
    counts.forEach((count, i) => {
      problems[i].officialSolves = count;
    });
  } else {
    console.warn(
      `[Scraping Service] Solve counts unreadable for gym ${contestId}.`,
    );
  }

  return {
    contestName: findContestName(doc) ?? `Contest ${contestId}`,
    problems,
    solveCountsRead: counts !== null,
  };
}

/**
 * Problem metadata from a contest's own problems page.
 *
 * Only used when the standings are hidden — see scrapeContestProblems above.
 * The page carries no solve counts and no field, so the caller has to source
 * those elsewhere; what it does carry is the definitive problem list,
 * including problems nobody submitted to.
 *
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[] }|null}
 *   null when the page can't be parsed, so the caller can refuse loudly.
 */
export async function scrapeProblemsPage(contestId) {
  const path = `/gym/${contestId}`;
  const rawHtml = await CodeforcesHttp.get(`https://codeforces.com${path}`);
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  const parsed = extractProblemsFromList(doc);
  if (!parsed) return null;

  return {
    // Not findContestName: this page names the contest somewhere else, and
    // that chain's second choice is the "→ About Contest" sidebox heading.
    contestName:
      findContestNameOnProblemsPage(doc, path) ?? `Contest ${contestId}`,
    problems: parsed.map(blankProblem),
    finished: hasFinished(doc),
  };
}

/** The stored shape, before anything is known about difficulty or solves. */
function blankProblem(problem) {
  return {
    ...problem,
    rating: null,
    ratingSource: null,
    officialSolves: 0,
    solved: false,
    tags: [],
  };
}
