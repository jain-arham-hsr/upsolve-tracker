/**
 * The refresh on an install that is not the owner's: ratings arrive from the
 * shared catalog, and never from the sites' own metadata passes, which would
 * write published ratings beside the catalog's.
 *
 * Driven through the real `updateSolvedStatus` against a stubbed CodeChef —
 * the platform with a metadata pass of its own (late difficulty ratings) —
 * since both decisions are made inside it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

import { updateSolvedStatus } from "../core/progress-manager.js";
import { getPlatform } from "../core/platforms/registry.js";
import { fakeFirebase, fakeStorage } from "./helpers/fake-firebase.js";

const platform = getPlatform("codechef");
platform.reset(0);
globalThis.DOMParser = DOMParser;

const tracked = () => ({
  id: "START252D",
  platform: "codechef",
  type: "OFFICIAL",
  problems: [
    { index: "MODSUB", name: "x", rating: null, ratingSource: "pending", tags: [], solved: false },
    { index: "IOI7", name: "y", rating: null, ratingSource: "pending", tags: [], solved: false },
  ],
});

function stubSite(storage) {
  globalThis.chrome = { storage: { local: storage } };
  globalThis.fetch = async (url) => {
    const body = String(url).endsWith("/dashboard")
      ? `<script>window.codeChefUserData = {"user":{"username":"me","rating":"1400"}};</script>`
      : JSON.stringify({ count: 0, data: [] });
    return { ok: true, status: 200, async text() { return body; }, async json() { return JSON.parse(body); } };
  };
}

async function refresh(mode, firebase) {
  const storage = fakeStorage({
    trackedContests: [tracked()],
    "upsolve_tracker.codechef_handle": "me",
  });
  stubSite(storage);

  let metadataPasses = 0;
  const real = platform.syncMetadata;
  platform.syncMetadata = async () => { metadataPasses++; };
  try {
    await updateSolvedStatus(() => {}, { mode, firebase });
  } finally {
    platform.syncMetadata = real;
  }
  return { metadataPasses, contests: storage.data.trackedContests };
}

const catalog = () =>
  fakeFirebase({
    docs: {
      "catalog/codechef:START252D": {
        updatedAt: 1,
        json: JSON.stringify({
          id: "START252D",
          platform: "codechef",
          problems: [{ index: "MODSUB", name: "x", rating: 1500, ratingSource: "official", tags: ["dp"] }],
        }),
      },
    },
  });

test("catalog mode fills pending ratings from the catalog and skips the sites' metadata passes", async () => {
  const { metadataPasses, contests } = await refresh("catalog", catalog());

  assert.equal(metadataPasses, 0, "a site's metadata pass ran and could write its own ratings");
  const [modsub, ioi7] = contests[0].problems;
  assert.equal(modsub.rating, 1500);
  assert.deepEqual(modsub.tags, ["dp"]);
  assert.equal(ioi7.ratingSource, "pending", "a problem the catalog lacks stays pending");
});

test("outside catalog mode the metadata passes run and the catalog is never asked", async () => {
  const firebase = catalog();
  firebase.fail(new Error("the catalog should not have been read"));
  const { metadataPasses } = await refresh("local", firebase);
  assert.equal(metadataPasses, 1);
});
