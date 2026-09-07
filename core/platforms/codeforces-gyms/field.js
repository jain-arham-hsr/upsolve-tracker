/**
 * A gym's field, which arrives whole: 5–76 parties in one `contest.standings`
 * response, so there is nothing to sample — and far too few to sample from,
 * which is why a gym estimate is so much noisier than an official one.
 *
 * When the standings are hidden the field is recovered from who submitted,
 * through the party handles `sources.js` read off `contest.status`. That field
 * is narrower — only parties that submitted at least once — but a party that
 * entered and submitted nothing solved nothing either, so the counts stay
 * consistent with it.
 */
import { fullField, distributionSize } from "../../rating-models/rating-distribution.js";
import { unavailable } from "../../contest-status.js";
import { ratePartyList } from "../codeforces/field.js";

/**
 * @returns {Promise<object>} the distribution, or `unavailable` — a gym with
 *   no measurable field never gains one, so it refuses rather than waits.
 */
export async function readField({ contest, context, session, onProgress = () => {} }) {
  const { solveCountsRead, partyHandles, standings } = context;
  const gaps = contest.problems.filter((problem) => problem.rating === null).length;

  // Unreachable today — gym counts come from the API, not a parsed totals
  // row — and kept deliberately: the alternative is estimating from counts
  // that were never read, which invents ratings silently.
  if (!solveCountsRead) {
    return unavailable(
      `Couldn't read the solve counts for gym ${contest.id}, and ${gaps} ` +
        `problem(s) have no published rating to fall back on.`,
    );
  }

  onProgress("Measuring the field…");

  const distribution = partyHandles
    ? await fromParties(session.sources, partyHandles)
    : await fromStandings(session.sources, contest.id, standings);

  console.log(
    `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
      `representing ~${Math.round(
        distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
      )}.`,
  );

  // Permanent: private or empty standings do not become visible later.
  if (distributionSize(distribution) === 0) {
    return unavailable(
      `Couldn't rate gym ${contest.id}: its participants aren't visible, so ` +
        `there is no field to measure against.`,
    );
  }

  return distribution;
}

/** `standings` is the response the add already paid for; the hidden path has none. */
async function fromStandings(sources, contestId, prefetched) {
  try {
    const standings = prefetched ?? (await sources.getContestStandings(contestId));

    if (!standings?.rows?.length) {
      console.warn(`[Rating Dist] Standings API returned empty for ${contestId}.`);
      return fullField([]);
    }

    return fullField(
      await ratePartyList(
        sources,
        standings.rows.map((row) => row.party.members.map((m) => m.handle)),
      ),
    );
  } catch (error) {
    console.warn(`[Rating Dist] Standings method failed for ${contestId}:`, error.message);
    return fullField([]);
  }
}

async function fromParties(sources, partyHandles) {
  if (!partyHandles?.length) return fullField([]);

  try {
    return fullField(await ratePartyList(sources, partyHandles));
  } catch (error) {
    console.warn(`[Rating Dist] Submission-derived field failed:`, error.message);
    return fullField([]);
  }
}
