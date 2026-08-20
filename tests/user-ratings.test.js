/**
 * Your rating per platform. This is the highest-leverage number in the queue:
 * a problem's rating misplaces one row, yours misplaces a whole platform's
 * block. So the failure modes here are all about *not* changing it.
 *
 * Ratings are fetched automatically on every platform, so there is no manual
 * override to test — see platform-identity.test.js for where they come from.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

let store;
function stubChrome(initial = {}) {
  store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return out;
        },
        async set(patch) {
          Object.assign(store, structuredClone(patch));
        },
      },
    },
  };
}

const { storeFetchedRatings, getEffectiveRatings, RATING_KEYS } = await import(
  "../core/services/user-ratings.js"
);

const { AUTO_KEY } = RATING_KEYS;

beforeEach(() => stubChrome());

test("a platform that failed keeps its previous rating", async () => {
  // The important one. Clearing on failure would drop every problem from that
  // site to the bottom of the queue, silently.
  stubChrome({ [AUTO_KEY]: { codeforces: 1800, atcoder: 1500 } });
  await storeFetchedRatings({ codeforces: 1850 });

  assert.deepEqual(store[AUTO_KEY], { codeforces: 1850, atcoder: 1500 });
});

test("asking and getting no answer is recorded, unlike failing to ask", async () => {
  // An unrated account genuinely has no rating; that is not the same as the
  // lookup erroring, which never reaches this function.
  stubChrome({ [AUTO_KEY]: { atcoder: 1500 } });
  await storeFetchedRatings({ atcoder: null });
  assert.deepEqual(store[AUTO_KEY], { atcoder: null });
});

test("an empty result set writes nothing at all", async () => {
  stubChrome({ [AUTO_KEY]: { codeforces: 1800 } });
  await storeFetchedRatings({});
  await storeFetchedRatings(null);
  assert.deepEqual(store[AUTO_KEY], { codeforces: 1800 });
});

test("effective ratings are whatever was last fetched", async () => {
  stubChrome({ [AUTO_KEY]: { codeforces: 1800, atcoder: 400 } });
  assert.deepEqual(await getEffectiveRatings(), { codeforces: 1800, atcoder: 400 });
});

test("no data anywhere yields an empty map, not zeroes", async () => {
  // A zero would read as a real rating and make every problem look impossible.
  assert.deepEqual(await getEffectiveRatings(), {});
});
