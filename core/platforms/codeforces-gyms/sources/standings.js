import { scrapeProblemsPage } from "../scraping.js";
import {
  summariseSubmissions,
  fetchContestSubmissions,
} from "./contest-status.js";

/**
 * Fetches a gym's problem metadata and solve counts.
 *
 * **One signed `contest.standings` call carries all of it** — the contest name,
 * the problems in order with their published ratings and tags, the start time,
 * the phase, and rows enough to count in-contest solves.
 *
 * ## This used to scrape the standings page first
 *
 * It fetched and parsed `/gym/<id>/standings` for the roster and the name, then
 * made this call anyway for everything else — and `populateSolveCountsFromApi`
 * *overwrote* the counts the page had just been parsed for. The scrape's only
 * surviving contribution was the contest name and the problem index/name list,
 * both of which are in this response. Verified against real gyms: 100001, 102253
 * and 702859 all return `contest.name` and a `problems[]` where every entry has
 * an index and a name.
 *
 * The recorded reason for scraping was that "a gym's roster has no API source:
 * its standings need signing". Needing a key is not an obstacle when the key is
 * in hand — this call is signed and works. The genuine obstacle applies only to
 * a gym whose standings the setter has hidden, which is the branch below.
 *
 * So a gym add now makes **no HTML request** unless the standings are hidden,
 * and therefore needs no codeforces.com tab: this is the signed JSON API, which
 * is not challenged and goes through the pacer rather than the page transport.
 *
 * @param {string} contestId
 * @param {CodeforcesService} cfService
 * @returns {{ contestName: string, problems: object[], tagsSynced: boolean,
 *   startTimeSeconds: number|null, solveCountsRead: boolean,
 *   partyHandles: string[][]|null, finished: boolean|null, standings: object }}
 *   `partyHandles` is null except on the hidden-standings fallback, where it is
 *   the field the estimator would otherwise read from standings.
 */
export async function readSolveStats(contestId, cfService) {
  let standings;
  try {
    standings = await cfService.getContestStandings(contestId);
  } catch (error) {
    // Opens only where the add would otherwise fail outright: a gym whose
    // standings Codeforces has hidden. Anything else — a network fault, a bad
    // key — rethrows untouched, since routing around one would turn a broken
    // request into a silently shorter contest.
    if (!error.isStandingsHidden) throw error;
    return statsFromContestStatus(contestId, cfService, error);
  }

  const problems = (standings?.problems ?? []).map((problem) => ({
    index: problem.index,
    name: problem.name,
    rating: null,
    ratingSource: null,
    officialSolves: 0,
    solved: false,
    tags: [],
  }));

  if (problems.length === 0) {
    throw Object.assign(
      new Error(
        `Codeforces returned no problems for gym ${contestId}, so there is ` +
          `nothing to store.`,
      ),
      { isSourceUnreachable: true },
    );
  }

  populateSolveCountsFromApi(standings, problems);

  // The same response is the only source gyms have for tags *and* for the
  // difficulty Codeforces publishes, so take both while we are here.
  const tagsSynced = applyStandingsProblemData(standings, problems);

  return {
    contestName: standings?.contest?.name ?? `Gym ${contestId}`,
    problems,
    tagsSynced,
    // Matters for private gyms and mashups: those never appear in
    // contest.list, so this is the only place to get a start time for them.
    startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
    // `solveCountsRead: true` unconditionally, which looks like a hole and is
    // deliberate. Counts come from the API rather than a parsed totals row, and
    // `populateSolveCountsFromApi` does bail without deriving any when
    // `standings.rows` is empty — so this can claim counts it never read, and
    // the `!solveCountsRead` guard in estimator.js is unreachable.
    //
    // Empty rows also means an empty field, since field.js gates on the same
    // array: the estimator sets nothing and contest-manager refuses for missing
    // ratings. The add fails either way, and it fails with the *better*
    // sentence — "participants aren't visible" is exactly what happened, where a
    // solve-count message would blame a layout change that did not occur.
    solveCountsRead: true,
    partyHandles: null,
    finished: standings?.contest?.phase
      ? standings.contest.phase === "FINISHED"
      : null,
    // Carried, never stored. `field.js` measures the field from these rows, and
    // this is the response it would otherwise fetch a second time.
    standings,
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
  const page = await scrapeProblemsPage(contestId);

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
    // No contest.standings to ask here, so it comes off the problems page the
    // list was read from — the sidebar says "Finished" or otherwise.
    finished: page.finished,
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
 *   what `publishedDataCheckedAt` records.
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
