/**
 * AtCoder difficulty, fitted locally from a contest's own standings.
 *
 * A port of AtCoder Problems' `estimator/main.py`, deliberately faithful rather
 * than merely equivalent: the filters below are not incidental cleanup, each one
 * changes the answer, and an approximation would be a different estimator
 * wearing its name. `tests/rating-models.test.js` pins the fit against values
 * produced by running that Python verbatim.
 *
 * AtCoder publishes **no difficulty of its own**, anywhere. This is the reason
 * every rating on this platform is stored as `ratingSource: "estimated"`.
 *
 * ## Two things from the source are deliberately not ported
 *
 * **The time model** (`slope`/`intercept`/`variance`) predicts how long a solve
 * takes, which nothing here consumes. Leaving it out is why only six fields are
 * read per row rather than the ten the source touches.
 *
 * **`rating.py`'s rating replay.** It re-derives every user's rating by
 * replaying AtCoder's whole history, and exists only for contests predating the
 * rating system — which would need every contest's standings, exactly the bulk
 * crawl this design avoids. No special case is needed: on such a contest
 * `OldRating` is 0 for everyone, the recurring-entrant filter empties the
 * dataset, the 40-row guard fires, and no estimate is produced. Those are
 * precisely the problems AtCoder Problems itself flags as experimental.
 */
import { fitDifficulty } from "../../rating-models/rasch.js";
import { fitWithUpperAsymptote } from "../../rating-models/rasch-upper-asymptote.js";
import { fetchStandings } from "./scraping.js";

/** AtCoder's own scale: base 6 over 400, the same constants its ratings use. */
const SCALE = { base: 6, divisor: 400, lo: -10000, hi: 10000 };

/** Below this the fit is noise; the source refuses rather than guessing. */
const MIN_ROWS = 40;

/** A fit above this is not a hard problem, it is a failed fit. */
const MAX_DIFFICULTY = 6000;

/**
 * The trunk's estimator hand-off.
 *
 * **Failure here is soft, on purpose.** Standings need a session, and a
 * signed-out user must still be able to add a contest — it simply stores
 * `rating: null`, renders `???`, and fills in on a later refresh. That is the
 * existing, documented meaning of an unrated AtCoder problem, so nothing new is
 * introduced. Note the opposite choice is made for *submissions*, which fail
 * loudly: a missing difficulty is visible in the queue, a missing solve is not.
 */
export async function fill({ contest, onProgress = () => {} }) {
  let standings = null;
  try {
    onProgress("Reading the standings…");
    standings = await fetchStandings(contest.id);
  } catch (error) {
    console.info(
      `[AtCoder] Couldn't read standings for ${contest.id}, so its problems stay ` +
        `unrated for now: ${error.message}`,
    );
    return;
  }

  if (standings === null) {
    console.info(`[AtCoder] Standings for ${contest.id} were not in the expected shape.`);
    return;
  }

  onProgress("Estimating problem difficulty…");
  const difficulties = estimateContest(standings);

  let rated = 0;
  for (const problem of contest.problems) {
    const difficulty = difficulties.get(problem.problemId);
    if (typeof difficulty !== "number") continue;
    problem.rating = difficulty;
    problem.ratingSource = "estimated";
    rated++;
  }

  console.log(`[AtCoder] Estimated ${rated}/${contest.problems.length} difficulties.`);
}

/**
 * Fit every task in a standings payload.
 *
 * Pure, so the whole algorithm tests without a network stack — the same reason
 * `codeforces/contest-submissions.js` is shaped this way.
 *
 * @returns {Map<string, number>} task id → difficulty, omitting refusals.
 */
export function estimateContest(standings) {
  const rows = buildRows(standings);
  const results = new Map();

  for (const task of standings.TaskInfo) {
    const difficulty = fitTask(rows, task.TaskScreenName);
    if (difficulty !== null) results.set(task.TaskScreenName, difficulty);
  }

  return results;
}

/**
 * One row per entrant, carrying every task.
 *
 * **This is the part that must not be simplified.** Every participant appears in
 * every task's dataset, including the ones they never opened — those are the
 * negative samples, and without them the fit sees only people who engaged and
 * reads every problem as far easier than it is. It is also exactly the
 * "model attempts, not ability" change that `estimator-accuracy.test.js` already
 * records as measured and wrong for Codeforces: mean error 213 → 374.
 */
function buildRows(standings) {
  return standings.StandingsData.map((entry) => {
    const scores = new Map();
    const accepted = new Map();

    for (const [taskId, result] of Object.entries(entry.TaskResults ?? {})) {
      const score = result?.Score ?? 0;
      scores.set(taskId, score);
      // Status is consulted only when the score is positive, matching the
      // source: a zero-scoring row is not accepted whatever its status says.
      accepted.set(taskId, score > 0 && result?.Status === 1 ? 1 : 0);
    }

    return {
      rating: entry.OldRating ?? 0,
      previousContests: entry.Competitions ?? 0,
      isRated: Boolean(entry.IsRated),
      // Entered and never submitted. They say nothing about difficulty, so they
      // are excluded everywhere except AGC's first problem.
      retreated: (entry.TotalResult?.Count ?? 0) === 0,
      scores,
      accepted,
    };
  });
}

/** @returns {number|null} null wherever the source refuses to estimate. */
function fitTask(rows, taskId) {
  // The best score anyone actually achieved — not a declared maximum from
  // TaskInfo, which is a different number and would change every answer.
  const maxScore = Math.max(...rows.map((row) => row.scores.get(taskId) ?? 0), 0);
  if (maxScore === 0) return null;

  const isAccepted = (row) =>
    (row.accepted.get(taskId) ?? 0) === 1 && (row.scores.get(taskId) ?? 0) === maxScore
      ? 1
      : 0;

  // First-timers have no meaningful rating to fit against.
  const recurring = rows.filter((row) => row.previousContests > 0 && row.rating > 0);

  const dataset = selectDataset(recurring, taskId);
  if (dataset.length < MIN_ROWS) return null;

  const responses = dataset.map(isAccepted);
  const solved = responses.reduce((sum, y) => sum + y, 0);
  // Everyone solving it, or nobody, leaves the fit unconstrained in one
  // direction — there is no difficulty that explains it.
  if (solved === 0 || solved === responses.length) return null;

  const abilities = dataset.map((row) => ({
    rating: inverseAdjustRating(row.rating, row.previousContests),
    weight: 1,
  }));

  const difficulty = isAgcFirstProblem(taskId)
    ? fitWithUpperAsymptote({ abilities, responses, ...SCALE }).difficulty
    : fitDifficulty({ abilities, solveCount: solved, ...SCALE, integer: true });

  return difficulty > MAX_DIFFICULTY ? null : difficulty;
}

/**
 * Which entrants a task is fitted against.
 *
 * Two hand-tuned exceptions, carried across from the source because dropping
 * them would silently change the numbers:
 *
 *   - **ABC's A and B, from abc042 on.** Strong contestants often skip them
 *     entirely, so their non-solves are not evidence of difficulty. Restricted
 *     to rated entrants who actually submitted something.
 *   - **AGC's first problem.** Its negative samples are unreliable in the other
 *     direction, so retreated entrants stay in and the non-attempt rate is
 *     fitted explicitly instead.
 *
 * Keyed on the **task id**, never the displayed index: in a daily-training rerun
 * `abc432_c` is listed as problem E, and only the id keeps an easy ABC-A
 * classified as one wherever it reappears.
 */
function selectDataset(recurring, taskId) {
  if (isVeryEasyProblem(taskId)) {
    return recurring.filter((row) => row.isRated && !row.retreated);
  }
  if (isAgcFirstProblem(taskId)) {
    return recurring;
  }
  return recurring.filter((row) => !row.retreated);
}

function isVeryEasyProblem(taskId) {
  if (!taskId.startsWith("abc")) return false;
  const last = taskId[taskId.length - 1];
  if (last !== "a" && last !== "b") return false;
  return Number(taskId.slice(3, 6)) >= 42;
}

function isAgcFirstProblem(taskId) {
  return taskId.startsWith("agc") && taskId.endsWith("_a");
}

/**
 * Recover the rating AtCoder would show a settled account.
 *
 * AtCoder heavily discounts a new competitor's displayed rating — by design, to
 * avoid overstating a small sample. Fitting against the displayed number would
 * measure that discount rather than ability, so it is reversed first. This is
 * the inverse of the adjustment in AtCoder's own rating formula.
 */
export function inverseAdjustRating(rating, previousContests) {
  if (rating <= 0) return NaN;

  let adjusted = rating;
  if (adjusted <= 400) adjusted = 400 * (1 - Math.log(400 / adjusted));

  const correction =
    ((Math.sqrt(1 - Math.pow(0.9, 2 * previousContests)) /
      (1 - Math.pow(0.9, previousContests)) -
      1) /
      (Math.sqrt(19) - 1)) *
    1200;

  return adjusted + correction;
}
