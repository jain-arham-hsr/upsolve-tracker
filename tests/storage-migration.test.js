/**
 * The cf_trainer.* -> upsolve_tracker.* rename.
 *
 * CLAUDE.md kept these keys frozen for a long time on the grounds that a
 * botched migration silently loses someone's queue, so the properties that
 * make it safe are the ones worth pinning: it never holds neither copy, it is
 * idempotent, it leaves unprefixed keys alone, and it also runs over imported
 * backups — which were written before the rename and would otherwise put the
 * old keys straight back.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PREFIX,
  renameLegacyKeys,
  migrateStoredKeys,
} from "../core/services/storage-migration.js";

/** chrome.storage.local over a plain object, recording the call order. */
function stubStorage(initial) {
  const store = { ...initial };
  const calls = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(query) {
          if (query === null) return { ...store };
          return { ...store };
        },
        async set(items) {
          calls.push("set");
          Object.assign(store, items);
        },
        async remove(keys) {
          calls.push("remove");
          for (const key of [].concat(keys)) delete store[key];
        },
      },
    },
  };
  return { store, calls };
}

test("legacy keys are renamed and everything else is left alone", () => {
  const { data, legacyKeys } = renameLegacyKeys({
    "cf_trainer.handle": "tourist",
    "cf_trainer.auto_export": true,
    trackedContests: [{ id: 1 }],
    somethingElse: 7,
  });

  assert.equal(data[`${PREFIX}handle`], "tourist");
  assert.equal(data[`${PREFIX}auto_export`], true);
  assert.deepEqual(data.trackedContests, [{ id: 1 }], "the queue itself must not move");
  assert.equal(data.somethingElse, 7);
  assert.ok(!("cf_trainer.handle" in data));
  assert.deepEqual(legacyKeys.sort(), ["cf_trainer.auto_export", "cf_trainer.handle"]);
});

test("an interrupted migration resolves in favour of the new key", () => {
  // Both present means the write landed and the remove did not. The new value
  // is the live one; preferring the legacy copy would undo anything since.
  const { data } = renameLegacyKeys({
    "cf_trainer.handle": "old_name",
    [`${PREFIX}handle`]: "new_name",
  });
  assert.equal(data[`${PREFIX}handle`], "new_name");
});

test("migrating writes before it removes, and never holds neither copy", async () => {
  const { store, calls } = stubStorage({ "cf_trainer.handle": "tourist" });
  const moved = await migrateStoredKeys();

  assert.equal(moved, 1);
  assert.equal(store[`${PREFIX}handle`], "tourist");
  assert.ok(!("cf_trainer.handle" in store));
  assert.deepEqual(calls, ["set", "remove"], "removing first could leave no copy at all");
});

test("migrating twice is indistinguishable from migrating once", async () => {
  const { store } = stubStorage({ "cf_trainer.handle": "tourist" });
  await migrateStoredKeys();
  const second = await migrateStoredKeys();

  assert.equal(second, 0, "a second run has nothing to do");
  assert.equal(store[`${PREFIX}handle`], "tourist");
});

test("a store with nothing to migrate is not written to", async () => {
  const { store, calls } = stubStorage({ [`${PREFIX}handle`]: "tourist", trackedContests: [] });
  const moved = await migrateStoredKeys();

  assert.equal(moved, 0);
  assert.deepEqual(calls, [], "no write at all when there is nothing to rename");
  assert.equal(store[`${PREFIX}handle`], "tourist");
});

test("an old backup's keys are renamed on import", () => {
  // Import writes straight to storage with no undo, so a backup exported
  // before the rename would otherwise reinstate exactly what was removed.
  const backup = {
    "cf_trainer.handle": "tourist",
    "cf_trainer.platform_filter": ["atcoder"],
    trackedContests: [{ id: 1993 }],
  };
  const { data } = renameLegacyKeys(backup);

  assert.deepEqual(Object.keys(data).filter((k) => k.startsWith("cf_trainer.")), []);
  assert.equal(data[`${PREFIX}handle`], "tourist");
  assert.deepEqual(data.trackedContests, [{ id: 1993 }]);
});

test("both migrations chain for a long-standing install", async () => {
  // The oldest shape: the pre-rename prefix *and* the pre-chips single-select
  // filter. One rename feeds the other, so both have to hold together.
  const { store } = stubStorage({ "cf_trainer.contest_filter": "GYM" });
  await migrateStoredKeys();
  assert.equal(store[`${PREFIX}contest_filter`], "GYM");

  const { loadFilter } = await import("../core/ui/platform-filter.js");
  assert.deepEqual(await loadFilter(), ["codeforces:GYM"]);
});
