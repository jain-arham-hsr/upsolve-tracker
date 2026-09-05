/**
 * Ordering a queue that spans several platforms.
 *
 * Raw ratings are not comparable across sites: a Codeforces 1600 and an
 * AtCoder 1600 are different difficulties expressed in different populations'
 * rating units. What *is* comparable is how likely you are to solve the thing.
 *
 * All three platforms define a problem's difficulty as roughly the rating at
 * which a contestant has a 50% chance of solving it in-contest — the same
 * quantity rating-models/rasch.js searches for. So feeding a problem's difficulty
 * and your rating *on that same platform* into the Elo curve cancels the scale
 * and leaves a unitless probability.
 *
 * This is common-person equating with a single anchor: you. That would be a
 * poor way to build a general conversion table, and a good way to order one
 * person's practice queue.
 */

/** The Elo constant. Approximately right on all three; exact on none. */
const ELO_DIVISOR = 400;

/**
 * @param {number|null} difficulty - the problem's rating, in its platform's units
 * @param {number|null} userRating - your rating on that same platform
 * @returns {number|null} probability in (0,1), or null when either input is
 *   unknown. Never a default: a guessed probability would sort like a real one.
 */
export function solveProbability(difficulty, userRating) {
  if (typeof difficulty !== "number" || typeof userRating !== "number") return null;
  if (!Number.isFinite(difficulty) || !Number.isFinite(userRating)) return null;

  return 1 / (1 + 10 ** ((difficulty - userRating) / ELO_DIVISOR));
}

/**
 * Comparator for queue rows, easiest first.
 *
 * Rows sort into three bands, because there are two distinct reasons a row can
 * lack a probability and they must not be conflated:
 *
 *   1. a known probability — ordered by it, descending
 *   2. rated, but your rating on that platform is unknown — ordered by the
 *      native rating, which at least means something within its own platform
 *   3. no published difficulty at all
 *
 * Ties break deterministically (platform, then contest, then index). Without
 * that the list reshuffles between renders, which reads as a bug.
 */
export function compareQueueItems(a, b) {
  const bandDiff = band(a) - band(b);
  if (bandDiff !== 0) return bandDiff;

  if (band(a) === 0) {
    const diff = b.solveProbability - a.solveProbability;
    if (Math.abs(diff) > 1e-9) return diff;
  } else if (band(a) === 1) {
    const diff = a.rating - b.rating;
    if (diff !== 0) return diff;
  }

  return breakTie(a, b);
}

function band(item) {
  if (typeof item.solveProbability === "number") return 0;
  if (typeof item.rating === "number") return 1;
  return 2;
}

function breakTie(a, b) {
  const platform = String(a.platform ?? "").localeCompare(String(b.platform ?? ""));
  if (platform !== 0) return platform;

  // Newer contests first, matching how the contest list is ordered.
  const left = a.startTimeSeconds ?? -Infinity;
  const right = b.startTimeSeconds ?? -Infinity;
  if (left !== right) return right - left;

  const contest = String(a.contestId ?? "").localeCompare(String(b.contestId ?? ""));
  if (contest !== 0) return contest;

  return String(a.index ?? "").localeCompare(String(b.index ?? ""));
}

/**
 * `~72%`, or an em dash when unknown. Coarse on purpose: it is a model.
 *
 * Clamped to 1–99. Plain rounding renders a 3500-rated problem as "~0%", which
 * is both demotivating and wrong — you are reading an upsolving queue, so the
 * point is that you *will* get there. It overclaims at the other end too:
 * "~100%" asserts a certainty no model has.
 *
 * Clamping only the extremes rather than rounding up throughout keeps every
 * value in between honest; a blanket ceiling would bias the whole column up by
 * as much as a point. **Ordering uses the raw probability**, so problems that
 * all display "~1%" still sort correctly among themselves.
 */
export function formatSolveProbability(probability) {
  if (typeof probability !== "number") return "—";

  const percent = Math.min(99, Math.max(1, Math.round(probability * 100)));
  return `~${percent}%`;
}

/**
 * Contests, newest first, with unknown start times sinking to the bottom
 * rather than being treated as ancient.
 *
 * Lives here rather than beside the Codeforces code that *fetches* start
 * times, because comparing epoch seconds is the one part of that file which
 * was never Codeforces' own — and being the sole shared export was what kept
 * a wholly-Codeforces module looking like shared infrastructure.
 */
export function byStartTimeDesc(a, b) {
  const left = a.startTimeSeconds ?? null;
  const right = b.startTimeSeconds ?? null;

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}
