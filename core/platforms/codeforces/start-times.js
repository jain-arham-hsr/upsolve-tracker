/**
 * Contest start times, so the queue can be ordered by when contests actually
 * ran rather than when they happened to be added.
 *
 * The standings HTML doesn't carry a machine-readable start time, so it comes
 * from contest.list — one ~400KB request covering every official contest, and
 * a separate one for gyms. Unlike tags, a finished contest's start time never
 * changes, so a contest is only ever asked about once.
 *
 * Private gyms and mashups are absent from the gym list entirely. Those get
 * their start time at add time instead, from the standings response
 * solve-stats.js already fetches (see populateStartTime there).
 *
 * This matches on bare contest ids, so it must be handed Codeforces contests
 * exclusively (contestsOnPlatform in platforms/registry.js). The comparator
 * that used to sit at the bottom of this file is in core/queue-order.js: it
 * compares epoch seconds and was never Codeforces' own.
 */

/**
 * Fills in startTimeSeconds for contests missing it. Mutates the passed
 * contests; persisting them is the caller's job.
 *
 * @returns {Promise<number>} How many contests were resolved.
 */
export async function syncStartTimes(
  cfService,
  contests,
  onProgress = () => {},
) {
  const pending = contests.filter((contest) => !contest.startTimeSeconds);

  // Same guard as `problemset-sync.js#needsSync`, and for the same incident: the
  // lookups below split by `contest.type`, so a record without one matches
  // neither branch and resolves nothing — quietly, since an unresolved start
  // time just sorts the contest last rather than erroring.
  for (const contest of pending) {
    if (typeof contest.type !== "string") {
      throw new Error(
        `Codeforces start-time sync got a contest with no type (id ${contest.id}). ` +
          `Whatever built it is not producing a complete record.`,
      );
    }
  }
  if (pending.length === 0) return 0;

  onProgress("Looking up contest dates…");
  const startTimes = new Map();
  const wanted = (type) => pending.some((contest) => contest.type === type);

  if (wanted("OFFICIAL")) await collectInto(startTimes, cfService, false);
  if (wanted("GYM")) await collectInto(startTimes, cfService, true);

  let resolved = 0;
  pending.forEach((contest) => {
    const startTime = startTimes.get(String(contest.id));
    if (startTime) {
      contest.startTimeSeconds = startTime;
      resolved++;
    }
  });

  resolved += await resolveGymsIndividually(
    cfService,
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
async function resolveGymsIndividually(cfService, unresolved, onProgress) {
  const gyms = unresolved.filter((contest) => contest.type === "GYM");
  if (gyms.length === 0) return 0;

  let resolved = 0;

  for (const [index, contest] of gyms.entries()) {
    // Still deliberately slow — the API pacer spaces these 2s apart, the gap
    // this loop used to hold itself — so it counts itself off.
    onProgress(`Dating gym ${index + 1} of ${gyms.length}…`);
    try {
      const standings = await cfService.getContestStandings(contest.id);
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

async function collectInto(startTimes, cfService, gym) {
  try {
    const list = await cfService.getContestList(gym);
    (list ?? []).forEach((contest) => {
      if (contest.startTimeSeconds) {
        startTimes.set(String(contest.id), contest.startTimeSeconds);
      }
    });
  } catch (error) {
    // Ordering is cosmetic; never let it break a sync or a contest add.
    console.warn(
      `[Start Times] contest.list${gym ? "?gym=true" : ""} failed:`,
      error.message,
    );
  }
}
