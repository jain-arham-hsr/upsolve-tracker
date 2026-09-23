/**
 * Re-syncs the queue against what the user has actually solved.
 */
import { LocalDB } from "./services/storage.js";
import {
  listPlatforms,
  platformOf,
  contestsOnPlatform,
} from "./platforms/registry.js";
import {
  getEffectiveRatings,
  storeFetchedRatings,
  ratingChangeMessage,
} from "./services/user-ratings.js";
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
export async function updateSolvedStatus(onProgress = () => {}, { ratingsBefore } = {}) {
  const trackedContests = await LocalDB.getTrackedContests();
  // The caller's reading when it has one: a refresh can move a rating before
  // it gets here, in the waiting-contest retry, and that change is this
  // step's to announce too.
  const before = ratingsBefore ?? (await getEffectiveRatings());

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

  // A rating that moved re-sorts that platform's whole block, which is this
  // step's work — so it is this step's message, not a separate one after it.
  // A message of its own followed a step lasting milliseconds and read as a
  // flash. It is held for as long as the caller's `hold` asks, *after* the
  // save, so the queue re-orders while the note says it has.
  const ratingNote = await ratingChangeMessage(before);
  onProgress(ratingNote ?? "Updating your queue…");
  const { kept, removed } = applySolvedStatus(trackedContests, solvedKeys);

  await LocalDB.saveTrackedContests(kept);
  if (ratingNote) await onProgress.hold?.();

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

    try {
      const session = await platform.createSession();

      // Establish *whose* data this is before reading a single user-specific
      // byte. Everything below writes to `solved` or to a rating the queue
      // orders by, and both are effectively permanent once wrong.
      const identity = await platform.verifyIdentity(session);
      const verdict = await settleIdentity(platform, identity);

      if (verdict === "changed") {
        // The stored flags are a cache of the *old* account's history; leaving
        // them would keep hiding problems this account has never solved.
        const cleared = clearSolvedForPlatform(trackedContests, platform.id);
        console.warn(
          `[Progress Manager] ${platform.label} account changed to ${identity.username}; ` +
            `cleared ${cleared} stale solved flag(s).`,
        );
      }

      // Everything this site does is one step on the status strip: its
      // messages replace each other freely, and only the site as a whole is
      // held to the strip's minimum. The site, not the platform — Codeforces'
      // two platforms are one account and sync back to back, so keyed by
      // platform they showed the same step twice.
      const report = (message) => onProgress(message, { step: platform.site.id });

      const keys = await platform.fetchSolvedKeys(session, mine, report);
      keys.forEach((key) => solvedKeys.add(key));

      // Verified in the same call as the identity, so no extra request.
      ratings[platform.id] = identity.rating;

      // Fill in metadata for contests still missing it. Handed only this
      // platform's contests, since these match on bare contest ids.
      await platform.syncMetadata(session, mine, report);

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
