/**
 * Standings in, the data the estimator fits out.
 *
 * The same role `field.js` plays on both Codeforces platforms, so the three
 * folders read alike: everything about *who was in the contest and how they did*
 * lives here, and `estimator.js` next door only fits. The split is worth having
 * because these two halves fail differently — a wrong ability is a silently
 * plausible number, a wrong fit is usually an obviously absurd one — and because
 * the filters below are the part of the port that must not be simplified.
 *
 * Ported from AtCoder Problems' `estimator/main.py` along with the models in
 * `core/rating-models/`. Faithful rather than merely equivalent: each filter
 * changes the answer.
 */

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
