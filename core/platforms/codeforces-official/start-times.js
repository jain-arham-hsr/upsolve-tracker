/**
 * Fills `contest.startTimeSeconds`, which orders the contest list.
 *
 * Contest IDs are *not* chronological — 2205 ran a day before 2200 — so sorting
 * by id is not a substitute.
 *
 * One `contest.list` call, ~400 KB, covering every official round. A finished
 * contest's start time never changes, so unlike tags there is no re-check: a
 * contest is asked about once, and only if the field is missing.
 *
 * **In practice this now rarely runs at all.** `solve-stats.js` reads the start
 * time straight off the standings response at add time, so a contest added
 * since that change arrives already dated and never reaches the filter below.
 *
 * The gym platform's copy is a different call (`contest.list?gym=true`) with a
 * per-contest fallback the official list does not need, which is why the two
 * are separate files rather than one with a branch — that branch, and the
 * `contest.type` guard that protected it, are both gone.
 */

/**
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * @returns {Promise<number>} How many contests were resolved.
 */
export async function syncStartTimes(cfService, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) => !contest.startTimeSeconds);
  if (pending.length === 0) return 0;

  onProgress("Looking up contest dates…");

  const startTimes = new Map();
  try {
    const list = await cfService.getContestList();
    (list ?? []).forEach((contest) => {
      if (contest.startTimeSeconds) {
        startTimes.set(String(contest.id), contest.startTimeSeconds);
      }
    });
  } catch (error) {
    // Ordering is cosmetic; never let it break a sync or a contest add.
    console.warn("[Start Times] contest.list failed:", error.message);
    return 0;
  }

  let resolved = 0;
  pending.forEach((contest) => {
    const startTime = startTimes.get(String(contest.id));
    if (startTime) {
      contest.startTimeSeconds = startTime;
      resolved++;
    }
  });

  console.log(`[Start Times] Resolved ${resolved} of ${pending.length} contest(s).`);
  return resolved;
}
