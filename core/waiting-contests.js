/**
 * Contests that failed to add because the platform hasn't published them yet.
 *
 * Adding a round minutes after it ends fails on every platform for the same
 * reason: the data isn't there. AtCoder Problems has not indexed it, or a
 * Codeforces standings page has not settled. The message is correct, but the
 * only recovery was to remember to come back and click Add again — at exactly
 * the moment you most want the contest queued.
 *
 * So the attempt is remembered, and every global refresh retries it.
 *
 * **Waiting entries are their own storage key, not `trackedContests`.** They
 * carry no `problems` array, and putting one in the queue would break backup
 * validation, `collectPendingProblems`, the platform ring and the stats
 * histograms at once. They ride along in the exported backup and the cloud
 * copy regardless, since both are made from `chrome.storage.local` wholesale.
 */
import { LocalDB } from "./services/storage.js";
import { makeContestKey, findTrackedContest } from "./platforms/registry.js";
import { processNewContest } from "./contest-manager.js";
import { UNAVAILABLE } from "./contest-status.js";

const WAITING_KEY = "upsolve_tracker.waiting_contests";

/** Test seam, and the one place the key is written down for callers. */
export const WAITING_STORAGE_KEY = WAITING_KEY;

export async function loadWaiting() {
  const stored = await chrome.storage.local.get({ [WAITING_KEY]: [] });
  const entries = stored[WAITING_KEY];
  return Array.isArray(entries) ? entries : [];
}

async function saveWaiting(entries) {
  await chrome.storage.local.set({ [WAITING_KEY]: entries });
}

/**
 * The entry for a contest, if it is waiting.
 *
 * Keyed exactly as a tracked contest is, so the two can never be confused for
 * each other or filed under different names for the same round.
 */
export function findWaiting(entries, platformId, contestId) {
  const key = makeContestKey(platformId, contestId);
  return (entries ?? []).find((entry) => waitingKey(entry) === key) ?? null;
}

export function waitingKey(entry) {
  return makeContestKey(entry.platform, entry.contestId);
}

/**
 * Remembers a contest to retry. Upserts, so clicking Add twice on the same
 * page does not queue two attempts at it.
 */
export async function addWaiting({ url, platformId, contestId, lastError = null }) {
  const entries = await loadWaiting();
  const key = makeContestKey(platformId, contestId);

  const entry = {
    url,
    platform: platformId,
    contestId: String(contestId),
    waitingSince: Date.now(),
    lastTriedAt: Date.now(),
    lastError,
  };

  const index = entries.findIndex((existing) => waitingKey(existing) === key);
  if (index >= 0) {
    // Keep the original wait start — how long this has been going is the one
    // thing that tells a fresh delay from a stuck entry.
    entry.waitingSince = entries[index].waitingSince ?? entry.waitingSince;
    entries[index] = entry;
  } else {
    entries.push(entry);
  }

  await saveWaiting(entries);
  return entry;
}

export async function cancelWaiting(platformId, contestId) {
  const entries = await loadWaiting();
  const key = makeContestKey(platformId, contestId);
  await saveWaiting(entries.filter((entry) => waitingKey(entry) !== key));
}

/**
 * Retries every waiting contest, once.
 *
 * **An entry is dropped only when it will never resolve** — it was added, it is
 * already tracked, or every problem in it is solved. Every other failure keeps
 * it waiting and records the message.
 *
 * That asymmetry is the point. `processNewContest` verifies identity before it
 * fetches anything, so a momentary outage, an expired session or a 503 throws
 * something that is *not* a publication delay; dropping on those would lose the
 * wait to a network blip, silently, which is the failure this whole mechanism
 * exists to prevent. Keeping instead costs one retry per refresh, and the
 * recorded `lastError` is what makes a genuinely stuck entry visible on the
 * Contests tab rather than invisible.
 *
 * Failures are isolated per entry, the same way `progress-manager` isolates
 * them per platform: one contest failing must not stop the others.
 *
 * `addContest` is a test seam. Production always passes `processNewContest`;
 * the suite substitutes it so the outage case above can be exercised without
 * a network stack standing in for one.
 *
 * @returns {Promise<{added: object[], dropped: object[], stillWaiting: object[]}>}
 */
export async function retryWaitingContests(
  onProgress = () => {},
  { addContest = processNewContest } = {},
) {
  const entries = await loadWaiting();
  if (entries.length === 0) return { added: [], dropped: [], stillWaiting: [] };

  const added = [];
  const dropped = [];
  const stillWaiting = [];

  const tracked = await LocalDB.getTrackedContests();

  onProgress(
    `Retrying ${entries.length} waiting contest${entries.length === 1 ? "" : "s"}…`,
  );

  for (const entry of entries) {
    // Added by hand in the meantime. Nothing to report — the user already has
    // what they were waiting for.
    if (findTrackedContest(tracked, entry.platform, entry.contestId)) {
      continue;
    }

    try {
      const contest = await addContest(entry.url, onProgress);
      added.push({ platform: entry.platform, id: contest.id, contest });
    } catch (error) {
      // Two reasons a wait may end rather than continue, and both mean the
      // same thing: another attempt cannot change the answer. `isAlreadySolved`
      // is a contest we will never be given; `unavailable` is a source that
      // will never produce what we need — a finished gym whose participants
      // are private, say. Everything else keeps waiting, because a 503 or an
      // expired session is not a verdict.
      if (error?.isAlreadySolved || error?.contestStatus === UNAVAILABLE) {
        dropped.push({ ...entry, lastError: error.message });
        continue;
      }

      stillWaiting.push({
        ...entry,
        lastTriedAt: Date.now(),
        lastError: error?.message ?? String(error),
      });
    }
  }

  await saveWaiting(stillWaiting);

  return { added, dropped, stillWaiting };
}
