/**
 * Codeforces' difficulty estimate, shared by both Codeforces platforms.
 *
 * The maths is `core/rating-models/rasch.js`, shared with AtCoder. What is
 * Codeforces' alone is the scale, the rounding and the floor, and the fact
 * that both platforms fit the same quantity — in-contest solves against a
 * field of pre-contest ratings — whichever way that field was read.
 *
 * Pure: the field arrives from each platform's `field.js`, and nothing here
 * fetches. `tests/estimator-accuracy.test.js` records the known bias — up to
 * ~300 low on the hardest problems — and the seven levers tried against it.
 */
import { fitDifficulty } from "../../rating-models/rasch.js";

/**
 * Binary-search the rating whose Elo-expected solve count matches the actual
 * one, then round to the nearest 100 with a floor of 800. Both conventions are
 * Codeforces', not the model's; AtCoder's difficulties are unrounded and
 * unbounded below.
 *
 * @param {{ strata: Array<{ratings: number[], scale: number}> }} distribution
 * @param {number} actualSolves
 * @returns {number|null} null only with nothing to fit against
 */
export function estimateProblemRating(distribution, actualSolves) {
  const strata = (distribution?.strata ?? []).filter((stratum) => stratum.ratings?.length > 0);
  if (strata.length === 0 || actualSolves < 0) return null;

  // Strata flatten to weighted abilities: `scale * Σ p` and `Σ (scale * p)`
  // are the same sum reassociated.
  const abilities = strata.flatMap(({ ratings, scale }) =>
    ratings.map((rating) => ({ rating, weight: scale })),
  );

  // Nobody solving it does not mean the rating is infinite, and 0 expected
  // solves is unreachable. Aiming at 0.5 drives the estimate to the ceiling.
  const solveCount = actualSolves === 0 ? 0.5 : actualSolves;

  const fitted = fitDifficulty({
    abilities, solveCount, base: 10, divisor: 400, lo: 0, hi: 4000, integer: false, iterations: 25,
  });

  return Math.max(800, Math.round(fitted / 100) * 100);
}

/** Rate every problem the site did not, from the field `readField` produced. */
export function estimate(contest, distribution) {
  for (const problem of contest.problems) {
    if (problem.rating !== null) continue;
    problem.rating = estimateProblemRating(distribution, problem.officialSolves);
    if (problem.rating !== null) problem.ratingSource = "estimated";
  }
}
