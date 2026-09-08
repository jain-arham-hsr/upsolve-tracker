/**
 * AtCoder's fit: what this site does around `core/rating-models/`.
 *
 * The maths is `rasch.js` and `rasch-upper-asymptote.js`, shared with
 * Codeforces and pinned against AtCoder Problems' own Python by
 * `tests/rating-models.test.js`, which must keep passing unchanged. What is
 * AtCoder's alone is here: its scale, the model chosen for AGC's first
 * problem, the ceiling, and the policy of **always answering where there is
 * anyone to answer from**.
 *
 * Pure: the datasets arrive from `readField`, read by `api.js#field`, and
 * nothing here fetches or imports anything but the models.
 *
 * AtCoder publishes **no difficulty of its own**, anywhere. This is the reason
 * every rating on this platform is stored as `ratingSource: "estimated"`.
 *
 * ## Why this diverges from the source
 *
 * AtCoder Problems refuses in four situations: nobody solved it, everyone
 * solved it, fewer than forty usable rows, or a fit above the ceiling. Ported
 * faithfully, that meant AtCoder problems could render `???` while the
 * identical situation on Codeforces produced a number — `codeforces/estimator.js`
 * targets 0.5 expected solves when nobody solved a problem and lets the
 * search run to its ceiling, and floors the result rather than declining.
 *
 * Same maths, opposite policy, and the refusal is the weaker half: a `???`
 * says less than a bound does, cannot be acted on, and is indistinguishable
 * from "we never read the standings". So each refusal becomes the bound
 * Codeforces already gives. `tests/platforms/atcoder/estimator.test.js`
 * carries the one deliberate divergence by name.
 */
import { fitDifficulty } from "../../rating-models/rasch.js";
import { fitWithUpperAsymptote } from "../../rating-models/rasch-upper-asymptote.js";

/** AtCoder's own scale: base 6 over 400, the same constants its ratings use. */
const SCALE = { base: 6, divisor: 400, lo: -10000, hi: 10000 };

/** A fit above this is clamped: past here the scale stops meaning anything. */
const MAX_DIFFICULTY = 6000;

/** Rate every problem the site did not, from the field `readField` produced. */
export function estimate(contest, field) {
  const difficulties = estimateContest(field);

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
 * Fit every task in a field.
 *
 * @param {Array<{taskId: string, abilities: object[], responses: number[],
 *   modelsNonAttempts: boolean}>} field - from `api.js#field`
 * @returns {Map<string, number>} task id → difficulty. A task nobody usable
 *   entered is not in the field, so it is not here either.
 */
export function estimateContest(field) {
  const results = new Map();
  for (const task of field) results.set(task.taskId, fitTask(task));
  return results;
}

function fitTask({ abilities, responses, modelsNonAttempts }) {
  const solved = responses.reduce((sum, y) => sum + y, 0);

  // **Nobody solved it, or everyone did.** The likelihood is then monotonic —
  // no difficulty explains the data better than any other beyond some point —
  // so the honest answer is a bound rather than a value. Aiming half a solve
  // inside the range picks that bound out, which is exactly what Codeforces
  // does for its own zero-solve case.
  const degenerate = solved === 0 || solved === responses.length;
  const target = solved === 0 ? 0.5 : solved === responses.length ? solved - 0.5 : solved;

  // The upper-asymptote model fits a non-attempt rate from the spread of
  // responses, so it has nothing to work with when they are all identical.
  const difficulty =
    modelsNonAttempts && !degenerate
      ? fitWithUpperAsymptote({ abilities, responses, ...SCALE }).difficulty
      : fitDifficulty({ abilities, solveCount: target, ...SCALE, integer: true });

  // Clamped, not discarded: a fit above the ceiling still means "harder than
  // anything on this scale", which orders correctly.
  return Math.min(difficulty, MAX_DIFFICULTY);
}
