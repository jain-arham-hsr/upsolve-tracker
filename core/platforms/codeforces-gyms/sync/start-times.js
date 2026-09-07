/**
 * Gym start times, so the queue can be ordered by when contests actually ran
 * rather than when they happened to be added.
 *
 * Contest IDs are *not* chronological, so sorting by id is not a substitute.
 * The standings HTML carries no machine-readable start time, so it comes from
 * `contest.list?gym=true`. Unlike tags, a finished contest's start time never
 * changes, so a contest is only ever asked about once.
 *
 * **Private gyms and mashups (the 6xxxxx ids) are absent from that list
 * entirely**, which is why this file has a second pass the official platform's
 * copy does not need: one signed `contest.standings` each, for the handful the
 * bulk list could not resolve. The signed request reaches them even though the
 * public list cannot see them.
 *
 * Most gyms never get that far — `solve-stats.js` reads the start time off the
 * standings response at add time — so this is the backstop for records written
 * before that, and for a gym whose add took a fallback path.
 *
 * This matches on bare contest ids, so it must be handed this platform's
 * contests exclusively (`contestsOnPlatform` in platforms/registry.js). The
 * `contest.type` guard this file used to carry is gone: the folder is that
 * guard now. The comparator that once sat at the bottom is in
 * core/queue-order.js — it compares epoch seconds and was never Codeforces' own.
 */

/**
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * @returns {Promise<number>} How many contests were resolved.
 */
export async function syncStartTimes(sources, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) => !contest.startTimeSeconds);
  if (pending.length === 0) return 0;

  onProgress("Looking up contest dates…");

  const startTimes = new Map();
  await collectInto(startTimes, sources);

  let resolved = 0;
  pending.forEach((contest) => {
    const startTime = startTimes.get(String(contest.id));
    if (startTime) {
      contest.startTimeSeconds = startTime;
      resolved++;
    }
  });

  resolved += await resolveGymsIndividually(
    sources,
    pending.filter((contest) => !contest.startTimeSeconds),
    onProgress,
  );

  console.log(
    `[Start Times] Resolved ${resolved} of ${pending.length} contest(s).`,
  );
  return resolved;
}

/**
 * Private gyms and mashups are missing from contest.list, so the only way to
 * date them is their own standings — which the signed request can reach even
 * though the public list can't see them. One call each, spaced out, and only
 * ever for contests the bulk lists failed to resolve.
 */
async function resolveGymsIndividually(sources, gyms, onProgress) {
  if (gyms.length === 0) return 0;

  let resolved = 0;

  for (const [index, contest] of gyms.entries()) {
    // Still deliberately slow — the API pacer spaces these 2s apart, the gap
    // this loop used to hold itself — so it counts itself off.
    onProgress(`Dating gym ${index + 1} of ${gyms.length}…`);
    try {
      const standings = await sources.getContestStandings(contest.id);
      const startTime = standings?.contest?.startTimeSeconds;
      if (startTime) {
        contest.startTimeSeconds = startTime;
        resolved++;
      }
    } catch (error) {
      console.warn(
        `[Start Times] Gym ${contest.id} standings failed:`,
        error.message,
      );
    }
  }

  return resolved;
}

async function collectInto(startTimes, sources) {
  try {
    const list = await sources.getContestList();
    (list ?? []).forEach((contest) => {
      if (contest.startTimeSeconds) {
        startTimes.set(String(contest.id), contest.startTimeSeconds);
      }
    });
  } catch (error) {
    // Ordering is cosmetic; never let it break a sync or a contest add.
    console.warn("[Start Times] contest.list?gym=true failed:", error.message);
  }
}
