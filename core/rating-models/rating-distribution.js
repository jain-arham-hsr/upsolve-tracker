/**
 * The shape a fitted field arrives in, and the two operations on it.
 *
 * `rasch.js` consumes strata; this says what they are. It sits here rather than
 * beside either Codeforces platform for the reason `team-rating.js` gives: the
 * two build their fields with separate code in two folders that deliberately do
 * not import each other, so a definition either one owned would be a definition
 * the other had to copy. It was copied, byte for byte, until this file existed.
 *
 * Nothing here knows a platform. AtCoder's estimator fits abilities directly and
 * has no strata, which is why it does not import this — a field that is always
 * read whole has nothing to scale up from.
 */

/**
 * A rating distribution the estimator can work from, as one or more strata.
 *
 * Each stratum's `scale` is how many real competitors one of its members
 * stands for: 1 where the whole group was read, higher where it was sampled.
 * Expected solve counts are weighted by it, so a partially-read field answers
 * as if it had been read whole.
 *
 * @typedef {{ strata: Array<{ratings: number[], scale: number}> }} RatingDistribution
 */

/** Every competitor read, at scale 1 — nothing was sampled. */
export const fullField = (ratings) => ({ strata: [{ ratings, scale: 1 }] });

/** Total competitors represented, sampled or not. */
export function distributionSize(distribution) {
  return (distribution?.strata ?? []).reduce(
    (sum, { ratings }) => sum + ratings.length,
    0,
  );
}
