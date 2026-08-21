import { sampleParticipantHandles } from "./services/scraping-service.js";

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

export async function getOfficialRatingDist(
  cfService,
  contestId,
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
  return sampleOfficialStandings(cfService, contestId, onProgress);
}

async function sampleOfficialStandings(cfService, contestId, onProgress) {
  try {
    const { groups } = await sampleParticipantHandles(contestId, onProgress);
    if (groups.length === 0) return FULL_FIELD([]);

    onProgress("Looking up competitor ratings…");

    // One lookup pass over every handle, then split back into strata, so the
    // rate-limited chunking doesn't happen twice.
    const allHandles = groups.flatMap((group) => group.handles);
    const byHandle = await lookupRatings(cfService, allHandles);

    const strata = groups
      .map(({ handles, scale }) => ({
        ratings: handles.map((handle) => byHandle.get(handle) ?? 800),
        scale,
      }))
      .filter((stratum) => stratum.ratings.length > 0);

    return strata.length > 0 ? { strata } : FULL_FIELD([]);
  } catch (error) {
    console.warn(
      `[Rating Dist] Standings sampling failed for ${contestId}:`,
      error.message,
    );
    return FULL_FIELD([]);
  }
}

/**
 * Resolves handles to ratings in chunks, spaced to stay inside the API's rate
 * limit. Unrated accounts count as 800, the floor Codeforces itself uses.
 *
 * @returns {Promise<Map<string, number>>}
 */
async function lookupRatings(cfService, handles) {
  const chunkSize = 250;
  const handleToRating = new Map();
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  for (let i = 0; i < handles.length; i += chunkSize) {
    try {
      const usersInfo = await cfService.getUsersInfo(
        handles.slice(i, i + chunkSize),
      );
      usersInfo?.forEach((user) => {
        handleToRating.set(user.handle, user.rating ?? 800);
      });
    } catch {
      console.warn(
        `[Rating Dist] Chunk ${Math.floor(i / chunkSize) + 1} rejected. Skipping.`,
      );
    }
    if (i + chunkSize < handles.length) await delay(2000);
  }

  return handleToRating;
}

export async function getGymRatingDist(cfService, contestId) {
  // Gym standings arrive whole from the API, so there's nothing to sample.
  return FULL_FIELD(await getRatingsFromStandings(cfService, contestId));
}

async function getRatingsFromStandings(cfService, contestId) {
  try {
    const standings = await cfService.getContestStandings(contestId);

    if (!standings?.rows?.length) {
      console.warn(
        `[Rating Dist] Standings API returned empty for ${contestId}.`,
      );
      return [];
    }

    // Collect all unique handles across all teams
    const allHandles = [
      ...new Set(
        standings.rows.flatMap((row) =>
          row.party.members.map((m) => m.handle).filter(Boolean),
        ),
      ),
    ];

    console.log(
      `[Rating Dist] Found ${allHandles.length} unique handles in standings.`,
    );
    if (allHandles.length === 0) return [];

    // Fetch ratings for all handles in chunks
    const chunkSize = 250;
    const handleToRating = {};
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

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
      if (i + chunkSize < allHandles.length) await delay(2000);
    }

    // Compute one team rating per row using the CF team rating formula
    return standings.rows.map((row) => {
      const memberRatings = row.party.members.map(
        (m) => handleToRating[m.handle] ?? 800,
      );
      return computeTeamRating(memberRatings);
    });
  } catch (error) {
    console.warn(
      `[Rating Dist] Standings method failed for ${contestId}:`,
      error.message,
    );
    return [];
  }
}

/**
 * Computes the effective team rating R_team such that the product of each
 * member's loss probability against R_team equals 0.5.
 * Uses binary search to solve: ∏ 1/(1 + 10^((r_i - R_team)/400)) = 0.5
 */
function computeTeamRating(memberRatings) {
  if (memberRatings.length === 1) return memberRatings[0];

  let low = -1000;
  let high = 4000;

  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const teamLossProbability = memberRatings.reduce(
      (product, r) => product * (1 / (1 + Math.pow(10, (r - mid) / 400))),
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
