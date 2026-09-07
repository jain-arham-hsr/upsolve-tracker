/**
 * What CodeChef publishes about a problem, and re-asking for what it has not.
 *
 * The named counterpart to `codeforces-official/published-sync.js`, and the
 * same shape: a contest added before the site finished rating it stores `???`,
 * and this converges it. Both halves live here because they are one question —
 * `parseDifficulty` and `cleanTags` read the answer whether it arrives on the
 * first add or a week later, and a second reading of the same payload is
 * exactly how the two could disagree.
 *
 * The **practice-archive** re-check is deliberately not here, despite also
 * running from `syncMetadata`: it has a different cadence, a different cost
 * argument and writes in both directions. See `practice-flags.js`.
 */

import { CodeChefSources } from "../sources.js";

const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Asks CodeChef again about the problems it had not rated yet.
 *
 * Converges rather than settles once: a problem stored `???` gains its real
 * number on a later refresh, at which point the contest stops being asked
 * about at all. Costs a request per still-unrated problem, which is why it is
 * throttled to a week.
 *
 * @returns {number} problems updated. Nothing in production reads it; it exists
 *   so the tests can tell a real update from a no-op.
 */
export async function sync(session, contests, onProgress = () => {}) {
  const now = Date.now();
  let updated = 0;

  const stale = contests.filter(
    (contest) =>
      contest.problems.some((problem) => problem.rating === null) &&
      now - (contest.publishedDataCheckedAt ?? 0) > RECHECK_AFTER_MS,
  );
  if (stale.length === 0) return updated;

  for (const contest of stale) {
    for (const problem of contest.problems) {
      if (problem.rating !== null) continue;

      onProgress(`Re-checking ${problem.index}…`);
      try {
        const detail = await session.sources.problem(contest.id, problem.index);
        const rating = CodeChefSources.parseDifficulty(detail?.difficulty_rating);
        if (rating === null) continue;

        problem.rating = rating;
        problem.ratingSource = "official";
        problem.tags = CodeChefSources.cleanTags(detail, contest.id);
        updated++;
      } catch (error) {
        console.warn(`[CodeChef] re-check of ${problem.index} failed:`, error.message);
      }
    }
    contest.publishedDataCheckedAt = now;
  }

  return updated;
}
