/**
 * services/storage.js
 * A clean wrapper for chrome.storage.local
 */
import { contestKey, makeContestKey } from "../platforms/registry.js";

export class LocalDB {
  // ==========================================
  // 1. TRACKED CONTESTS (The Static Data)
  // ==========================================

  /**
   * Retrieves the array of all saved contests.
   * Returns an empty array if nothing exists yet.
   */
  static async getTrackedContests() {
    const data = await chrome.storage.local.get({ trackedContests: [] });
    return data.trackedContests;
  }

  /**
   * Overwrites the entire tracked contests array.
   * Useful for the JSON Import feature.
   */
  static async saveTrackedContests(contests) {
    await chrome.storage.local.set({ trackedContests: contests });
  }

  /**
   * Adds a single contest to storage, replacing any existing record for the
   * same contest.
   *
   * Identity is platform + id, not id alone: Codeforces contest 1000 and a
   * CodeChef contest "1000" are different contests, and keying on the bare id
   * would have one silently overwrite the other. Records written before
   * platforms existed key as Codeforces (see registry.js).
   */
  static async addTrackedContest(newContest) {
    const contests = await this.getTrackedContests();
    const key = contestKey(newContest);

    const existingIndex = contests.findIndex((c) => contestKey(c) === key);
    if (existingIndex >= 0) {
      contests[existingIndex] = newContest; // Overwrite if it already exists
    } else {
      contests.push(newContest); // Append if it's new
    }

    await this.saveTrackedContests(contests);
  }

  /**
   * Drops a contest from the queue. Ids are compared as strings because
   * imported backups can carry them as numbers.
   *
   * @param {string} platformId
   * @param {string|number} contestId
   */
  static async removeTrackedContest(platformId, contestId) {
    const contests = await this.getTrackedContests();
    const key = makeContestKey(platformId, contestId);
    await this.saveTrackedContests(
      contests.filter((contest) => contestKey(contest) !== key),
    );
  }

  // Settings live under dotted `cf_trainer.*` keys, read directly by the code
  // that needs them; credentials live in IndexedDB (see secure-store.js).
  // Solved state is derived fresh from user.status on every sync rather than
  // cached, so there is deliberately nothing else here.
}
