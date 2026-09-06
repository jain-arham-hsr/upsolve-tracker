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
import { getProblem } from "../api.js";

/**
 * `difficulty_rating` arrives as a string and uses two out-of-band values:
 * `-1` for "not rated" (74% of the catalogue) and `9999` for a handful more.
 * Both must become null. `9999` is especially dangerous — it is also the
 * queue's own sort-last sentinel, so passing it through would look like a
 * legitimate, very hard problem.
 */
const NOT_RATED = new Set([-1, 9999]);

/** Setter handles and contest codes get tagged alongside real topics. */
const TAG_NOISE = /^(?:start|cook|ltime|snck)\d+$|_adm$/i;

export function parseDifficulty(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || NOT_RATED.has(value)) return null;
  return value;
}

export function cleanTags(detail, contestCode) {
  const raw = [...(detail?.user_tags ?? []), ...(detail?.computed_tags ?? [])];
  const seen = new Set();

  return raw.filter((tag) => {
    if (typeof tag !== "string") return false;
    const trimmed = tag.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === contestCode.toLowerCase()) return false;
    if (TAG_NOISE.test(trimmed)) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * How long a contest with unrated problems waits before being asked again.
 *
 * Costs a request per still-unrated problem, so it is throttled to a week —
 * the same shape as the Codeforces tag re-check. The practice re-check has
 * its own, much faster cadence and its own cost argument; see
 * `practice-flags.js`.
 */
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
export async function syncPublishedDifficulty(contests, onProgress = () => {}) {
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
        const detail = await getProblem(contest.id, problem.index);
        const rating = parseDifficulty(detail?.difficulty_rating);
        if (rating === null) continue;

        problem.rating = rating;
        problem.ratingSource = "official";
        problem.tags = cleanTags(detail, contest.id);
        updated++;
      } catch (error) {
        console.warn(`[CodeChef] re-check of ${problem.index} failed:`, error.message);
      }
    }
    contest.publishedDataCheckedAt = now;
  }

  return updated;
}
