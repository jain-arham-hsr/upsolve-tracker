import { getPlatform } from "./platforms/registry.js";

/**
 * Import writes straight into chrome.storage and there is no undo, so a file
 * that isn't an Upsolve Tracker backup has to be caught before it replaces the queue.
 *
 * @param {unknown} data - Parsed JSON from the picked file.
 * @returns {string|null} A human-readable reason to refuse, or null to accept.
 */
export function describeBackupProblem(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "That file isn't an Upsolve Tracker backup.";
  }
  if (!Array.isArray(data.trackedContests)) {
    return "That file has no contest queue in it.";
  }
  // some(), not find(): a null entry is itself falsy and would slip through a
  // truthiness check on the returned element.
  const malformed = data.trackedContests.some(
    (contest) => !contest?.id || !Array.isArray(contest.problems),
  );
  if (malformed) {
    return "That backup has malformed contest entries, so it wasn't imported.";
  }
  // `platform` is deliberately NOT required: backups written before platforms
  // existed have no such field and read as Codeforces. But a platform this
  // build has never heard of would throw later, while rendering — so refuse
  // now, with a reason, rather than importing something that crashes the list.
  const unknown = data.trackedContests.find((contest) => {
    try {
      getPlatform(contest.platform);
      return false;
    } catch {
      return true;
    }
  });
  if (unknown) {
    return `That backup contains contests from "${unknown.platform}", which this version doesn't support.`;
  }
  return null;
}
