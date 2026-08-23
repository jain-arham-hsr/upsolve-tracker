/**
 * Tag counting for the stats view. Fetching tags is problemset-sync.js's job.
 */

/**
 * Counts tag occurrences across the pending problems of the given contests.
 * A problem with three tags contributes to three counts.
 *
 * @param {object[]} contests
 * @param {{ min: number, max: number }} [range] - Inclusive rating bounds.
 *   Unrated problems can't be placed on the scale, so they drop out whenever
 *   a range is supplied; pass nothing to count everything.
 * @returns {{ tag: string, count: number }[]} Sorted by count, then name.
 */
export function countPendingTags(contests, range = null) {
  const counts = new Map();

  contests.forEach((contest) => {
    contest.problems.forEach((prob) => {
      if (prob.solved) return;
      // This walks contests directly rather than going through
      // collectPendingProblems, so it has to repeat that filter itself — or the
      // bars would count problems the coverage line above them has excluded.
      if (prob.upsolvable === false) return;
      if (range) {
        if (typeof prob.rating !== "number") return;
        if (prob.rating < range.min || prob.rating > range.max) return;
      }
      (prob.tags ?? []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });
  });

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
