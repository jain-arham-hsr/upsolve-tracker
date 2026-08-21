/**
 * Re-syncs the queue against what the user has actually solved.
 */
import { LocalDB } from "./services/storage.js";
import {
  listPlatforms,
  platformOf,
  contestsOnPlatform,
  DEFAULT_PLATFORM_ID,
} from "./platforms/registry.js";
import { getAdapter } from "./platforms/adapters.js";
import { storeFetchedRatings } from "./services/user-ratings.js";
import {
  settleIdentity,
  clearSolvedForPlatform,
} from "./services/platform-identity.js";

/**
 * Reconciles local contest data with each platform's submission history.
 * Updates the 'solved' status for individual problems and removes contests
 * that are 100% completed.
 *
 * @returns {Promise<{removed: Object[], failures: Object[]}>} contests dropped
 *   for being fully solved, and any platform that refused to sync. Failures
 *   are returned rather than only logged: refusing silently looks the same to
 *   the user as corrupting silently.
 */
export async function updateSolvedStatus(onProgress = () => {}) {
  const trackedContests = await LocalDB.getTrackedContests();

  const { solvedKeys, ratings, failures, anySucceeded } = await syncPlatforms(
    trackedContests,
    onProgress,
  );

  // Only platforms that actually answered. A failed lookup must leave the
  // previous rating in place, not blank it and re-sort the queue.
  await storeFetchedRatings(ratings);

  // Every platform failed — usually an unconfigured extension or an outage.
  // Returning before the write keeps a bad sync from touching storage at all.
  if (!anySucceeded) return { removed: [], failures };

  onProgress("Updating your queue…");
  const { kept, removed } = applySolvedStatus(trackedContests, solvedKeys);

  await LocalDB.saveTrackedContests(kept);

  return { removed, failures };
}

/**
 * Marks solved problems and splits off contests that are now complete.
 *
 * Pure, and separated out because it is the step that would fail quietly:
 * clearing a solved flag, or dropping a contest that isn't finished, both look
 * like ordinary behaviour until the queue is wrong.
 *
 * @returns {{kept: object[], removed: {type: string, id: string}[]}}
 */
export function applySolvedStatus(contests, solvedKeys) {
  const kept = [];
  const removed = [];

  for (const contest of contests) {
    let allSolved = true;
    const platform = platformOf(contest);

    contest.problems.forEach((prob) => {
      // `solved` is only ever set true, never cleared. That stickiness is
      // load-bearing: a platform that answers with an empty solved list —
      // because the user is logged out, say — must not resurrect problems
      // they have already finished.
      if (solvedKeys.has(platform.solvedKey(contest, prob))) {
        prob.solved = true;
      }

      if (!prob.solved) allSolved = false;
    });

    if (allSolved) {
      removed.push({ type: platform.contestLabel(contest), id: contest.id });
    } else {
      kept.push(contest);
    }
  }

  return { kept, removed };
}

/**
 * Asks every platform that has contests tracked for its solved history, your
 * rating there, and any metadata it owes.
 *
 * Failures are isolated per platform: one site being down or unconfigured
 * must not stop the others syncing, and must never clear anything.
 */
async function syncPlatforms(trackedContests, onProgress) {
  const solvedKeys = new Set();
  const ratings = {};
  const failures = [];
  let anySucceeded = false;

  for (const platform of listPlatforms()) {
    const mine = contestsOnPlatform(trackedContests, platform.id);
    if (mine.length === 0) continue;

    const adapter = getAdapter(platform.id);
    if (!adapter) continue;

    try {
      const session = await adapter.createSession();

      // Establish *whose* data this is before reading a single user-specific
      // byte. Everything below writes to `solved` or to a rating the queue
      // orders by, and both are effectively permanent once wrong.
      const identity = await adapter.verifyIdentity(session);
      const verdict = await settleIdentity(platform, identity);

      if (verdict === "changed") {
        // The stored flags are a cache of the *old* account's history; leaving
        // them would keep hiding problems this account has never solved.
        const cleared = clearSolvedForPlatform(
          trackedContests,
          platform.id,
          DEFAULT_PLATFORM_ID,
        );
        console.warn(
          `[Progress Manager] ${platform.label} account changed to ${identity.username}; ` +
            `cleared ${cleared} stale solved flag(s).`,
        );
      }

      const keys = await adapter.fetchSolvedKeys(session, mine, onProgress);
      keys.forEach((key) => solvedKeys.add(key));

      // Verified in the same call as the identity, so no extra request.
      ratings[platform.id] = identity.rating;

      // Fill in metadata for contests still missing it. Handed only this
      // platform's contests, since these match on bare contest ids.
      await adapter.syncMetadata?.(session, mine, onProgress);

      anySucceeded = true;
    } catch (error) {
      // Isolated: one platform failing must not stop the others, and must
      // leave every flag exactly as it found it. Surfaced rather than only
      // logged — a silent refusal reads the same as a silent corruption.
      console.warn(`[Progress Manager] ${platform.label} sync failed:`, error.message);
      failures.push({ platform: platform.label, message: error.message });
    }
  }

  return { solvedKeys, ratings, failures, anySucceeded };
}
