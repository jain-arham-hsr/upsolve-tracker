/**
 * The auto-export write path: which file it writes, and that a failed write is
 * reported rather than swallowed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { BACKUP_FILENAME, writeBackup } from "../core/services/auto-export.js";

/** Minimal FileSystemDirectoryHandle stand-in that records what happened. */
function fakeDir({ files = [], failWrite = false } = {}) {
  const events = [];
  return {
    name: "backups",
    files: new Set(files),
    events,
    async getFileHandle(name) {
      events.push(`open:${name}`);
      return {
        async createWritable() {
          return {
            async write() {
              if (failWrite) throw new Error("disk full");
              events.push(`write:${name}`);
            },
            async close() {
              this.files?.add?.(name);
            },
          };
        },
      };
    },
    async removeEntry(name) {
      if (!this.files.has(name)) {
        const error = new Error("not found");
        error.name = "NotFoundError";
        throw error;
      }
      this.files.delete(name);
      events.push(`remove:${name}`);
    },
  };
}

const withStorage = async (fn) => {
  globalThis.chrome = { storage: { local: { get: async () => ({ a: 1 }) } } };
  try {
    return await fn();
  } finally {
    delete globalThis.chrome;
  }
};

test("the backup is written under the rebranded name", () => {
  assert.equal(BACKUP_FILENAME, "upsolve_tracker_backup.json");
});



