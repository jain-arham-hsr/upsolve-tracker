/**
 * services/storage.js
 * A clean wrapper for chrome.storage.local
 */
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
   * Adds a single contest (with its fetched ratings) to the storage.
   * Uses an 'Upsert' logic to prevent duplicate contest IDs.
   */
  static async addTrackedContest(newContest) {
    const contests = await this.getTrackedContests();

    const existingIndex = contests.findIndex((c) => c.id === newContest.id);
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
   */
  static async removeTrackedContest(contestId) {
    const contests = await this.getTrackedContests();
    await this.saveTrackedContests(
      contests.filter((contest) => String(contest.id) !== String(contestId)),
    );
  }

  // Settings live under dotted `cf_trainer.*` keys, read directly by the code
  // that needs them; credentials live in IndexedDB (see secure-store.js).
  // Solved state is derived fresh from user.status on every sync rather than
  // cached, so there is deliberately nothing else here.
}
