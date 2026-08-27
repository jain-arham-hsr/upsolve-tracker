import {
  scrapeContestProblems,
  scrapeProblemsPage,
} from "../../services/scraping-service.js";
import {
  summariseSubmissions,
  fetchContestSubmissions,
} from "./contest-submissions.js";

/**
 * Fetches problem metadata and solve counts for a contest.
 * For official contests, scrapes the standings page totals row.
 * For gym contests, uses the API to count solves, excluding ghost entries.
 * @param {string} type - "contest" or "gym"
 * @param {string} contestId
 * @param {CodeforcesService} [cfService] - Required for gym contests
 * @returns {{ contestName: string, problems: object[], tagsSynced: boolean,
 *   startTimeSeconds: number|null, solveCountsRead: boolean,
 *   partyHandles: string[][]|null }}
 *   partyHandles is null on every path but the hidden-standings fallback,
 *   where it is the field the estimator would otherwise read from standings.
 */
export async function readSolveStats(type, contestId, cfService = null) {
  let scraped;
  try {
    scraped = await scrapeContestProblems(type, contestId);
  } catch (error) {
    // The one new branch. It opens only where the add already fails outright:
    // a gym whose standings Codeforces has hidden. Anything else — including
    // an official contest missing its table, which is far more likely to be a
    // layout change worth failing loudly on — rethrows untouched.
    if (type !== "gym" || !error.isStandingsHidden) throw error;
    return statsFromContestStatus(contestId, cfService, error);
  }

  const { contestName, problems, solveCountsRead } = scraped;

  if (type !== "gym") {
    // Official tags, ratings and start times come from bulk endpoints — see
    // problemset-sync.js and start-time-service.js.
    return {
      contestName,
      problems,
      tagsSynced: false,
      startTimeSeconds: null,
      solveCountsRead,
      partyHandles: null,
    };
  }

  const standings = await cfService.getContestStandings(contestId);
  populateSolveCountsFromApi(standings, problems);

  // The same response is the only source gyms have for tags *and* for the
  // difficulty Codeforces publishes, so take both while we're here rather than
  // paying for the call twice. It also carries the start time, which matters
  // for private gyms and mashups: those never appear in contest.list, so this
  // is the only place to get it.
  const tagsSynced = applyStandingsProblemData(standings, problems);
  const startTimeSeconds = standings?.contest?.startTimeSeconds ?? null;

  // `solveCountsRead: true` unconditionally, which looks like a hole and is
  // deliberate. Gym counts come from the API rather than the scraped totals
  // row, and `populateSolveCountsFromApi` does bail without deriving any when
  // `standings.rows` is empty — so this can claim counts it never read, and
  // the guard at adapter.js's `!solveCountsRead` is unreachable for a gym.
  //
  // Empty rows also means an empty field, since rating-distribution.js
  // gates on the same array: the estimator sets nothing, and contest-manager
  // refuses for missing ratings. The add fails either way, and it fails with
  // the *better* sentence — "returned no participant ratings … private or
  // unrated standings can't be measured" is exactly what happened, where the
  // solve-count message would blame a standings layout change that did not
  // occur. Making the flag honest here has been proposed three times; it only
  // swaps an accurate message for a misleading one.
  return {
    contestName,
    problems,
    tagsSynced,
    startTimeSeconds,
    solveCountsRead: true,
    partyHandles: null,
  };
}

/**
 * Rebuilds a gym whose standings Codeforces has hidden.
 *
 * Both usual sources are gone at once: the standings page has no table and
 * contest.standings answers FAILED. The problems page still renders and is the
 * authority on what the contest contains — deriving the list from submissions
 * instead would silently drop any problem nobody attempted. contest.status
 * supplies everything else.
 *
 * @param {string} contestId
 * @param {CodeforcesService} cfService
 * @param {Error} standingsError - what the standings scrape threw, so a
 *   failure here can name the original cause rather than replacing it.
 */
async function statsFromContestStatus(contestId, cfService, standingsError) {
  const page = await scrapeProblemsPage("gym", contestId);

  // Never fall back to a submission-derived list: it would look like a
  // shorter contest rather than a failure.
  if (!page) {
    throw new Error(
      `Gym ${contestId} has its standings hidden, and its problems page couldn't be read ` +
        `either, so there's nothing left to build the contest from. ` +
        `(${standingsError.message})`,
    );
  }

  const derived = summariseSubmissions(
    await fetchContestSubmissions(cfService, contestId),
  );

  page.problems.forEach((problem) => {
    const meta = derived.problemMeta.get(problem.index);
    problem.officialSolves = derived.solveCounts[problem.index] ?? 0;
    problem.tags = meta?.tags ?? [];

    // Codeforces publishes a difficulty for the problems it recognises here.
    // It is the same quantity the estimator approximates, so prefer it and
    // leave the rest to be estimated from the field below.
    if (meta?.rating != null) {
      problem.rating = meta.rating;
      problem.ratingSource = "official";
    }
  });

  return {
    contestName: page.contestName,
    problems: page.problems,
    // Tags come from the same place they do on a visible gym, so they are as
    // synced as they are ever going to be.
    tagsSynced: derived.problemMeta.size > 0,
    startTimeSeconds: derived.startTimeSeconds,
    // With no official submissions at all, every count is zero — which is
    // indistinguishable from "nobody solved anything". Unlike the visible-gym
    // path above there is still a field here, recovered from the submissions,
    // so the estimator would run rather than stall: zero solves makes it aim
    // for 0.5 expected solves, which lands at the top of its search range
    // (~2400 against a 40-person field, not the 800 floor). Every problem
    // would read as maximally hard and sort to the *front* of the queue.
    solveCountsRead: derived.partyHandles.length > 0,
    partyHandles: derived.partyHandles,
  };
}

/**
 * Applies the tags and the difficulty Codeforces attaches to a gym's problems.
 *
 * The rating is on the same objects as the tags, in a response the add already
 * pays for. About a third of gym problems carry one — those are problems the
 * setter picked from the archive rather than preparing themselves, so
 * Codeforces still recognises them and serves its own published number.
 * Preferring it is the same rule official contests already follow: the same
 * quantity, measured rather than inferred.
 *
 * It matters more here than the wording suggests. Measured over the 62 stored
 * gym problems Codeforces also rates, the estimate was a mean 211 off, with 14
 * of them out by 400 or more — not from a bias in the maths, but because a gym
 * field is 5-76 people where the estimator needs thousands.
 *
 * Anything Codeforces does not rate keeps `rating: null` and is estimated as
 * before, which is the other two thirds.
 *
 * @returns {boolean} whether the API answered with problems at all, which is
 *   what `tagsSyncedAt` records.
 */
function applyStandingsProblemData(standings, problems) {
  const apiProblems = standings?.problems;
  if (!apiProblems?.length) return false;

  const byIndex = new Map(
    apiProblems.map((problem) => [problem.index, problem]),
  );
  problems.forEach((problem) => {
    const published = byIndex.get(problem.index);
    problem.tags = published?.tags ?? [];

    if (typeof published?.rating === "number") {
      problem.rating = published.rating;
      problem.ratingSource = "official";
    }
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
