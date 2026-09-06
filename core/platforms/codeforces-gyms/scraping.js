/**
 * The last HTML the extension reads on Codeforces, and only for one case.
 *
 * A gym whose standings the setter hid answers `FAILED` to `contest.standings`,
 * so the roster has to come from somewhere — and the `/gym/<id>` problems page
 * is the one page those contests still render. Every other Codeforces path,
 * official and gym alike, is now pure JSON API.
 *
 * `scrapeContestProblems` used to live here and read a visible gym's standings
 * page for its roster, name and solve counts. It was redundant: the very next
 * call fetched `contest.standings`, which carries all three, and
 * `populateSolveCountsFromApi` overwrote the counts the page had just been
 * parsed for.
 */
import { CodeforcesHttp } from "./http.js";
import { ProblemsPage } from "./dom-parsers/problems-page.js";

/**
 * Problem metadata from a contest's own problems page.
 *
 * The page carries no solve counts and no field, so the caller sources those
 * from `contest.status` instead; what it does carry is the definitive problem
 * list, **including problems nobody submitted to** — which is why the list
 * cannot be derived from the submissions themselves.
 *
 * @param {string} contestId
 * @returns {{ contestName: string, problems: object[] }|null}
 *   null when the page can't be parsed, so the caller can refuse loudly.
 */
export async function scrapeProblemsPage(contestId) {
  const path = `/gym/${contestId}`;
  const doc = await CodeforcesHttp.getDocument(`https://codeforces.com${path}`);

  const page = ProblemsPage.parse(doc, { contestPath: path });
  if (!page) return null;

  // Which selector finds the name is the parser's business and now lives
  // there. What is left here is a *display* fallback and the stored shape,
  // neither of which is a fact about the page — a parser that invented
  // "Contest 712373" would be doing the thing this folder forbids.
  return {
    contestName: page.contestName ?? `Contest ${contestId}`,
    problems: page.problems.map(blankProblem),
    finished: page.finished,
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
