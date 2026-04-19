import { scrapeParticipantHandles } from "./services/scraping-service";

export async function getOfficialRatingDist(cfService, contestId) {
  try {
    const ratingChanges = await cfService.getContestRatingChanges(contestId);
    if (ratingChanges?.length > 0) {
      return ratingChanges.map((user) => user.oldRating);
    }
  } catch (error) {
    console.warn(
      `[Rating Dist] ratingChanges failed for ${contestId}:`,
      error.message,
    );
  }

  console.warn(
    `[Rating Dist] ratingChanges empty for ${contestId}. Falling back to standings scrape.`,
  );
  return scrapeOfficialStandings(cfService, contestId);
}

async function scrapeOfficialStandings(cfService, contestId) {
  try {
    const handles = await scrapeParticipantHandles(contestId);
    if (handles.length === 0) return [];

    const chunkSize = 250;
    const handleToRating = {};
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    for (let i = 0; i < handles.length; i += chunkSize) {
      try {
        const usersInfo = await cfService.getUsersInfo(
          handles.slice(i, i + chunkSize),
        );
        usersInfo?.forEach((u) => {
          handleToRating[u.handle] = u.rating ?? 800;
        });
      } catch {
        console.warn(
          `[Rating Dist] Chunk ${Math.floor(i / chunkSize) + 1} rejected. Skipping.`,
        );
      }
      if (i + chunkSize < handles.length) await delay(2000);
    }

    return handles.map((handle) => handleToRating[handle] ?? 800);
  } catch (error) {
    console.warn(
      `[Rating Dist] Standings scrape failed for ${contestId}:`,
      error.message,
    );
    return [];
  }
}

export async function getGymRatingDist(cfService, contestId) {
  return getRatingsFromStandings(cfService, contestId);
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
