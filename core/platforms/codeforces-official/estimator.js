/**
 * Codeforces' difficulty estimate, official half.
 *
 * The maths is `core/rating-models/rasch.js`, shared with AtCoder. What lives
 * here is the part that is Codeforces' alone — its scale, its rounding, and
 * where the field to fit against comes from.
 *
 * ## The known bias, recorded so it is not rediscovered
 *
 * Estimates run below Codeforces' published ratings, by up to ~300 on the
 * hardest problems, because the Elo model assumes everyone attempted every
 * problem when most never open the hard ones. "Model attempts, not ability" was
 * the suggested fix and was measured to be worse — mean absolute error 213 to 374.
 * `tests/estimator-accuracy.test.js` holds the numbers and the six other levers
 * that were tried and rejected.
 *
 * ## Two copies of `estimateProblemRating`
 *
 * Identical, and duplicated because the two platforms share no folder. It is
 * three lines of Codeforces convention over a shared model — round to the
 * nearest 100, floor at 800 — so the risk of drift is small and the maths it
 * wraps is in one place. Where the two genuinely differ is everything below it:
 * where the field comes from, and what a remaining gap means.
 */
import { fitDifficulty } from "../../rating-models/rasch.js";
import { getOfficialRatingDist } from "./field.js";
import { distributionSize } from "../../rating-models/rating-distribution.js";

/**
 * Binary-search the rating whose Elo-expected solve count matches the actual
 * one, then round to the nearest 100 with a floor of 800.
 *
 * The rounding and the floor are Codeforces' conventions, not the model's, which
 * is why they are applied here rather than inside the fit. AtCoder's difficulties
 * are unrounded and unbounded below, and applying either to them would be wrong.
 *
 * @param {{ strata: Array<{ratings: number[], scale: number}> }} distribution
 * @param {number} actualSolves
 */
export function estimateProblemRating(distribution, actualSolves) {
  const strata = (distribution?.strata ?? []).filter(
    (stratum) => stratum.ratings?.length > 0,
  );

  if (strata.length === 0 || actualSolves < 0) {
    return null;
  }

  // Strata flatten to weighted abilities: `scale * Σ p` and `Σ (scale * p)` are
  // the same sum reassociated, so this is a rewrite rather than a change.
  const abilities = strata.flatMap(({ ratings, scale }) =>
    ratings.map((rating) => ({ rating, weight: scale })),
  );

  // Nobody solving it does not mean the rating is infinite, and aiming at 0
  // expected solves is unreachable. Aiming at 0.5 — the "threshold of failure"
  // for this field — drives the estimate to the ceiling rather than the floor.
  const solveCount = actualSolves === 0 ? 0.5 : actualSolves;

  const fitted = fitDifficulty({
    abilities,
    solveCount,
    base: 10,
    divisor: 400,
    lo: 0,
    hi: 4000,
    integer: false,
    iterations: 25,
  });

  return Math.max(800, Math.round(fitted / 100) * 100);
}

/**
 * The trunk's estimator hand-off: rate whatever Codeforces did not publish.
 *
 * Returns nothing on success. Unlike the gym platform there is no refusal here,
 * and that asymmetry is the point of splitting them: a gym with no visible
 * field will never have one, so it answers `unavailable`, while an official
 * round whose field could not be measured is a transient failure that
 * `contest-manager.js` handles under its general gap policy.
 */
export async function fill({ contest, context, session, onProgress = () => {} }) {
  const { service } = session;
  const { standings } = context;

  const needsEstimate = contest.problems.filter((problem) => problem.rating === null);
  if (needsEstimate.length === 0) return;

  onProgress("Measuring the field…");

  // `standings` is the response `problems.js` already fetched for the roster,
  // carried here in `context`. It is what the field falls back to when
  // `ratingChanges` is empty, and passing it rather than re-fetching removes a
  // second ~8.5 MB request.
  const distribution = await getOfficialRatingDist(
    service,
    contest.id,
    standings,
    onProgress,
  );

  console.log(
    `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
      `representing ~${Math.round(
        distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
      )}.`,
  );

  if (distributionSize(distribution) === 0) return;

  onProgress("Estimating problem ratings…");
  needsEstimate.forEach((problem) => {
    problem.rating = estimateProblemRating(distribution, problem.officialSolves);
    if (problem.rating !== null) problem.ratingSource = "estimated";
  });
}
