export const Storage = {
  // Get all problems currently in the queue
  async getQueue() {
    const result = await chrome.storage.local.get(["queue"]);
    return result.queue || []; // Return array, default to empty
  },

  // Append new problems to the existing queue
  async addToQueue(newProblems) {
    const currentQueue = await this.getQueue();
    const updatedQueue = [...currentQueue, ...newProblems];
    await chrome.storage.local.set({ queue: updatedQueue });
    return updatedQueue;
  },
};
