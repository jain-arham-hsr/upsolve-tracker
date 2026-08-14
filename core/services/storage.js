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

  // ==========================================
  // 2. SOLVED CACHE (The Dynamic Data)
  // ==========================================

  /**
   * Retrieves the user's solved problems.
   * Converts the stored Array into a Set for ultra-fast O(1) lookups in the UI.
   */
  static async getSolvedCache() {
    const data = await chrome.storage.local.get({ solvedCache: [] });
    return new Set(data.solvedCache);
  }

  /**
   * Saves the list of solved problem IDs (e.g., ["1800-A", "123456-B"]).
   * Note: We must store it as an Array because Sets don't serialize well in Chrome Storage.
   */
  static async updateSolvedCache(solvedArray) {
    await chrome.storage.local.set({ solvedCache: Array.from(solvedArray) });
  }

  // ==========================================
  // 3. USER CONFIGURATION
  // ==========================================

  static async getHandle() {
    const data = await chrome.storage.local.get({ cfHandle: "" });
    return data.cfHandle;
  }

  static async setHandle(handle) {
    await chrome.storage.local.set({ cfHandle: handle });
  }
}
