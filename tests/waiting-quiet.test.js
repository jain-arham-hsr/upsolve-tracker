/**
 * Waiting is an expected outcome, and must not be logged as a fault.
 *
 * `console.error` from an extension page is not just console noise: Chrome
 * files it under chrome://extensions as an **extension error**, with a stack
 * trace and a red badge. A contest that has not been published yet produces
 * one on the add, and then another on *every refresh* for as long as it waits
 * — so a feature that is working exactly as designed accumulates a growing
 * list of errors that look like a broken extension.
 *
 * This drives the real `processNewContest`, not a stub, because the logging
 * sits in its catch and the point is what that catch does with a flagged
 * error rather than what the caller does afterwards.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { resetHttpState } = await import("../core/platforms/atcoder/sources.js");
const { processNewContest } = await import("../core/contest-manager.js");

// A contest AtCoder has not finished does not list its problems — the case in
// hand. The tasks page renders, but with no task table in it.
const TASKS_NOT_YET = `<html><body><p>The contest has not started.</p></body></html>`;

const PROFILE = `<html><body><table class="dl-table">
  <tr><th class="no-break">Rating</th><td><span class="user-blue">1600</span></td></tr>
</table></body></html>`;

let store;
let logged;
let real;

beforeEach(() => {
  resetHttpState(0);

  store = { "upsolve_tracker.atcoder_handle": "me" };
  globalThis.chrome = {
    storage: {
      local: {
        // All three call shapes: adapters ask by bare string key, the rest
        // pass a defaults object. Handling only the latter made this look
        // like a missing handle rather than a missing stub.
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
    if (String(url).includes("atcoder.jp/users/")) {
      return { ok: true, status: 200, url: String(url), async text() { return PROFILE; } };
    }
    if (String(url).includes("/tasks")) {
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => null },
        async text() { return TASKS_NOT_YET; },
      };
    }
    return { ok: false, status: 404, url: String(url), headers: { get: () => null } };
  };

  // Both levels are captured because chrome://extensions collects both. A
  // test that only watched console.error passed while the entry was still
  // being filed, just with a yellow triangle instead of a red circle.
  logged = { error: [], warn: [], info: [] };
  real = { error: console.error, warn: console.warn, info: console.info };
  for (const level of ["error", "warn", "info"]) {
    console[level] = (...args) => logged[level].push(args.map(String).join(" "));
  }
});

afterEach(() => {
  Object.assign(console, real);
});

test("a contest that is not published yet is not logged as an extension error", async () => {
  const error = await processNewContest(
    "https://atcoder.jp/contests/abc472",
  ).catch((e) => e);

  // Still thrown — the caller has to know, so it can start waiting.
  assert.equal(error.isNotPublishedYet, true);

  // chrome://extensions gathers error *and* warning levels, so neither may
  // carry this. Asserting only on console.error is what let the first fix
  // ship while the entry was still being filed.
  assert.deepEqual(logged.error, [], "filed under chrome://extensions as an error");
  assert.deepEqual(logged.warn, [], "filed under chrome://extensions as a warning");

  // Still logged, just not as a fault: it has to stay findable in DevTools.
  assert.ok(logged.info.some((line) => line.includes("abc472")));
});

test("a genuine failure is still logged as an error", async () => {
  // The quieting must be scoped to the one flagged case. A handle that does
  // not exist, a retired endpoint or a broken URL are all real faults, and
  // silencing them to fix the noise would remove the only trace they leave.
  const error = await processNewContest("https://example.com/contest/1").catch(
    (e) => e,
  );

  assert.match(error.message, /Not a supported contest URL/);
  assert.equal(logged.error.length, 1);
});
