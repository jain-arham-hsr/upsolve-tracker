/**
 * Codeforces' difficulty estimate, gym half.
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
import {
  getGymRatingDist,
  getGymRatingDistFromParties,
  distributionSize,
} from "./field.js";
import { unavailable } from "../../contest-status.js";

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
 * Returns nothing on success, or a `contest-status` when this platform can say
 * something the generic gap policy cannot. That refusal is a fact about gyms,
 * not policy — `contest-manager.js` still owns the general rule about what an
 * unrated problem means.
 */
export async function fill({ contest, context, session, onProgress = () => {} }) {
  const { service } = session;
  const { solveCountsRead, partyHandles, standings } = context;

  const needsEstimate = contest.problems.filter((problem) => problem.rating === null);

  // **Unreachable, and kept deliberately.** `solve-stats.js` sets
  // `solveCountsRead: true` unconditionally, because gym counts come from the
  // API rather than a parsed totals row. It stays because the alternative is
  // estimating from counts that were never read, which invents ratings
  // silently; if a future source can fail to produce counts, this is where it
  // must say so.
  if (needsEstimate.length > 0 && !solveCountsRead) {
    return unavailable(
      `Couldn't read the solve counts for gym ${contest.id}, and ${needsEstimate.length} ` +
        `problem(s) have no published rating to fall back on.`,
    );
  }

  if (needsEstimate.length > 0) {
    onProgress("Measuring the field…");

    // A gym's whole field arrives in one response, so there is nothing to
    // sample — the official platform's stratification has no counterpart here.
    const distribution = partyHandles
      ? // Standings hidden: contest.standings answers FAILED, so the field was
        // recovered from who submitted instead.
        await getGymRatingDistFromParties(service, partyHandles)
      : // `solve-stats.js` already fetched this response to count solves, so
        // reuse it rather than paying for the same call twice.
        await getGymRatingDist(service, contest.id, standings);

    console.log(
      `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
        `representing ~${Math.round(
          distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
        )}.`,
    );

    if (distributionSize(distribution) > 0) {
      onProgress("Estimating problem ratings…");
      needsEstimate.forEach((problem) => {
        problem.rating = estimateProblemRating(distribution, problem.officialSolves);
        if (problem.rating !== null) problem.ratingSource = "estimated";
      });
    }
  }

  // A gap surviving all of that means no measurable field, and for a gym that
  // is **permanent** — private or empty standings do not become visible later.
  // Naming that fact is what removed the need for a per-platform waiting
  // policy: it used to be approximated by asking whether the subtype was a gym,
  // and the folder answers it now.
  if (contest.problems.some((problem) => problem.rating === null)) {
    return unavailable(
      `Couldn't rate gym ${contest.id}: its participants aren't visible, so ` +
        `there is no field to measure against.`,
    );
  }
}
