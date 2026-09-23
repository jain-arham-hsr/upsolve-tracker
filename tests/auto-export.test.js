/**
 * The auto-export write path: which file it writes, and that a failed write is
 * reported rather than swallowed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { BACKUP_FILENAME, backUp } from "../core/services/auto-export.js";

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

test("the backup is written under the rebranded name", () => {
  assert.equal(BACKUP_FILENAME, "upsolve_tracker_backup.json");
});

const withAutoExport = async (on, fn) => {
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) =>
          key === "upsolve_tracker.auto_export" ? { [key]: on } : { a: 1 },
      },
    },
  };
  try {
    return await fn();
  } finally {
    delete globalThis.chrome;
  }
};

test("with auto-export off, the backup outcome is a warning, not an error", async () => {
  // Off is a choice, so it nudges rather than alarms — but it is said, since
  // otherwise the queue has no backup and nothing mentions it.
  const outcome = await withAutoExport(false, () => backUp(null));
  assert.equal(outcome.tone, "warning");
  assert.match(outcome.message, /backups are off/);
});

test("a backup that was written reports nothing", async () => {
  const dir = fakeDir();
  const outcome = await withAutoExport(true, () => backUp(dir));
  assert.equal(outcome, null);
  assert.ok(dir.events.includes(`write:${BACKUP_FILENAME}`));
});

test("a write that fails is an error", async () => {
  const outcome = await withAutoExport(true, () => backUp(fakeDir({ failWrite: true })));
  assert.equal(outcome.tone, "error");
});

test("auto-export on with no usable folder is an error, not the off warning", async () => {
  // Settings writes the flag with the folder, so on-without-a-handle can only
  // mean Chrome refused access — a failure, whatever the flag says.
  const outcome = await withAutoExport(true, () => backUp(null));
  assert.equal(outcome.tone, "error");
});
