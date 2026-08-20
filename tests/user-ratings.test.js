/**
 * Your rating per platform. This is the highest-leverage number in the queue:
 * a problem's rating misplaces one row, yours misplaces a whole platform's
 * block. So the failure modes here are all about *not* changing it.
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

const {
  mergeRatings,
  storeFetchedRatings,
  getEffectiveRatings,
  setRatingOverride,
  RATING_KEYS,
} = await import("../core/services/user-ratings.js");

const { AUTO_KEY, OVERRIDE_KEY } = RATING_KEYS;

beforeEach(() => stubChrome());

test("a manual override wins over the fetched rating", () => {
  // AtCoder suppresses ratings for the first ~10-15 contests, so a strong
  // newcomer's fetched number is wrong and only they can say so.
  const merged = mergeRatings({ atcoder: 400, codeforces: 1800 }, { atcoder: 1700 });
  assert.deepEqual(merged, { atcoder: 1700, codeforces: 1800 });
});

test("a non-numeric override is ignored rather than blanking the real value", () => {
  assert.deepEqual(mergeRatings({ codeforces: 1800 }, { codeforces: "" }), { codeforces: 1800 });
  assert.deepEqual(mergeRatings({ codeforces: 1800 }, { codeforces: NaN }), { codeforces: 1800 });
});

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

test("effective ratings combine both sources", async () => {
  stubChrome({
    [AUTO_KEY]: { codeforces: 1800, atcoder: 400 },
    [OVERRIDE_KEY]: { atcoder: 1700 },
  });
  assert.deepEqual(await getEffectiveRatings(), { codeforces: 1800, atcoder: 1700 });
});

test("clearing an override falls back to the fetched value", async () => {
  stubChrome({ [AUTO_KEY]: { atcoder: 400 }, [OVERRIDE_KEY]: { atcoder: 1700 } });
  await setRatingOverride("atcoder", "");
  assert.deepEqual(await getEffectiveRatings(), { atcoder: 400 });
});

test("no data anywhere yields an empty map, not zeroes", async () => {
  // A zero would read as a real rating and make every problem look impossible.
  assert.deepEqual(await getEffectiveRatings(), {});
});
