/**
 * The backup filename changed with the rebrand, and the old file is deleted
 * once a new one exists beside it. Both halves are worth pinning: writing to a
 * new name while leaving the old one behind is the failure this code exists to
 * prevent — a stale file that looks like a good backup and silently loses
 * everything added since the rename — and deleting it *before* the new write
 * succeeds would trade that for outright data loss.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { BACKUP_FILENAME, writeBackup } from "../core/services/auto-export.js";

const LEGACY = "cf_trainer_backup.json";

/** Minimal FileSystemDirectoryHandle stand-in that records what happened. */
function fakeDir({ files = [LEGACY], failWrite = false } = {}) {
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

test("a successful write retires the pre-rebrand backup", async () => {
  const dir = fakeDir();
  const ok = await withStorage(() => writeBackup(dir));

  assert.equal(ok, true);
  assert.ok(!dir.files.has(LEGACY), "old backup should be gone");
  // Order matters: the replacement is on disk before the old one is given up.
  assert.ok(
    dir.events.indexOf(`write:${BACKUP_FILENAME}`) < dir.events.indexOf(`remove:${LEGACY}`),
    `expected write before remove, got ${dir.events.join(" -> ")}`,
  );
});

test("a failed write leaves the old backup alone", async () => {
  const dir = fakeDir({ failWrite: true });
  const ok = await withStorage(() => writeBackup(dir));

  assert.equal(ok, false);
  assert.ok(dir.files.has(LEGACY), "the only backup on disk must survive a failed write");
});

test("no old backup to remove is not an error", async () => {
  const dir = fakeDir({ files: [] });
  const ok = await withStorage(() => writeBackup(dir));

  assert.equal(ok, true, "a first-time user has no legacy file and must still succeed");
});
