import { computeTeamRating } from "../../rating-models/team-rating.js";
import { fullField } from "../../rating-models/rating-distribution.js";

export async function getGymRatingDist(sources, contestId, standings = null) {
  // Gym standings arrive whole from the API, so there's nothing to sample.
  //
  // `standings` lets the caller hand over a response it already paid for.
  // `solve-stats.js` fetches exactly this to count gym solves, so estimating
  // afterwards used to fetch it a second time — one extra throttled API call,
  // per gym add, for bytes already in memory. Optional rather than required:
  // the hidden-standings path has no such response to pass, and neither does a
  // caller that only wants the field.
  return fullField(await getRatingsFromStandings(sources, contestId, standings));
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
 * @param {CodeforcesService} sources
 * @param {string[][]} partyHandles - member handles, one array per party
 */
export async function getGymRatingDistFromParties(sources, partyHandles) {
  if (!partyHandles?.length) return fullField([]);

  try {
    return fullField(await ratePartyList(sources, partyHandles));
  } catch (error) {
    console.warn(
      `[Rating Dist] Submission-derived field failed:`,
      error.message,
    );
    return fullField([]);
  }
}

/**
 * Handles to one effective rating per party.
 *
 * Shared by both gym paths so they can't drift: the standings path reads the
 * parties off standings.rows, the hidden-standings path off contest.status.
 * Duplicated verbatim in `codeforces-official/field.js` too, for the sampled
 * official field. Change one copy and you must change the other.
 */
async function ratePartyList(sources, parties) {
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
      const usersInfo = await sources.getUsersInfo(
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

async function getRatingsFromStandings(sources, contestId, prefetched = null) {
  try {
    const standings = prefetched ?? (await sources.getContestStandings(contestId));

    if (!standings?.rows?.length) {
      console.warn(
        `[Rating Dist] Standings API returned empty for ${contestId}.`,
      );
      return [];
    }

    return ratePartyList(
      sources,
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
