/**
 * The status strip's steps are keyed by site, not platform.
 *
 * Codeforces is two platforms over one account, and each reads the whole
 * submission history on a refresh (see codeforces/CLAUDE.md for why both
 * must). Keyed per platform, the strip showed "Checking your Codeforces
 * submissions…" as two identical steps, each held for the full minimum. Only
 * Codeforces can catch this: on every other site the site id and the
 * platform id are the same string.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { updateSolvedStatus } from "../core/progress-manager.js";
import { getPlatform } from "../core/platforms/registry.js";

// No pacing: nothing here is about request spacing.
getPlatform("codeforces-official").reset(0);
getPlatform("codeforces-gyms").reset(0);

/** Codeforces keeps its key pair in IndexedDB, which Node lacks. */
function stubSecureStore(records = { api_key: "k", api_secret: "s" }) {
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close() {},
          createObjectStore() {},
          transaction: () => ({
            objectStore: () => ({
              get(key) {
                const r = { result: records[key] ?? null };
                queueMicrotask(() => r.onsuccess?.({ target: r }));
                return r;
              },
              put() {},
              delete() {},
            }),
            set oncomplete(fn) { queueMicrotask(fn); },
            set onerror(_fn) {},
          }),
        };
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
}

function stub() {
  stubSecureStore();
  const contest = (platform, id) => ({
    id, platform, type: platform === "codeforces-gyms" ? "GYM" : "OFFICIAL",
    startTimeSeconds: 1790000000,
    publishedDataCheckedAt: Date.now(),
    problems: [{ index: "A", name: "x", rating: 1000, tags: ["math"], solved: false }],
  });
  const store = {
    trackedContests: [contest("codeforces-official", "2266"), contest("codeforces-gyms", "717900")],
    "upsolve_tracker.handle": "me",
  };
  globalThis.chrome = {
    storage: { local: {
      async get(query) {
        if (query == null) return structuredClone(store);
        if (typeof query === "string") return { [query]: store[query] };
        if (Array.isArray(query)) return Object.fromEntries(query.map((k) => [k, store[k]]));
        return Object.fromEntries(
          Object.keys(query).map((k) => [k, k in store ? structuredClone(store[k]) : query[k]]),
        );
      },
      async set(items) { Object.assign(store, structuredClone(items)); },
      async remove() {},
    } },
  };
  globalThis.fetch = async (url) => {
    const result = String(url).includes("user.info")
      ? [{ handle: "me", rating: 1346 }]
      : [];
    return {
      ok: true,
      status: 200,
      async json() { return { status: "OK", result }; },
      async text() { return JSON.stringify({ status: "OK", result }); },
    };
  };
}

test("both Codeforces platforms report as one 'codeforces' step", async () => {
  stub();
  const reported = [];

  const { failures } = await updateSolvedStatus((message, options) =>
    reported.push({ message, step: options?.step ?? null }),
  );
  assert.deepEqual(failures, []);

  const submissions = reported.filter((r) => r.message === "Checking your Codeforces submissions…");
  assert.equal(submissions.length, 2, "each platform reads the history — see codeforces/CLAUDE.md");
  assert.deepEqual(
    submissions.map((r) => r.step),
    ["codeforces", "codeforces"],
    "keyed per platform, the strip shows the same step twice",
  );
});
