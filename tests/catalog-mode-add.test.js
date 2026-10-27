/**
 * Adding a contest on an install that is not the owner's.
 *
 * Every rating such an install shows comes from the shared catalog — the
 * site's own published ones included — so the add reads only the problem list
 * and stores the rest pending. Driven through the real `processNewContest`
 * against a stubbed CodeChef, the same way `contest-gap-policy.test.js` is,
 * because the decisions (skip the fetch on a hit, strip ratings on a miss,
 * skip the gap policy) all live inside it.
 *
 * CodeChef is the sharpest case: it *publishes* a difficulty, so a catalog
 * mode that let it through would show the site's number beside the catalog's
 * elsewhere, and it is the platform whose grace window would otherwise hold a
 * fresh contest back to wait for a rating this install will never use.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { getPlatform } = await import("../core/platforms/registry.js");
const { processNewContest } = await import("../core/contest-manager.js");

const platform = getPlatform("codechef");
const clone = (value) => JSON.parse(JSON.stringify(value));

const PROBLEMS = {
  IOI7: { code: "IOI7", name: "IOI Gold", successful_submissions: "24922" },
  MODSUB: { code: "MODSUB", name: "Mod Subtract", successful_submissions: "1489" },
};
const DETAILS = {
  IOI7: { difficulty_rating: "182", user_tags: [] },
  // Unrated on the site and the contest ran yesterday: in local mode this
  // waits out CodeChef's grace window rather than storing.
  MODSUB: { difficulty_rating: "-1", user_tags: [] },
};

let store;
let fetched;

beforeEach(() => {
  platform.reset();
  fetched = [];
  store = { "upsolve_tracker.codechef_handle": "tourist" };
  globalThis.chrome = {
    storage: {
      local: {
        async get(query) {
          if (query == null) return { ...store };
          if (typeof query === "string") return { [query]: store[query] };
          if (Array.isArray(query)) return Object.fromEntries(query.map((k) => [k, store[k]]));
          return Object.fromEntries(
            Object.entries(query).map(([k, fallback]) => [k, k in store ? store[k] : fallback]),
          );
        },
        async set(patch) { Object.assign(store, structuredClone(patch)); },
      },
    },
  };

  const contest = {
    code: "START252D",
    name: "Starters 252 (Rated)",
    is_a_parent_contest: false,
    time: { start: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) },
    problems: clone(PROBLEMS),
    problemsstats: { solved: {}, partially_solved: {}, attempted: {} },
  };
  const details = clone(DETAILS);
  const respond = (body) => ({
    ok: true, status: 200, url: "https://www.codechef.com/x",
    async text() { return body; }, async json() { return JSON.parse(body); },
  });

  globalThis.fetch = async (url) => {
    const target = String(url);
    fetched.push(target);
    if (target.endsWith("/dashboard")) {
      return respond(`<script>window.codeChefUserData = {"user":{"username":"tourist","rating":"1450"}};</script>`);
    }
    if (target.includes("/api/list/problems")) return respond(JSON.stringify({ count: 0, data: [] }));
    const problem = target.match(/\/api\/contests\/[^/]+\/problems\/([^/?]+)/);
    if (problem) return respond(JSON.stringify(details[problem[1]] ?? {}));
    if (/\/api\/contests\/START252D$/.test(target)) return respond(JSON.stringify(contest));
    return { ok: false, status: 404, url: target };
  };
});

/** A catalog holding these records, recording which keys were asked for. */
function catalog(records = {}) {
  const asked = [];
  return {
    asked,
    async get(path) {
      asked.push(path);
      const record = records[path.replace(/^catalog\//, "")];
      return record ? { json: JSON.stringify(record), updatedAt: 1 } : null;
    },
  };
}

const add = (firebase) =>
  processNewContest("https://www.codechef.com/START252D", () => {}, { mode: "catalog", firebase });

test("a catalog miss stores the problem list with every rating pending, the site's included", async () => {
  const stored = await add(catalog());

  assert.deepEqual(
    stored.problems.map((p) => [p.index, p.rating, p.ratingSource]),
    [["IOI7", null, "pending"], ["MODSUB", null, "pending"]],
    "CodeChef's own 182 must not reach a catalog-mode queue",
  );
  // Stored at once: the grace window exists to wait for a site rating, which
  // this install would discard anyway.
  assert.equal(store.trackedContests.length, 1);
});

test("a catalog hit is the whole add: no contest fetched, ratings from the catalog", async () => {
  const firebase = catalog({
    "codechef:START252D": {
      id: "START252D", platform: "codechef", name: "Starters 252 (Rated)", type: "STARTERS",
      startTimeSeconds: 1, startTimeUnavailable: false, publishedDataCheckedAt: 1,
      problems: [
        { index: "IOI7", name: "IOI Gold", rating: 900, ratingSource: "official", tags: [] },
        { index: "MODSUB", name: "Mod Subtract", rating: null, ratingSource: null, tags: [] },
      ],
    },
  });

  const stored = await add(firebase);

  assert.ok(!fetched.some((url) => /\/api\/contests\//.test(url)), "the contest was fetched anyway");
  assert.deepEqual(stored.problems.map((p) => p.rating), [900, null]);
  // The catalog says the site has not rated MODSUB: that is "???", not "…".
  assert.equal(stored.problems[1].ratingSource, null);
  assert.ok(stored.problems.every((p) => p.solved === false));
  assert.equal(typeof stored.addedAt, "number");
});

test("an unreadable catalog still adds the contest, pending", async () => {
  const firebase = { async get() { throw new Error("permission-denied"); } };
  const stored = await add(firebase);
  assert.ok(stored.problems.every((p) => p.ratingSource === "pending"));
});
