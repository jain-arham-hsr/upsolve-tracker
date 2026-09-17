/**
 * What an unrated problem means, and when it is allowed to mean it.
 *
 * `???` carries exactly one claim: **the site says this problem is unrated.**
 * It must never stand in for "we couldn't find out" — which is why a failed
 * CodeChef problem fetch answers `sourceUnreachable` and waits. This file is
 * about the third case that used to be folded into it: **the site hasn't rated
 * it yet.** A contest added the evening it ran stored `???` for problems
 * CodeChef was about to rate days later.
 *
 * So a platform that cannot estimate gets a window — `capabilities.ratingGraceMs`,
 * falling back to a week — inside which a missing rating waits like any other
 * unpublished contest instead of hardening into `???`.
 *
 * The gate this drives (`contest-manager.js`, the `missing.length > 0` block)
 * had **no** test of any kind before this file: nothing in the suite matched
 * any of its strings. So this drives the real `processNewContest` rather than a
 * stub, for the same reason `waiting-quiet.test.js` does — the decision and the
 * error it is carried by are both inside that function.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { getPlatform } = await import("../core/platforms/registry.js");
const { processNewContest } = await import("../core/contest-manager.js");
const { NOT_PUBLISHED_YET } = await import("../core/contest-status.js");

const platform = getPlatform("codechef");
const DAY = 24 * 60 * 60 * 1000;

/** Two problems, one rated and one CodeChef answers `-1` for. */
const PROBLEMS = {
  IOI7: { code: "IOI7", name: "IOI Gold", successful_submissions: "24922" },
  MODSUB: { code: "MODSUB", name: "Mod Subtract", successful_submissions: "1489" },
};

const DETAILS = {
  IOI7: { difficulty_rating: "182", user_tags: [] },
  MODSUB: { difficulty_rating: "-1", user_tags: [] },
};

/**
 * Deep, per the fixture rule in CLAUDE.md: these tests edit `difficulty_rating`
 * and `time.start` to model a contest at a different age, and a shared literal
 * would carry that into whichever test ran next.
 */
const clone = (value) => JSON.parse(JSON.stringify(value));

let store;
let details;
let contest;
let logged;
let realConsole;
let realGrace;

/** Seconds, like CodeChef's own `time.start` — not milliseconds. */
const ranDaysAgo = (days) => Math.floor((Date.now() - days * DAY) / 1000);

const respond = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url: "https://www.codechef.com/x",
  async text() { return body; },
  async json() { return JSON.parse(body); },
});

beforeEach(() => {
  platform.reset();
  realGrace = platform.capabilities.ratingGraceMs;

  details = clone(DETAILS);
  contest = {
    code: "START252D",
    name: "Starters 252 (Rated)",
    is_a_parent_contest: false,
    time: { start: ranDaysAgo(2) },
    problems: clone(PROBLEMS),
    problemsstats: { solved: {}, partially_solved: {}, attempted: {} },
  };

  store = { "upsolve_tracker.codechef_handle": "tourist" };
  globalThis.chrome = {
    storage: {
      local: {
        async get(query) {
          if (query == null) return { ...store };
          if (typeof query === "string") return { [query]: store[query] };
          if (Array.isArray(query)) {
            return Object.fromEntries(query.map((key) => [key, store[key]]));
          }
          const out = {};
          for (const [key, fallback] of Object.entries(query)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return out;
        },
        async set(patch) { Object.assign(store, structuredClone(patch)); },
      },
    },
  };

  globalThis.fetch = async (url) => {
    const target = String(url);

    if (target.endsWith("/dashboard")) {
      return respond(
        `<script>window.codeChefUserData = {"user":{"username":"tourist","rating":"1450"}};</script>`,
      );
    }
    // The user-wide solved list: empty, so nothing is marked and the
    // already-solved branch never fires.
    if (target.includes("/api/list/problems")) {
      return respond(JSON.stringify({ count: 0, data: [] }));
    }
    const problem = target.match(/\/api\/contests\/[^/]+\/problems\/([^/?]+)/);
    if (problem) return respond(JSON.stringify(details[problem[1]] ?? {}));

    if (/\/api\/contests\/START252D$/.test(target)) {
      return respond(JSON.stringify(contest));
    }
    return { ok: false, status: 404, url: target };
  };

  logged = { error: [], warn: [], info: [] };
  realConsole = { error: console.error, warn: console.warn, info: console.info };
  for (const level of ["error", "warn", "info"]) {
    console[level] = (...args) => logged[level].push(args.map(String).join(" "));
  }
});

afterEach(() => {
  Object.assign(console, realConsole);
  platform.capabilities.ratingGraceMs = realGrace;
});

const add = () => processNewContest("https://www.codechef.com/START252D");
const tracked = () => store.trackedContests ?? [];

test("a contest that just ran waits rather than calling an unrated problem ???", async () => {
  const error = await add().then(() => null, (thrown) => thrown);

  assert.ok(error, "the add should not have stored a contest with a pending rating");
  assert.match(error.message, /MODSUB/, "the message should name what is unrated");
  assert.equal(error.isNotPublishedYet, true, "without this no waiting entry is created");
  assert.equal(error.contestStatus, NOT_PUBLISHED_YET, "without this the retry drops it");
  assert.equal(error.isAwaitingRatings, true, "without this the banner claims it is unpublished");

  // The whole point: nothing reached storage. A stored contest cannot be
  // un-stored by a later refresh, and its `???` would be permanent.
  assert.equal(tracked().length, 0, "the contest was stored anyway");

  // Waiting is an expected outcome, so it must not reach chrome://extensions.
  assert.deepEqual(logged.error, []);
  assert.deepEqual(logged.warn, []);
});

test("a fully rated contest is stored at once — the window delays nothing else", async () => {
  details.MODSUB = { difficulty_rating: "1500", user_tags: [] };

  const stored = await add();

  assert.equal(stored.id, "START252D");
  assert.equal(tracked().length, 1);
  assert.deepEqual(
    stored.problems.map((problem) => problem.rating),
    [182, 1500],
  );
});

test("once the window has passed, an unrated problem is stored as ??? again", async () => {
  contest.time.start = ranDaysAgo(10);

  const stored = await add();

  const modsub = stored.problems.find((problem) => problem.index === "MODSUB");
  assert.equal(modsub.rating, null, "-1 should store as null, not as a rating");
  assert.equal(modsub.ratingSource, null);
  assert.equal(tracked().length, 1, "after its window the site's answer is taken as final");
});

test("the window is the platform's own, not the manager's fallback", async () => {
  // While CodeChef's declared week and the default week are equal, nothing can
  // tell which one is being read. Shortening the platform's and choosing an age
  // between the two separates them: this contest is past CodeChef's window and
  // well inside the one-week default.
  platform.capabilities.ratingGraceMs = 3 * DAY;
  contest.time.start = ranDaysAgo(5);

  await add();

  assert.equal(tracked().length, 1, "the fallback was used in place of the declared window");
});

test("a platform declaring no window still gets the manager's week", async () => {
  // The fallback is otherwise unreachable: the only platform that can reach
  // this branch at all declares its own window, so nothing would exercise it
  // and it could be deleted with every test still green.
  delete platform.capabilities.ratingGraceMs;
  contest.time.start = ranDaysAgo(5);

  const error = await add().then(() => null, (thrown) => thrown);

  assert.ok(error, "five days is inside the one-week default, so this should wait");
  assert.equal(error.isNotPublishedYet, true);
  assert.equal(tracked().length, 0);
});

test("a contest with no start time is stored rather than waiting forever", async () => {
  // `buildContestRecord` stamps a fresh `addedAt` on every retry, so there is no
  // moving stamp to fall back on: an undateable contest would be permanently
  // "young" and would never stop waiting.
  delete contest.time;

  const stored = await add();

  assert.equal(stored.startTimeSeconds, null);
  assert.equal(tracked().length, 1, "an undateable contest must not enter the waiting state");
});
