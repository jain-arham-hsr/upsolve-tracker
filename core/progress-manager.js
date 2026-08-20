/**
 * Re-syncs the queue against what the user has actually solved.
 */
import { LocalDB } from "./services/storage.js";
import {
  listPlatforms,
  platformOf,
  contestsOnPlatform,
} from "./platforms/registry.js";
import { getAdapter } from "./platforms/adapters.js";

/**
 * Reconciles local contest data with each platform's submission history.
 * Updates the 'solved' status for individual problems and removes contests
 * that are 100% completed.
 *
 * @returns {Promise<Object[]>} List of {type, id} for contests removed.
 */
export async function updateSolvedStatus(onProgress = () => {}) {
  const trackedContests = await LocalDB.getTrackedContests();

  const { solvedKeys, anySucceeded } = await collectSolvedKeys(
    trackedContests,
    onProgress,
  );

  // Every platform failed — usually an unconfigured extension or an outage.
  // Returning before the write keeps a bad sync from touching storage at all.
  if (!anySucceeded) return [];

  onProgress("Updating your queue…");
  const { kept, removed } = applySolvedStatus(trackedContests, solvedKeys);

  await LocalDB.saveTrackedContests(kept);

  return removed;
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
      if (solvedKeys.has(platform.solvedKey(contest.id, prob.index))) {
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
 * Asks every platform that has contests tracked for its solved history, and
 * lets it fill in any metadata it owes.
 *
 * Failures are isolated per platform: one site being down or unconfigured
 * must not stop the others syncing, and must never clear anything.
 */
async function collectSolvedKeys(trackedContests, onProgress) {
  const solvedKeys = new Set();
  let anySucceeded = false;

  for (const platform of listPlatforms()) {
    const mine = contestsOnPlatform(trackedContests, platform.id);
    if (mine.length === 0) continue;

    const adapter = getAdapter(platform.id);
    if (!adapter) continue;

    try {
      const session = await adapter.createSession();
      if (!session.handle) {
        console.warn(`[Progress Manager] No ${platform.label} handle set. Skipping.`);
        continue;
      }

      const keys = await adapter.fetchSolvedKeys(session, onProgress);
      keys.forEach((key) => solvedKeys.add(key));

      // Fill in metadata for contests still missing it. Handed only this
      // platform's contests, since these match on bare contest ids.
      await adapter.syncMetadata?.(session, mine, onProgress);

      anySucceeded = true;
    } catch (error) {
      console.warn(`[Progress Manager] ${platform.label} sync failed:`, error.message);
    }
  }

  return { solvedKeys, anySucceeded };
}
