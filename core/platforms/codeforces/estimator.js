/**
 * Codeforces' difficulty estimate.
 *
 * Moved here from `core/rating-estimator.js`, which sat in shared space while
 * having exactly one importer — this platform. It named no platform, so
 * `module-boundaries.test.js` could not see it: the same shape as the old
 * `start-time-service.js`, except that one at least had a genuinely shared
 * export to justify its position. The maths it used to hold is now
 * `core/rating-models/rasch.js`, which both platforms share; what stays here is
 * the part that is Codeforces' alone — its scale and its post-processing.
 *
 * ## The known bias, recorded so it is not rediscovered
 *
 * Estimates run below Codeforces' published ratings, by up to ~300 on the
 * hardest problems, because the Elo model assumes everyone attempted every
 * problem when most never open the hard ones. "Model attempts, not ability" was
 * the suggested fix and was measured to be worse — mean absolute error 213 → 374.
 * `tests/estimator-accuracy.test.js` holds the numbers and the six other levers
 * that were tried and rejected.
 */
import { fitDifficulty } from "../../rating-models/rasch.js";
import {
  getOfficialRatingDist,
  getGymRatingDist,
  getGymRatingDistFromParties,
  distributionSize,
} from "./rating-distribution.js";
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
 * something the generic gap policy cannot. Those two refusals are facts about
 * Codeforces, not policy — `contest-manager.js` still owns the general rule
 * about what an unrated problem means.
 */
export async function fill({ contest, context, session, onProgress = () => {} }) {
  const { service } = session;
  const { type, subtype, solveCountsRead, partyHandles, standings } = context;

  const needsEstimate = contest.problems.filter((problem) => problem.rating === null);

  // **Unreachable on both paths now, and kept deliberately.** It guarded against
  // an unparseable "Accepted" totals row on the scraped official standings —
  // but official contests read `contest.standings` and have no totals row to
  // misparse, and the gym path has always set `solveCountsRead: true`
  // unconditionally. It stays because the alternative is estimating from counts
  // that were never read, which invents ratings silently; if a future source
  // can fail to produce counts, this is where it must say so.
  if (needsEstimate.length > 0 && !solveCountsRead) {
    return unavailable(
      `Couldn't read the solve counts for ${type} ${contest.id}, and ${needsEstimate.length} ` +
        `problem(s) have no published rating to fall back on.`,
    );
  }

  if (needsEstimate.length > 0) {
    await estimateMissingRatings({
      contestId: contest.id,
      type,
      service,
      needsEstimate,
      partyHandles,
      standings,
      onProgress,
    });
  }

  // A gym reaching here with gaps has no measurable field and never will —
  // private or empty standings do not become visible later. Naming that fact
  // is what removed the need for a per-platform waiting policy: it used to be
  // approximated by asking whether the subtype was a gym.
  const stillMissing = contest.problems.filter((problem) => problem.rating === null);
  if (stillMissing.length > 0 && subtype === "GYM") {
    return unavailable(
      `Couldn't rate ${type} ${contest.id}: its participants aren't visible, so ` +
        `there is no field to measure against.`,
    );
  }
}

async function estimateMissingRatings({
  contestId,
  type,
  service,
  needsEstimate,
  partyHandles = null,
  standings = null,
  onProgress,
}) {
  onProgress("Measuring the field…");

  let distribution = { strata: [] };
  if (partyHandles) {
    // A gym whose standings are hidden: contest.standings answers FAILED, so
    // the field was recovered from who submitted instead.
    distribution = await getGymRatingDistFromParties(service, partyHandles);
  } else if (type === "contest") {
    // `standings` is the response `problems.js` already fetched for the roster,
    // carried here in `context` — the same trick the gym path uses. It is what
    // the field falls back to when `ratingChanges` is empty, and passing it
    // rather than re-fetching removes a second ~8.5 MB request.
    distribution = await getOfficialRatingDist(service, contestId, standings, onProgress);
  } else {
    // The gym path: `solve-stats.js` already fetched this response to count
    // solves, so reuse it rather than paying for the same call twice.
    distribution = await getGymRatingDist(service, contestId, standings);
  }

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
