/**
 * Problem tags never appear in the standings HTML, so they have to come from
 * the API.
 *
 * Official problems all live in problemset.problems, which is a single request
 * covering every contest at once. The per-contest alternative
 * (contest.standings) also carries tags, but its response embeds every
 * participant row and runs to ~12MB for one Div. 3 — unusable in a loop.
 *
 * Gym problems are absent from the problemset entirely. Their tags, when they
 * exist at all, are read opportunistically from the standings response that
 * adding a gym contest already fetches (see get-prob-stats.js).
 */

/**
 * Fills in tags for every official contest that hasn't been tagged yet.
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * @returns {Promise<number>} How many contests were tagged.
 */
export async function syncOfficialTags(cfService, contests) {
  const pending = contests.filter(
    (contest) => contest.type === "OFFICIAL" && !contest.tagsSynced,
  );
  if (pending.length === 0) return 0;

  let problemset;
  try {
    problemset = await cfService.getProblemsetProblems();
  } catch (error) {
    // Tags are a nice-to-have; never let them break a sync or a contest add.
    console.warn("[Tag Service] problemset.problems failed:", error.message);
    return 0;
  }

  const tagsByKey = new Map(
    (problemset?.problems ?? []).map((problem) => [
      `${problem.contestId}-${problem.index}`,
      problem.tags ?? [],
    ]),
  );

  pending.forEach((contest) => {
    contest.problems.forEach((prob) => {
      prob.tags = tagsByKey.get(`${contest.id}-${prob.index}`) ?? prob.tags ?? [];
    });
    contest.tagsSynced = true;
  });

  console.log(`[Tag Service] Tagged ${pending.length} official contest(s).`);
  return pending.length;
}

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
