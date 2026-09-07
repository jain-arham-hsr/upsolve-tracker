/**
 * Fills `contest.startTimeSeconds`, which orders the contest list, from the
 * bulk `contest.list` — the one each platform's Source answers with its own
 * list. Contest ids are not chronological (2205 ran a day before 2200), so
 * sorting by id is no substitute.
 *
 * A finished contest's start time never changes, so unlike tags there is no
 * re-check: a contest is asked about once, and only if the field is missing.
 * Ordering is cosmetic, so a failed list never breaks a sync or an add.
 */
export async function sync(session, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) => !contest.startTimeSeconds);
  if (pending.length === 0) return 0;

  onProgress("Looking up contest dates…");

  const startTimes = new Map();
  try {
    const list = await session.sources.contestList();
    for (const contest of list ?? []) {
      if (contest.startTimeSeconds) startTimes.set(String(contest.id), contest.startTimeSeconds);
    }
  } catch (error) {
    console.warn("[Codeforces] contest.list failed:", error.message);
    return 0;
  }

  let resolved = 0;
  for (const contest of pending) {
    const startTime = startTimes.get(String(contest.id));
    if (startTime) {
      contest.startTimeSeconds = startTime;
      resolved++;
    }
  }

  console.log(`[Codeforces] Resolved ${resolved} of ${pending.length} contest(s).`);
  return resolved;
}
