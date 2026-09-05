/**
 * The Rasch model with a fitted upper asymptote.
 *
 *   P(solve | ability θ) = (1 − r) · σ(a · (θ − b))
 *
 * Some fraction `r` of the field never attempts the problem at all, so the
 * solve probability saturates below 1 no matter how strong the contestant.
 * AtCoder Problems fits this for AGC's first problem, where "did not solve" and
 * "never looked" are otherwise indistinguishable and the plain Rasch fit reads
 * the non-attempts as failures.
 *
 * ## Why it is not called `3pl`
 *
 * The source calls it `fit_3plm_irt`, and that name does not survive
 * inspection. The IRT ladder is:
 *
 *   1PL / Rasch  difficulty b
 *   2PL          + discrimination a
 *   3PL          + lower asymptote c   ("guessing")
 *   4PL          + upper asymptote d   ("slipping")
 *
 * `r` sets `d = 1 − r`, an **upper** asymptote — so this belongs to the 4PL
 * family with `c = 0`, not the 3PL family, whose extra parameter is a guessing
 * floor at the opposite end of the curve. And because each grid step delegates
 * to the Rasch fit, discrimination stays a fixed constant: two parameters are
 * fitted, not three. Naming it for the parameter it actually adds is the only
 * description that is true of it.
 */
import { fitDifficulty, solveProbability } from "./rasch.js";

/** Guards `exp` overflow the way the source does, so the two stay comparable. */
const safeLog = (x) => Math.log(Math.max(x, 1e-100));

/**
 * Grid-search the non-attempt rate, refitting difficulty at each step.
 *
 * For a candidate `r`, the observed solves are treated as coming from only the
 * `(1 − r)` of the field who engaged, so the Rasch fit is given the inflated
 * target `solveCount / (1 − r)`. Whichever `r` maximises the log-likelihood of
 * the actual responses wins.
 *
 * Ties break on difficulty, then discrimination, then `r` — the source compares
 * whole tuples with `max()`, which orders lexicographically, and reproducing
 * that matters because the grid can genuinely tie on flat likelihoods.
 *
 * @param {object} options
 * @param {Array<{rating: number, weight: number}>} options.abilities
 * @param {number[]} options.responses  - 1 solved, 0 not; aligned with abilities.
 * @param {number} options.base
 * @param {number} options.divisor
 * @param {number} options.lo
 * @param {number} options.hi
 * @returns {{difficulty: number, retreatProbability: number}}
 */
export function fitWithUpperAsymptote({ abilities, responses, base, divisor, lo, hi }) {
  const solveCount = responses.reduce((sum, y) => sum + y, 0);
  const discrimination = Math.log(base) / divisor;

  let best = null;
  // 0, 0.025, … 0.475 — the source's `frange` stops strictly below 0.5, so a
  // field assumed to be more than half non-attempting is out of scope.
  for (let step = 0; step < 20; step++) {
    const retreatProbability = step * 0.025;
    const participate = 1 - retreatProbability;

    const difficulty = fitDifficulty({
      abilities,
      solveCount: solveCount / participate,
      base,
      divisor,
      lo,
      hi,
      integer: true,
    });

    let logLikelihood = 0;
    for (let i = 0; i < abilities.length; i++) {
      const p =
        participate *
        solveProbability({
          ability: abilities[i].rating,
          difficulty,
          base,
          divisor,
        });
      logLikelihood += safeLog(responses[i] === 1 ? p : 1 - p);
    }

    const candidate = { logLikelihood, difficulty, discrimination, retreatProbability };
    if (best === null || isBetter(candidate, best)) best = candidate;
  }

  return { difficulty: best.difficulty, retreatProbability: best.retreatProbability };
}

/** Lexicographic on (logLikelihood, difficulty, discrimination, retreatProbability). */
function isBetter(a, b) {
  if (a.logLikelihood !== b.logLikelihood) return a.logLikelihood > b.logLikelihood;
  if (a.difficulty !== b.difficulty) return a.difficulty > b.difficulty;
  if (a.discrimination !== b.discrimination) return a.discrimination > b.discrimination;
  return a.retreatProbability > b.retreatProbability;
}
