/**
 * Everything this platform reads from Codeforces — one section per endpoint.
 *
 * Named `sources.js` rather than `scraping.js` because scraping is what
 * `scrapers/` does: turning markup into facts. Only the last section below
 * reads markup at all, and even it only fetches the page and hands it to
 * `scrapers/problems-page.js`.
 *
 * The fetching is not here: `api.js` signs the JSON calls, `http.js` configures
 * the shared `services/site-client.js` for the one HTML route, and
 * `request-pacer.js` spaces both. What each source owns is which endpoint
 * answers its question, how many requests that takes, and what an unusable
 * answer means for it.
 *
 * Three endpoints, in the order a gym add reaches them:
 *
 *   contest.standings   the roster, ratings, tags, times, solve counts
 *   contest.status      the same, rebuilt from submissions, when standings are hidden
 *   /gym/<id>           the definitive problem list, likewise
 */

import { CodeforcesHttp } from "./http.js";
import { ProblemsPage } from "./scrapers/problems-page.js";


// -------------------------------------------------------------------------
// contest.standings
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// contest.status — for gyms whose standings are hidden
// -------------------------------------------------------------------------

/**
 * Rebuilding a gym from its submissions, for contests whose standings
 * Codeforces has hidden.
 *
 * A gym can be set to "Standings will not be visible as original contest".
 * When it is, both halves of the usual acquisition path are gone at once: the
 * standings page carries no table, and contest.standings answers FAILED with
 * "Standings are not available". contest.status still answers, and it carries
 * everything the standings response was being mined for — problem metadata,
 * who competed, and what they solved.
 *
 * The derivation is pure so it can be tested against a captured contest
 * without a network stack, the way applySolvedStatus is. See
 * tests/contest-status.test.js, which pins it to a real hidden-standings gym.
 */

/** Matches getContestStandings' participantTypes, so both gym paths agree. */
const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

/** contest.status pages; 10k is accepted in one request. */
const PAGE_SIZE = 10000;

/**
 * Refuse rather than walk an unbounded contest. A submission is ~400 bytes of
 * JSON, so this is already a larger response than the ~12MB standings the
 * scraper pays for on a big Div. 3.
 */
const MAX_SUBMISSIONS = 50000;

/**
 * Every submission to a contest, paged.
 *
 * @param {CodeforcesService} cfService
 * @param {string|number} contestId
 * @returns {Promise<object[]>}
 */
export async function fetchContestSubmissions(cfService, contestId) {
  const submissions = [];
  let from = 1;

  while (true) {
    const page = await cfService.getContestStatus(contestId, {
      from,
      count: PAGE_SIZE,
    });
    if (!page?.length) break;

    submissions.push(...page);
    if (page.length < PAGE_SIZE) break;

    from += PAGE_SIZE;

    // Truncating silently would understate every solve count, and an
    // understated count reads as a harder problem rather than as a failure.
    if (submissions.length >= MAX_SUBMISSIONS) {
      throw new Error(
        `Gym ${contestId} has more than ${MAX_SUBMISSIONS} submissions, which is too many to ` +
          `rebuild its standings from.`,
      );
    }
  }

  return submissions;
}

/**
 * Derives everything the add path needs from a contest's submissions.
 *
 * Practice submissions are excluded throughout: they happen after the contest,
 * so counting them would overstate how many people solved a problem under
 * contest conditions, which is exactly the quantity the estimator is fitted
 * to. Ghost parties are excluded for the same reason the standings path
 * excludes them.
 *
 * @param {object[]} submissions - contest.status rows
 * @returns {{
 *   solveCounts: Record<string, number>,
 *   problemMeta: Map<string, {name: string, rating: number|null, tags: string[]}>,
 *   partyHandles: string[][],
 *   startTimeSeconds: number|null,
 * }}
 */
export function summariseSubmissions(submissions) {
  const solvers = new Map(); // problem index -> Set of party id
  const problemMeta = new Map();
  const parties = new Map(); // party id -> string[] of handles
  const startTimes = new Map(); // startTimeSeconds -> party count

  for (const submission of submissions ?? []) {
    const problem = submission?.problem;
    const author = submission?.author;
    if (!problem?.index || !author) continue;

    // Problem metadata is worth taking from any submission, including a
    // practice one: it describes the problem, not the attempt.
    if (!problemMeta.has(problem.index)) {
      problemMeta.set(problem.index, {
        name: problem.name ?? null,
        rating: typeof problem.rating === "number" ? problem.rating : null,
        tags: problem.tags ?? [],
      });
    }

    if (!OFFICIAL_PARTICIPANT_TYPES.has(author.participantType)) continue;
    if (author.ghost) continue;

    const partyId = author.participantId;
    if (partyId == null) continue;

    if (!parties.has(partyId)) {
      parties.set(
        partyId,
        (author.members ?? []).map((member) => member.handle).filter(Boolean),
      );
      if (author.startTimeSeconds != null) {
        startTimes.set(
          author.startTimeSeconds,
          (startTimes.get(author.startTimeSeconds) ?? 0) + 1,
        );
      }
    }

    if (submission.verdict !== "OK") continue;

    // A party that solves the same problem twice still solved it once.
    if (!solvers.has(problem.index)) solvers.set(problem.index, new Set());
    solvers.get(problem.index).add(partyId);
  }

  const solveCounts = {};
  for (const [index, partySet] of solvers) solveCounts[index] = partySet.size;

  return {
    solveCounts,
    problemMeta,
    partyHandles: [...parties.values()],
    startTimeSeconds: mostCommon(startTimes),
  };
}

/**
 * Virtual entrants each carry their own start time, so the contest's own is
 * the one the most parties share rather than the first one seen.
 */
function mostCommon(tally) {
  let best = null;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// -------------------------------------------------------------------------
// /gym/<id> — the one page this extension still reads
// -------------------------------------------------------------------------

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

  const page = ProblemsPage.scrape(doc, { contestPath: path });
  if (!page) return null;

  // Which selector finds the name is the scraper's business and now lives
  // there. What is left here is a *display* fallback and the stored shape,
  // neither of which is a fact about the page — a scraper that invented
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
