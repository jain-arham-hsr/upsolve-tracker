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

/** How long before a partially tagged contest is worth asking about again. */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Codeforces tags are editable after publication, so a problem can pick up
 * tags days after its contest ends. A contest is therefore worth asking about
 * again when some of its problems are still bare — but only occasionally,
 * since plenty of problems (April Fools rounds, for instance) never get tags.
 *
 * Contests where every problem already has tags are never re-requested.
 */
function needsTags(contest, now) {
  if (contest.type !== "OFFICIAL") return false;

  // Pre-timestamp records used a boolean; treat those as synced long ago.
  const syncedAt = contest.tagsSyncedAt ?? (contest.tagsSynced ? 0 : null);
  if (syncedAt === null) return true;

  const anyBare = contest.problems.some((prob) => !prob.tags?.length);
  return anyBare && now - syncedAt > RECHECK_AFTER_MS;
}

/**
 * Fills in tags for every official contest that is missing them.
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * @returns {Promise<number>} How many contests were updated.
 */
export async function syncOfficialTags(
  cfService,
  contests,
  onProgress = () => {},
) {
  const now = Date.now();
  const pending = contests.filter((contest) => needsTags(contest, now));
  if (pending.length === 0) return 0;

  onProgress("Fetching problem tags…");

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
    contest.tagsSyncedAt = now;
    delete contest.tagsSynced;
  });

  console.log(`[Tag Service] Synced tags for ${pending.length} contest(s).`);
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
