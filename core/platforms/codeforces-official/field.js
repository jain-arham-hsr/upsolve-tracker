/**
 * The official field: pre-contest ratings for everyone who entered.
 *
 * Two sources, in order of directness. `contest.ratingChanges` carries the
 * whole field's `oldRating` in one request. When a round is not rated yet —
 * the freshly finished contest you most want to upsolve — the standings rows
 * the add already holds are stratified and resolved through `user.info`; see
 * the sampling section below for why it samples when every row is in hand.
 */
import { fullField, distributionSize } from "../../rating-models/rating-distribution.js";
import { ratePartyList } from "../codeforces/field.js";

/**
 * @returns {Promise<object|null>} the distribution, or null when there was
 *   nothing to measure — a transient failure the general gap policy handles,
 *   unlike a gym's, which is permanent.
 */
export async function readField({ contest, context, session, onProgress = () => {} }) {
  onProgress("Measuring the field…");

  const distribution = await getOfficialRatingDist(
    session.sources,
    contest.id,
    // Fetched for the roster and carried here, so the field is measured from
    // rows already in memory rather than a second ~8.5 MB request.
    context.standings,
    onProgress,
  );

  console.log(
    `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
      `representing ~${Math.round(
        distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
      )}.`,
  );

  return distributionSize(distribution) === 0 ? null : distribution;
}

async function getOfficialRatingDist(sources, contestId, standings, onProgress) {
  try {
    const ratingChanges = await sources.getContestRatingChanges(contestId);
    if (ratingChanges?.length > 0) {
      return fullField(ratingChanges.map((user) => user.oldRating));
    }
  } catch (error) {
    console.warn(`[Rating Dist] ratingChanges failed for ${contestId}:`, error.message);
  }

  console.warn(`[Rating Dist] ratingChanges empty for ${contestId}. Falling back to standings.`);
  return sampleOfficialStandings(sources, standings, onProgress);
}

async function sampleOfficialStandings(sources, standings, onProgress) {
  try {
    const { groups, total } = stratifyRows(standings?.rows);
    if (groups.length === 0) {
      console.warn("[Rating Dist] Standings carried no rows to sample.");
      return fullField([]);
    }

    onProgress("Looking up competitor ratings…");

    // One lookup pass over every sampled party, then split back into strata,
    // so the rate-limited `user.info` chunking does not happen twice.
    const rated = await ratePartyList(sources, groups.flatMap((group) => group.parties));

    let offset = 0;
    const strata = [];
    for (const group of groups) {
      const ratings = rated.slice(offset, offset + group.parties.length);
      offset += group.parties.length;
      if (ratings.length > 0) strata.push({ ratings, scale: group.scale });
    }

    console.log(
      `[Rating Dist] Rated ${rated.length} of ~${total} participants across ${strata.length} stratum/strata.`,
    );

    return strata.length > 0 ? { strata } : fullField([]);
  } catch (error) {
    console.warn(`[Rating Dist] Standings sampling failed:`, error.message);
    return fullField([]);
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
 * measured; `tests/sampling.test.js` reproduces the failure so the rejected
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
 * costs nothing extra: `problems.js` fetches that response for the roster
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
 * Still named for pages, and still exported, because `tests/sampling.test.js`
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
