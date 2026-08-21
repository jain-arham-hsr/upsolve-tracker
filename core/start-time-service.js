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
 * get-prob-stats already fetches (see populateStartTime there).
 *
 * syncStartTimes is Codeforces-only and matches on bare contest ids, so it
 * must be handed Codeforces contests exclusively (contestsOnPlatform in
 * platforms/registry.js). byStartTimeDesc below is platform-agnostic —
 * epoch seconds compare fine across sites.
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

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));
  let resolved = 0;

  for (const [index, contest] of gyms.entries()) {
    // This loop is deliberately slow, so it counts itself off.
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
    if (index < gyms.length - 1) await delay(2000);
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

/**
 * Newest first, with unknown start times sinking to the bottom rather than
 * being treated as ancient.
 */
export function byStartTimeDesc(a, b) {
  const left = a.startTimeSeconds ?? null;
  const right = b.startTimeSeconds ?? null;

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}
