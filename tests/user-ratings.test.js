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
  stubChrome({ [AUTO_KEY]: { "codeforces-official": 1800, atcoder: 1500 } });
  await storeFetchedRatings({ "codeforces-official": 1850 });

  assert.deepEqual(store[AUTO_KEY], { "codeforces-official": 1850, atcoder: 1500 });
});

test("asking and getting no answer is recorded, unlike failing to ask", async () => {
  // An unrated account genuinely has no rating; that is not the same as the
  // lookup erroring, which never reaches this function.
  stubChrome({ [AUTO_KEY]: { atcoder: 1500 } });
  await storeFetchedRatings({ atcoder: null });
  assert.deepEqual(store[AUTO_KEY], { atcoder: null });
});

test("an empty result set writes nothing at all", async () => {
  stubChrome({ [AUTO_KEY]: { "codeforces-official": 1800 } });
  await storeFetchedRatings({});
  await storeFetchedRatings(null);
  assert.deepEqual(store[AUTO_KEY], { "codeforces-official": 1800 });
});

test("effective ratings are whatever was last fetched", async () => {
  stubChrome({ [AUTO_KEY]: { "codeforces-official": 1800, atcoder: 400 } });
  assert.deepEqual(await getEffectiveRatings(), { "codeforces-official": 1800, atcoder: 400 });
});

test("no data anywhere yields an empty map, not zeroes", async () => {
  // A zero would read as a real rating and make every problem look impossible.
  assert.deepEqual(await getEffectiveRatings(), {});
});

const { ratingChangeMessage } = await import("../core/services/user-ratings.js");

/** What the strip would say, given the ratings before and those now stored. */
async function messageFor(before, after) {
  stubChrome({ [AUTO_KEY]: after });
  return ratingChangeMessage(before);
}

test("a rating change is reported once per site, not once per platform", async () => {
  // Codeforces' official and gym platforms share one rating; two lines saying
  // the same thing would read as two changes.
  const message = await messageFor(
    { "codeforces-official": 1223, "codeforces-gyms": 1223, codechef: 1355 },
    { "codeforces-official": 1346, "codeforces-gyms": 1346, codechef: 1355 },
  );

  assert.equal(message, "Codeforces rating change detected (1223 → 1346). Queue reordered.");
});

test("every site whose rating moved is reported", async () => {
  const message = await messageFor(
    { "codeforces-official": 1223, atcoder: 500, codechef: 1355 },
    { "codeforces-official": 1346, atcoder: 525, codechef: 1355 },
  );

  assert.match(message, /Codeforces rating change detected \(1223 → 1346\)/);
  assert.match(message, /AtCoder rating change detected \(500 → 525\)/);
  assert.doesNotMatch(message, /CodeChef/);
});

test("an unchanged, first or cleared rating is not a change", async () => {
  // A first rating had no earlier order to re-sort; a null is an unrated account.
  assert.equal(await messageFor({ codechef: 1355 }, { codechef: 1355 }), null);
  assert.equal(await messageFor({}, { codechef: 1355 }), null);
  assert.equal(await messageFor({ atcoder: null }, { atcoder: 525 }), null);
  assert.equal(await messageFor({ atcoder: 525 }, { atcoder: null }), null);
});
