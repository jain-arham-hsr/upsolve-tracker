/**
 * Codeforces' difficulty estimate, shared by both Codeforces platforms.
 *
 * The maths is `core/rating-models/rasch.js`, shared with AtCoder. What is
 * Codeforces' alone is the scale, the rounding and the floor, and the fact
 * that both platforms fit the same quantity — in-contest solves against a
 * field of pre-contest ratings — whichever way that field was read.
 *
 * Pure: the field arrives from each platform's `readField`, and nothing here
 * fetches. The sampling maths that decides *which* standings rows an official
 * field is measured from lives here for the same reason — it is pure, and it
 * is what the fit runs against. `tests/platforms/codeforces/estimator-accuracy.test.js` records the known bias — up to
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

// ---------------------------------------------------------------------------
// Sampling: which standings rows the field is built from.
//
// Pure maths with no I/O: it decides which of the rows already in hand get
// resolved through `user.info`, so it lives beside its only caller.
// ---------------------------------------------------------------------------

/**
 * Characterising an official contest's field without rating all of it.
 *
 * ## Why sample at all, when the whole field is in hand
 *
 * `contest.standings` returns every row, so the *rows* are free. What is not
 * free is turning them into ratings: that costs one `user.info` call per 250
 * handles, each throttled. A Div. 3 with 15,000 entrants is ~60 throttled calls
 * — two minutes — where a sample of ~1,500 is seven.
 *
 * ## Why these strata, and not something simpler
 *
 * Standings are **rank-ordered**, so a contiguous block of rows is a narrow
 * band of near-identical ratings rather than a random slice. Picking blocks at
 * random is cluster sampling with near-total intra-cluster correlation — 20
 * blocks of 50 behaves like 20 draws, not 1,000 — and estimates land 400–800
 * points off. Spreading them evenly fixes the variance but biases estimates
 * *downward*, because a random start offset can skip the very top of the field,
 * and hard problems are decided almost entirely by the strongest few.
 *
 *   HEAD - the strongest competitors, taken in full. Small, but it decides the
 *          hard problems: when three people solve something, the answer rests
 *          entirely on how strong those three were.
 *   TAIL - everyone else, sampled at even intervals down the rank order, which
 *          covers the whole spread instead of clumping.
 *
 * **Do not replace this with a uniform random sample.** It was tried and
 * measured; `tests/platforms/codeforces/estimator.sampling.test.js` reproduces the failure so the rejected
 * design cannot quietly come back.
 *
 * ## This used to read paginated HTML
 *
 * The strata are unchanged; only the source is. It fetched ~32 standings
 * *pages* over the throttled HTML client and parsed handles out of each, which
 * is why it carried a page-count guard, a partial-last-page measurement and a
 * walk-every-page fallback — all of them consequences of pagination rather than
 * of sampling. Reading the rows the API already returned removes every one of
 * them, removes the last Cloudflare-exposed request on the official path, and
 * costs nothing extra: `fetchContest` fetches that response for the roster
 * regardless and now passes it along.
 *
 * `BLOCK` is still 50 because that is what a standings page held, and the
 * accuracy fixtures were captured against those block boundaries.
 */
const BLOCK = 50;
const HEAD_BLOCKS = 10;
const TAIL_BLOCKS = 20;

/**
 * @param {object[]} rows - `contest.standings`' rows, in rank order.
 * @returns {{ groups: Array<{parties: string[][], scale: number}>, total: number }}
 *   Each group's `scale` is how many real competitors one of its members stands
 *   for. A field small enough to take whole comes back as one group at scale 1.
 */
export function stratifyRows(rows) {
  const parties = (rows ?? []).map((row) =>
    (row?.party?.members ?? []).map((member) => member.handle).filter(Boolean),
  );

  if (parties.length === 0) return { groups: [], total: 0 };

  const blockCount = Math.ceil(parties.length / BLOCK);

  // Small enough that sampling would save nothing worth the loss of precision.
  if (blockCount <= HEAD_BLOCKS + TAIL_BLOCKS) {
    return { groups: [{ parties, scale: 1 }], total: parties.length };
  }

  const head = parties.slice(0, HEAD_BLOCKS * BLOCK);
  const tail = spreadPages(HEAD_BLOCKS + 1, blockCount, TAIL_BLOCKS).flatMap((block) =>
    parties.slice((block - 1) * BLOCK, block * BLOCK),
  );

  return {
    groups: [
      { parties: head, scale: 1 },
      { parties: tail, scale: (parties.length - head.length) / tail.length },
    ],
    total: parties.length,
  };
}

/**
 * Evenly spaced block numbers across [from, to], taken at interval midpoints so
 * the sample doesn't lean toward either end of the range.
 *
 * Still named for pages, and still exported, because `tests/platforms/codeforces/estimator.sampling.test.js`
 * is written against it directly: the accuracy claim this file rests on is only
 * meaningful if the spread is genuinely even.
 */
export function spreadPages(from, to, count) {
  const span = to - from + 1;
  if (span <= count) {
    return Array.from({ length: span }, (_, i) => from + i);
  }

  const step = span / count;
  const pages = new Set();
  for (let i = 0; i < count; i++) {
    pages.add(from + Math.min(span - 1, Math.floor(i * step + step / 2)));
  }
  return [...pages].sort((a, b) => a - b);
}
