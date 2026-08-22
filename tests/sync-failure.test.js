/**
 * What a failed sync must not do.
 *
 * This is the guarantee behind the CodeChef identity check, and it cannot be
 * exercised by hand without a second CodeChef account — so it is asserted
 * here instead. The failure mode is silent in both directions: a sync that
 * refuses looks the same to the user as one that corrupts, and `solved` is
 * only ever set true, so a wrong flag can never be undone by a later sync.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { updateSolvedStatus } from "../core/progress-manager.js";

/** chrome.storage.local over a plain object, recording every write. */
function stubStorage(initial) {
  const store = structuredClone(initial);
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(query) {
          if (query === null || query === undefined) return structuredClone(store);
          if (typeof query === "string") return { [query]: store[query] };
          const out = {};
          for (const [key, fallback] of Object.entries(query)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return structuredClone(out);
        },
        async set(items) {
          writes.push(Object.keys(items));
          Object.assign(store, items);
        },
        async remove() {},
      },
    },
  };
  return { store, writes };
}

const queue = () => [
  {
    id: "START252D",
    platform: "codechef",
    type: "STARTERS",
    problems: [
      { index: "MODSUB", solved: true },
      { index: "IOI7", solved: false },
    ],
  },
];

test("a sync where every platform fails writes nothing to the queue", async () => {
  // Signed in as somebody else on CodeChef; no handle or key for the others.
  // Every adapter refuses, so the run must return before touching storage.
  const { store, writes } = stubStorage({ trackedContests: queue() });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/dashboard")
      ? { ok: true, status: 200, async text() {
          return `<script>window.codeChefUserData = {"user":{"username":"someone_else","rating":"1200"}};</script>`;
        } }
      : { ok: false, status: 403 };

  const { removed, failures } = await updateSolvedStatus();

  assert.deepEqual(removed, [], "nothing may be dropped when nothing was verified");
  assert.ok(failures.length > 0, "a refusal must be reported, not swallowed");
  assert.ok(
    !writes.some((keys) => keys.includes("trackedContests")),
    `the queue must not be rewritten by a failed sync (writes: ${JSON.stringify(writes)})`,
  );

  // And the flags themselves are exactly as they were.
  assert.equal(store.trackedContests[0].problems[0].solved, true);
  assert.equal(store.trackedContests[0].problems[1].solved, false);
  assert.equal(store.trackedContests.length, 1, "no contest may be removed");

  delete globalThis.fetch;
  delete globalThis.chrome;
});

test("the wrong CodeChef account never contributes a solved key", async () => {
  // The account this queue belongs to is `me`; the browser is signed in as
  // someone else. Their solves must not be written onto this queue — and
  // because `solved` is sticky, a single bad sync would be unrecoverable.
  const { store } = stubStorage({
    trackedContests: queue(),
    "upsolve_tracker.codechef_handle": "me",
  });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/dashboard")
      ? { ok: true, status: 200, async text() {
          return `<script>window.codeChefUserData = {"user":{"username":"someone_else","rating":"1200"}};</script>`;
        } }
      : { ok: false, status: 403 };

  const { failures } = await updateSolvedStatus();

  assert.ok(
    failures.some((f) => /signed in to codechef as someone_else/i.test(f.message)),
    `expected an identity mismatch, got ${JSON.stringify(failures)}`,
  );
  assert.equal(store.trackedContests[0].problems[1].solved, false, "a foreign solve leaked in");

  delete globalThis.fetch;
  delete globalThis.chrome;
});
