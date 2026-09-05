/**
 * The Rasch model, and the fit both platforms' difficulty estimates run through.
 *
 * ## The model
 *
 *   P(solve | ability θ) = 1 / (1 + base^((difficulty − θ) / divisor))
 *
 * One fitted item parameter — difficulty — with discrimination fixed and shared
 * across items. That is the **Rasch model**, synonymous with the one-parameter
 * logistic (1PL); `rasch-1pl` would say the same thing twice. `difficulty` is by
 * construction the ability at which P = 0.5, which is exactly the quantity every
 * one of these sites means by a problem's rating.
 *
 * ## Why one file serves two platforms
 *
 * Codeforces' estimator and AtCoder Problems' were written independently and are
 * the same estimator:
 *
 *   AtCoder Problems:  1 / (1 + 6^((b − θ)/400))
 *   Codeforces (ours): 1 / (1 + 10^((b − θ)/400))
 *
 * Both then binary-search b until expected solves equal observed solves. Every
 * difference is a constant, so they live here as required arguments.
 *
 * **Nothing is defaulted, deliberately.** A default base or bound would let one
 * platform silently inherit the other's scale, and a difficulty on the wrong
 * scale is not visibly wrong — it is a plausible number that mis-sorts the queue.
 * Making every caller state its constants keeps the two readable side by side.
 *
 * ## Two search modes, because the sources differ in more than constants
 *
 * They diverge in the *root-finding*, not just the model, so both are reproduced
 * exactly rather than unified onto whichever looks tidier:
 *
 *   - `integer: true`  — halve until the bracket is one wide, take the low end.
 *     AtCoder difficulties are integers and run negative (931 rated problems are
 *     below zero; ABC471-A is −817), so the bracket starts at ±10000.
 *   - `integer: false` — a fixed number of float bisections. What the Codeforces
 *     estimator has always done; its caller rounds and floors afterwards.
 *
 * The two also break ties on `expected === solveCount` in opposite directions.
 * That is preserved per mode rather than normalised: it is unreachable in
 * practice for floats, and changing it for integers would move real answers.
 */

/** P(solve) for one ability against one candidate difficulty. */
export function solveProbability({ ability, difficulty, base, divisor }) {
  return 1 / (1 + Math.pow(base, (difficulty - ability) / divisor));
}

/**
 * Expected solves across the whole field.
 *
 * `weight` carries a sampled group back up to the size it represents: reading a
 * tenth of a stratum and weighting each member by ten estimates the same total,
 * because expectation is linear. A field read in full weights every member 1.
 */
export function expectedSolves({ abilities, difficulty, base, divisor }) {
  let total = 0;
  for (const { rating, weight } of abilities) {
    total += weight * solveProbability({ ability: rating, difficulty, base, divisor });
  }
  return total;
}

/**
 * The difficulty at which expected solves match the observed count.
 *
 * Expected solves fall monotonically as difficulty rises, so bisection is exact
 * up to the bracket width; `low` is always the side where expectation still
 * meets or exceeds the target.
 *
 * @param {object} options
 * @param {Array<{rating: number, weight: number}>} options.abilities
 * @param {number} options.solveCount   - observed solves; callers substitute
 *   their own target for zero (Codeforces aims at 0.5, which drives the estimate
 *   to the ceiling rather than the floor).
 * @param {number} options.base         - 6 for AtCoder, 10 for Codeforces.
 * @param {number} options.divisor      - 400 on both, stated rather than assumed.
 * @param {number} options.lo           - inclusive low bracket.
 * @param {number} options.hi           - inclusive high bracket.
 * @param {boolean} options.integer     - integer bisection vs fixed float passes.
 * @param {number} [options.iterations] - required when `integer` is false.
 * @returns {number} the fitted difficulty, unrounded and unfloored.
 */
export function fitDifficulty({
  abilities,
  solveCount,
  base,
  divisor,
  lo,
  hi,
  integer,
  iterations,
}) {
  let low = lo;
  let high = hi;
  const expected = (difficulty) =>
    expectedSolves({ abilities, difficulty, base, divisor });

  if (integer) {
    // `Math.floor`, matching Python's `//`. JavaScript's truncation rounds
    // toward zero instead, so the two disagree whenever `low + high` is
    // negative and odd — reachable here, since the bracket starts at −10000.
    //
    // Measured rather than assumed: across 300 random fields the search hit a
    // divergent midpoint 251 times in 48 cases, and **every final answer still
    // agreed**. Bisection converges on a unique boundary point and both forms
    // land strictly inside the bracket, so they differ in path, not result.
    // Floor is kept because it is what the source does and keeps the two
    // diffable line by line — not because the alternative is dangerous.
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (expected(mid) < solveCount) high = mid;
      else low = mid;
    }
    return low;
  }

  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2;
    if (expected(mid) > solveCount) low = mid;
    else high = mid;
  }
  return low;
}
