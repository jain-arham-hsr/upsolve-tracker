import { computeTeamRating } from "../../rating-models/team-rating.js";

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

export async function getGymRatingDist(cfService, contestId, standings = null) {
  // Gym standings arrive whole from the API, so there's nothing to sample.
  //
  // `standings` lets the caller hand over a response it already paid for.
  // `solve-stats.js` fetches exactly this to count gym solves, so estimating
  // afterwards used to fetch it a second time — one extra throttled API call,
  // per gym add, for bytes already in memory. Optional rather than required:
  // the hidden-standings path has no such response to pass, and neither does a
  // caller that only wants the field.
  return FULL_FIELD(await getRatingsFromStandings(cfService, contestId, standings));
}

/**
 * The same distribution, for a gym whose standings Codeforces has hidden.
 *
 * Those answer FAILED to contest.standings, so the field has to be recovered
 * from who submitted — see contest-submissions.js. Everything
 * downstream of the handles is identical to the standings path, deliberately:
 * same user.info chunking, same team collapsing, same strata shape.
 *
 * Note this field is narrower than a standings one, since it can only see
 * parties that submitted at least once. A party that entered and submitted
 * nothing solved nothing either, so the solve counts stay consistent with it.
 *
 * @param {CodeforcesService} cfService
 * @param {string[][]} partyHandles - member handles, one array per party
 */
export async function getGymRatingDistFromParties(cfService, partyHandles) {
  if (!partyHandles?.length) return FULL_FIELD([]);

  try {
    return FULL_FIELD(await ratePartyList(cfService, partyHandles));
  } catch (error) {
    console.warn(
      `[Rating Dist] Submission-derived field failed:`,
      error.message,
    );
    return FULL_FIELD([]);
  }
}

/**
 * Handles to one effective rating per party.
 *
 * Shared by both gym paths so they can't drift; the standings path reads the
 * parties off standings.rows, the hidden-standings path off contest.status.
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

async function getRatingsFromStandings(cfService, contestId, prefetched = null) {
  try {
    const standings = prefetched ?? (await cfService.getContestStandings(contestId));

    if (!standings?.rows?.length) {
      console.warn(
        `[Rating Dist] Standings API returned empty for ${contestId}.`,
      );
      return [];
    }

    return ratePartyList(
      cfService,
      standings.rows.map((row) => row.party.members.map((m) => m.handle)),
    );
  } catch (error) {
    console.warn(
      `[Rating Dist] Standings method failed for ${contestId}:`,
      error.message,
    );
    return [];
  }
}
