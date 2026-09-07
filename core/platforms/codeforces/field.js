/**
 * What both Codeforces fields share: turning parties into ratings.
 *
 * Each platform's `field.js` decides *which* parties — an official round's
 * from `ratingChanges` or sampled standings rows, a gym's from its whole
 * standings or from who submitted — and hands them here. Everything below the
 * handles is one path, so the two cannot drift: the same `user.info` chunking,
 * the same team collapsing, the same strata shape.
 */
import { computeTeamRating } from "../../rating-models/team-rating.js";

const CHUNK = 250;

/**
 * Handles to one effective rating per party.
 *
 * @param {import("./sources.js").CodeforcesSources} sources
 * @param {string[][]} parties - member handles, one array per party
 * @returns {Promise<number[]>} one rating per party, in order
 */
export async function ratePartyList(sources, parties) {
  const allHandles = [...new Set(parties.flat().filter(Boolean))];

  console.log(`[Codeforces] Found ${allHandles.length} unique handles across ${parties.length} parties.`);
  if (allHandles.length === 0) return [];

  const handleToRating = {};
  for (let i = 0; i < allHandles.length; i += CHUNK) {
    try {
      const usersInfo = await sources.usersInfo(allHandles.slice(i, i + CHUNK));
      usersInfo?.forEach((u) => {
        handleToRating[u.handle] = u.rating ?? 800;
      });
    } catch {
      console.warn(`[Codeforces] Chunk ${Math.floor(i / CHUNK) + 1} rejected. Skipping.`);
    }
  }

  // An unknown handle counts as 800 rather than dropping out, or a party whose
  // members all failed to resolve would collapse to the search's floor and drag
  // the whole field down with it.
  return parties.map((members) => {
    const ratings = members.map((handle) => handleToRating[handle] ?? 800);
    return computeTeamRating(ratings.length > 0 ? ratings : [800]);
  });
}
