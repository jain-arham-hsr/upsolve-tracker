/**
 * Collapsing a team into the one rating that behaves like it.
 *
 * An ICPC-style contest is entered by teams, but every model here is written in
 * terms of *a* competitor's ability. So a team of three needs a single number
 * standing in for it, and the honest choice is the rating at which a lone
 * competitor would be as likely to fail a problem as the team is.
 *
 *   ∏ 1 / (1 + 10^((rᵢ − R) / 400)) = 0.5
 *
 * Each factor is one member's probability of *not* solving against ability R,
 * under the same logistic the Rasch fit uses; their product is the team's. The
 * left side falls monotonically in R, so a binary search converges. Note this
 * lands **above** the strongest member, which is the point: three 1500s solve
 * more than one 1500 does.
 *
 * ## Why this is here rather than beside its caller
 *
 * It is pure maths over ratings, which is what `rating-models/` holds — and it
 * has to stay in one place for a sharper reason than tidiness. Codeforces is two
 * platforms in two folders, and their fields are built by separate code: a gym's
 * from `contest.standings` or from who submitted, an official round's from
 * sampled standings rows. Team collapsing is the one step they genuinely share,
 * and two copies of a binary search are two things free to drift into
 * disagreeing about what a team is worth.
 *
 * `mean` and `max` were both tried as cheaper substitutes and measured worse;
 * `tests/platforms/codeforces/estimator-accuracy.test.js` records the numbers so neither is retried.
 *
 * @param {number[]} memberRatings
 * @returns {number} the effective team rating, rounded.
 */
export function computeTeamRating(memberRatings) {
  if (memberRatings.length === 1) return memberRatings[0];

  let low = -1000;
  let high = 4000;

  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const teamLossProbability = memberRatings.reduce(
      (product, rating) => product * (1 / (1 + Math.pow(10, (rating - mid) / 400))),
      1,
    );
    if (teamLossProbability > 0.5) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return Math.round(high);
}
