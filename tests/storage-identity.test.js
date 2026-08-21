/**
 * Storage keys on platform + id. Keying on the bare id was fine while
 * Codeforces was the only source, but silently overwrites once a second
 * platform can mint the same number.
 *
 * chrome.storage.local is stubbed — these are pure key-handling tests.
 */
import test from "node:test";
import assert from "node:assert/strict";

function stubChrome(initial = []) {
  const store = { trackedContests: structuredClone(initial) };
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = store[key] ?? fallback;
          }
          return out;
        },
        async set(patch) {
          Object.assign(store, structuredClone(patch));
        },
      },
    },
  };
  return store;
}

const { LocalDB } = await import("../core/services/storage.js");

const contest = (over = {}) => ({
  id: "1000",
  platform: "codeforces",
  type: "OFFICIAL",
  problems: [{ index: "A", solved: false, rating: 1200 }],
  ...over,
});

test("same contest re-added is replaced, not duplicated", async () => {
  const store = stubChrome([contest({ name: "old" })]);
  await LocalDB.addTrackedContest(contest({ name: "new" }));
  assert.equal(store.trackedContests.length, 1);
  assert.equal(store.trackedContests[0].name, "new");
});

test("the same id on two platforms is two contests, not one", async () => {
  const store = stubChrome([contest({ platform: "codeforces", name: "CF 1000" })]);
  await LocalDB.addTrackedContest(contest({ platform: "codechef", name: "CC 1000" }));
  assert.equal(store.trackedContests.length, 2, "one silently overwrote the other");
  assert.deepEqual(
    store.trackedContests.map((c) => c.name).sort(),
    ["CC 1000", "CF 1000"],
  );
});


test("removal targets one platform only", async () => {
  const store = stubChrome([
    contest({ platform: "codeforces", name: "CF" }),
    contest({ platform: "codechef", name: "CC" }),
  ]);
  await LocalDB.removeTrackedContest("codechef", "1000");
  assert.deepEqual(store.trackedContests.map((c) => c.name), ["CF"]);
});

test("removal accepts a numeric id, as imported backups carry them", async () => {
  const store = stubChrome([contest({ id: 1000 })]);
  await LocalDB.removeTrackedContest("codeforces", "1000");
  assert.equal(store.trackedContests.length, 0);
});

test("removal matches on the platform-qualified key", async () => {
  // A bare id is not enough: two platforms can share a contest number, so the
  // key the button sends has to resolve to the same one the record stores.
  const store = stubChrome([{ id: "1000", platform: "codeforces", type: "GYM", problems: [] }]);
  await LocalDB.removeTrackedContest("codeforces", "1000");
  assert.equal(store.trackedContests.length, 0);
});
