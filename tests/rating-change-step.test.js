/**
 * A rating that moved is announced *as* the "Updating your queue…" step, not
 * as a message after it. A separate message followed a step lasting
 * milliseconds and read as a flash, so the note replaces that step's message
 * and the step is held while it is read.
 *
 * Driven through the real `updateSolvedStatus` against a stubbed CodeChef,
 * since what is asserted is the order of what reaches `onProgress`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

import { updateSolvedStatus } from "../core/progress-manager.js";
import { getPlatform } from "../core/platforms/registry.js";

// No pacing: nothing here is about request spacing.
getPlatform("codechef").reset(0);

// CodeChef's dashboard is read as a Document.
globalThis.DOMParser = DOMParser;

function stub({ storedRating, siteRating }) {
  const store = {
    trackedContests: [
      {
        id: "START252D",
        platform: "codechef",
        type: "OFFICIAL",
        problems: [{ index: "MODSUB", name: "x", rating: 1000, tags: [], solved: false }],
      },
    ],
    "upsolve_tracker.codechef_handle": "me",
    "upsolve_tracker.platform_ratings": { codechef: storedRating },
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
    if (String(url).endsWith("/dashboard")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return `<script>window.codeChefUserData = {"user":{"username":"me","rating":"${siteRating}"}};</script>`;
        },
      };
    }
    const body = { count: 0, data: [] };
    return {
      ok: true,
      status: 200,
      async json() { return body; },
      async text() { return JSON.stringify(body); },
    };
  };
}

/** An onProgress that records what it was told, and whether it was held. */
function recorder() {
  const events = [];
  const onProgress = (message) => events.push(message);
  onProgress.hold = async () => events.push("<hold>");
  return { events, onProgress };
}

test("a moved rating is the queue step's message, and the step is held", async () => {
  stub({ storedRating: 1355, siteRating: 1402 });
  const { events, onProgress } = recorder();

  const { failures } = await updateSolvedStatus(onProgress);
  assert.deepEqual(failures, []);

  const note = "CodeChef rating change detected (1355 → 1402). Queue reordered.";
  assert.ok(!events.includes("Updating your queue…"), `a separate step was posted: ${events}`);
  assert.deepEqual(events.slice(-2), [note, "<hold>"]);
});

test("an unchanged rating posts the ordinary step, with no hold", async () => {
  stub({ storedRating: 1355, siteRating: 1355 });
  const { events, onProgress } = recorder();

  await updateSolvedStatus(onProgress);

  assert.equal(events.at(-1), "Updating your queue…");
  assert.ok(!events.includes("<hold>"));
});

test("the caller's earlier reading wins, so a change made before the sync is still announced", async () => {
  // The refresh's waiting-contest retry can store the new rating first; by the
  // time the sync runs, storage already agrees with the site.
  stub({ storedRating: 1402, siteRating: 1402 });
  const { events, onProgress } = recorder();

  await updateSolvedStatus(onProgress, { ratingsBefore: { codechef: 1355 } });

  assert.ok(events.includes("CodeChef rating change detected (1355 → 1402). Queue reordered."));
});
