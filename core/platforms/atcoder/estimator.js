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

/** AtCoder's own scale: base 6 over 400, the same constants its ratings use. */
const SCALE = { base: 6, divisor: 400, lo: -10000, hi: 10000 };

/** A fit above this is clamped: past here the scale stops meaning anything. */
const MAX_DIFFICULTY = 6000;

/** Rate every problem the site did not, from the standings `readField` produced. */
export function estimate(contest, standings) {
  const difficulties = estimateContest(standings);

  let rated = 0;
  for (const problem of contest.problems) {
    if (problem.rating !== null) continue;
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
 * Pure, so the whole algorithm tests without a network stack.
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
 * Fit one task, and **always answer where there is anyone to answer from**.
 *
 * ## Why this diverges from the source
 *
 * AtCoder Problems refuses in four situations: nobody solved it, everyone solved
 * it, fewer than forty usable rows, or a fit above the ceiling. Ported
 * faithfully, that meant AtCoder problems could render `???` while the identical
 * situation on Codeforces produced a number — `codeforces-official/estimator.js`
 * targets 0.5 expected solves when nobody solved a problem and lets the search
 * run to its ceiling, and floors the result rather than declining.
 *
 * Same maths, opposite policy, and the refusal is the weaker half: a `???` says
 * less than a bound does, cannot be acted on, and is indistinguishable from
 * "we never read the standings". So each refusal becomes the bound Codeforces
 * already gives.
 *
 * **The port guarantee is untouched.** What was ported is the *model* —
 * `rating-models/rasch.js` and `rasch-upper-asymptote.js` — and that is pinned
 * against the Python's own output by `tests/rating-models.test.js`, which must
 * keep passing unchanged. What changes here is the policy wrapped around it,
 * which was always ours.
 *
 * @returns {number|null} null only when the standings contain nobody usable to
 *   fit against at all, which `canEstimate: true` then turns into a loud
 *   refusal rather than a silent `???`.
 */
function fitTask(rows, taskId) {
  // The best score anyone actually achieved — not a declared maximum from
  // TaskInfo, which is a different number and would change every answer.
  const maxScore = Math.max(...rows.map((row) => row.scores.get(taskId) ?? 0), 0);

  const isAccepted = (row) =>
    (row.accepted.get(taskId) ?? 0) === 1 && (row.scores.get(taskId) ?? 0) === maxScore
      ? 1
      : 0;

  // First-timers have no meaningful rating to fit against.
  const recurring = rows.filter((row) => row.previousContests > 0 && row.rating > 0);

  // `selectDataset` narrows further for ABC's easy pair — to rated entrants
  // only — which an *unrated* contest empties completely. Fall back to the
  // wider set rather than refusing: a noisier fit still beats no answer.
  const narrowed = selectDataset(recurring, taskId);
  const dataset = narrowed.length > 0 ? narrowed : recurring;
  if (dataset.length === 0) return null;

  const responses = dataset.map(isAccepted);
  const solved = responses.reduce((sum, y) => sum + y, 0);

  // **Nobody solved it, or everyone did.** The likelihood is then monotonic —
  // no difficulty explains the data better than any other beyond some point —
  // so the honest answer is a bound rather than a value. Aiming half a solve
  // inside the range picks that bound out, which is exactly what Codeforces
  // does for its own zero-solve case.
  const degenerate = solved === 0 || solved === responses.length;
  const target = solved === 0 ? 0.5 : solved === responses.length ? solved - 0.5 : solved;

  const abilities = toAbilities(dataset);

  // The upper-asymptote model fits a non-attempt rate from the spread of
  // responses, so it has nothing to work with when they are all identical.
  const difficulty =
    isAgcFirstProblem(taskId) && !degenerate
      ? fitWithUpperAsymptote({ abilities, responses, ...SCALE }).difficulty
      : fitDifficulty({ abilities, solveCount: target, ...SCALE, integer: true });

  // Clamped, not discarded: a fit above the ceiling still means "harder than
  // anything on this scale", which orders correctly.
  return Math.min(difficulty, MAX_DIFFICULTY);
}

// ---------------------------------------------------------------------------
// Standings rows → the dataset a task is fitted against. Pure, and the part of
// the port that must not be simplified: each filter changes the answer.
// ---------------------------------------------------------------------------

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
export function buildRows(standings) {
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
 *
 * @param recurring entrants with a usable prior rating — see `fitTask`.
 */
export function selectDataset(recurring, taskId) {
  if (isVeryEasyProblem(taskId)) {
    return recurring.filter((row) => row.isRated && !row.retreated);
  }
  if (isAgcFirstProblem(taskId)) {
    return recurring;
  }
  return recurring.filter((row) => !row.retreated);
}

/**
 * The abilities the fit runs against — the AtCoder analogue of a Codeforces
 * rating distribution, minus the strata, since a contest's own standings are
 * always read whole and there is nothing to scale up from.
 */
export function toAbilities(dataset) {
  return dataset.map((row) => ({
    rating: inverseAdjustRating(row.rating, row.previousContests),
    weight: 1,
  }));
}

function isVeryEasyProblem(taskId) {
  if (!taskId.startsWith("abc")) return false;
  const last = taskId[taskId.length - 1];
  if (last !== "a" && last !== "b") return false;
  return Number(taskId.slice(3, 6)) >= 42;
}

/** Exported because it also picks the *model*, which is the estimator's call. */
export function isAgcFirstProblem(taskId) {
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
