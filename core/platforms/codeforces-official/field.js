import { computeTeamRating } from "../../rating-models/team-rating.js";
import { stratifyRows } from "./sampling.js";

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

const FULL_FIELD = (ratings) => ({ strata: [{ ratings, scale: 1 }] });

/** Total competitors represented, sampled or not. */
export function distributionSize(distribution) {
  return (distribution?.strata ?? []).reduce(
    (sum, { ratings }) => sum + ratings.length,
    0,
  );
}

/**
 * The official field: pre-contest ratings for everyone who entered.
 *
 * Two sources, in order of directness.
 *
 * 1. `contest.ratingChanges` — the whole field's `oldRating`, exactly the
 *    quantity wanted, in one request.
 * 2. The standings rows the caller already holds, stratified and resolved
 *    through `user.info`. Reached when a round is not rated yet, which is the
 *    freshly-finished contest you most want to upsolve. See `sampling.js` for
 *    why it samples at all when every row is in hand.
 *
 * The gym platform's equivalent has neither: a gym is never rated, so there are
 * no rating changes, and its field is small enough to take whole.
 *
 * @param {object} standings - a `getPublicContestStandings` response, passed in
 *   rather than fetched. `problems.js` reads it for the roster, so re-fetching
 *   here cost a second ~8.5 MB response for bytes already in memory.
 */
export async function getOfficialRatingDist(
  cfService,
  contestId,
  standings = null,
  onProgress = () => {},
) {
  try {
    const ratingChanges = await cfService.getContestRatingChanges(contestId);
    if (ratingChanges?.length > 0) {
      return FULL_FIELD(ratingChanges.map((user) => user.oldRating));
    }
  } catch (error) {
    console.warn(
      `[Rating Dist] ratingChanges failed for ${contestId}:`,
      error.message,
    );
  }

  console.warn(
    `[Rating Dist] ratingChanges empty for ${contestId}. Falling back to standings.`,
  );
  return sampleOfficialStandings(cfService, standings, onProgress);
}

async function sampleOfficialStandings(cfService, standings, onProgress) {
  try {
    const { groups, total } = stratifyRows(standings?.rows);
    if (groups.length === 0) {
      console.warn("[Rating Dist] Standings carried no rows to sample.");
      return FULL_FIELD([]);
    }

    onProgress("Looking up competitor ratings…");

    // One lookup pass over every sampled party, then split back into strata, so
    // the rate-limited `user.info` chunking does not happen twice.
    const rated = await ratePartyList(
      cfService,
      groups.flatMap((group) => group.parties),
    );

    let offset = 0;
    const strata = [];
    for (const group of groups) {
      const ratings = rated.slice(offset, offset + group.parties.length);
      offset += group.parties.length;
      if (ratings.length > 0) strata.push({ ratings, scale: group.scale });
    }

    console.log(
      `[Rating Dist] Rated ${rated.length} of ~${total} participants ` +
        `across ${strata.length} stratum/strata.`,
    );

    return strata.length > 0 ? { strata } : FULL_FIELD([]);
  } catch (error) {
    console.warn(`[Rating Dist] Standings sampling failed:`, error.message);
    return FULL_FIELD([]);
  }
}

/**
 * Handles to one effective rating per party.
 *
 * Duplicated verbatim in `codeforces-gyms/field.js`, which is where the two
 * gym paths use it — the standings one reading parties off standings.rows, the
 * hidden-standings one off contest.status. Here it serves the sampled official
 * field. Change one copy and you must change the other.
 */
async function ratePartyList(cfService, parties) {
  const allHandles = [
    ...new Set(parties.flat().filter(Boolean)),
  ];

  console.log(
    `[Rating Dist] Found ${allHandles.length} unique handles across ${parties.length} parties.`,
  );
  if (allHandles.length === 0) return [];

  const chunkSize = 250;
  const handleToRating = {};

  for (let i = 0; i < allHandles.length; i += chunkSize) {
    try {
      const usersInfo = await cfService.getUsersInfo(
        allHandles.slice(i, i + chunkSize),
      );
      usersInfo?.forEach((u) => {
        handleToRating[u.handle] = u.rating ?? 800;
      });
    } catch {
      console.warn(
        `[Rating Dist] Chunk ${Math.floor(i / chunkSize) + 1} rejected. Skipping.`,
      );
    }
  }

  // An unknown handle counts as 800 rather than dropping out, or a party
  // whose members all failed to resolve would collapse to the search's floor
  // and drag the whole field down with it.
  return parties.map((members) => {
    const ratings = members.map((handle) => handleToRating[handle] ?? 800);
    return computeTeamRating(ratings.length > 0 ? ratings : [800]);
  });
}
