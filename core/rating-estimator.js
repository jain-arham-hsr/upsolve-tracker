/**
 * core/rating-estimator.js
 */

function getProbability(userRating, problemRating) {
  return 1.0 / (1.0 + Math.pow(10, (problemRating - userRating) / 400.0));
}

/**
 * Expected solves across the whole field.
 *
 * Each stratum is weighted by its scale, which carries a sampled group back up
 * to the size it represents: summing over a tenth of a group and multiplying
 * by ten estimates the same total, because expectation is linear. Strata read
 * in full carry a scale of 1 and so contribute exactly.
 */
function getExpectedSolves(strata, candidateRating) {
  return strata.reduce((total, { ratings, scale }) => {
    const stratumSum = ratings.reduce((sum, userRating) => {
      return sum + getProbability(userRating, candidateRating);
    }, 0);
    return total + stratumSum * scale;
  }, 0);
}

/**
 * Performs a binary search to find the rating R such that the expected
 * number of solves matches the actual number of official solves.
 * Rounds to the nearest 100 and enforces a minimum of 800.
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

  // If nobody solved it, we don't aim for 0 (which is mathematically impossible).
  // We aim for 0.5 expected solves—the "Threshold of Failure" for this room.
  const targetSolves = actualSolves === 0 ? 0.5 : actualSolves;

  let low = 0;
  let high = 4000;

  for (let i = 0; i < 25; i++) {
    let mid = (low + high) / 2.0;
    let expected = getExpectedSolves(strata, mid);

    // We now compare against our targetSolves
    if (expected > targetSolves) {
      low = mid;
    } else {
      high = mid;
    }
  }

  let roundedRating = Math.round(low / 100) * 100;
  return Math.max(800, roundedRating);
}
