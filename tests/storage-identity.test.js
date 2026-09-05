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
  platform: "codeforces-official",
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
  const store = stubChrome([contest({ platform: "codeforces-official", name: "CF 1000" })]);
  await LocalDB.addTrackedContest(contest({ platform: "codechef", name: "CC 1000" }));
  assert.equal(store.trackedContests.length, 2, "one silently overwrote the other");
  assert.deepEqual(
    store.trackedContests.map((c) => c.name).sort(),
    ["CC 1000", "CF 1000"],
  );
});


test("removal targets one platform only", async () => {
  const store = stubChrome([
    contest({ platform: "codeforces-official", name: "CF" }),
    contest({ platform: "codechef", name: "CC" }),
  ]);
  await LocalDB.removeTrackedContest("codechef", "1000");
  assert.deepEqual(store.trackedContests.map((c) => c.name), ["CF"]);
});

test("removal accepts a numeric id, as imported backups carry them", async () => {
  const store = stubChrome([contest({ id: 1000 })]);
  await LocalDB.removeTrackedContest("codeforces-official", "1000");
  assert.equal(store.trackedContests.length, 0);
});

test("removal matches on the platform-qualified key", async () => {
  // A bare id is not enough: two platforms can share a contest number, so the
  // key the button sends has to resolve to the same one the record stores.
  const store = stubChrome([{ id: "1000", platform: "codeforces-gyms", type: "GYM", problems: [] }]);
  await LocalDB.removeTrackedContest("codeforces-gyms", "1000");
  assert.equal(store.trackedContests.length, 0);
});

test("removal will not cross between the two Codeforces platforms", async () => {
  // Contest ids are unique across official and gym on Codeforces itself, so
  // this is not a collision that happens — but the two platforms now share an
  // origin, a mark and a short label, and the *key* is the only thing that
  // separates them. If removal matched on anything looser, removing a gym could
  // take an official round with it.
  const store = stubChrome([{ id: "1000", platform: "codeforces-gyms", type: "GYM", problems: [] }]);
  await LocalDB.removeTrackedContest("codeforces-official", "1000");
  assert.equal(store.trackedContests.length, 1, "a gym was removed by an official key");
});
