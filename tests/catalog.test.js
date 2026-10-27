/**
 * The shared catalog: what leaves a stored contest for it, what comes back
 * onto one, and that the owner's refresh writes only what changed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCatalogRatings,
  catalogRecord,
  markPending,
  publishCatalog,
  refreshFromCatalog,
} from "../core/services/catalog.js";
import { fakeFirebase, fakeStorage } from "./helpers/fake-firebase.js";

const contest = (overrides = {}) => ({
  id: "2237",
  platform: "codeforces-official",
  name: "Round",
  type: "OFFICIAL",
  startTimeSeconds: 1,
  startTimeUnavailable: false,
  publishedDataCheckedAt: 1,
  addedAt: 99,
  problems: [
    { index: "A", name: "Alpha", rating: 800, ratingSource: "official", ratingConfidence: null, tags: ["math"], solved: true },
    { index: "B", name: "Beta", rating: 1900, ratingSource: "estimated", ratingConfidence: null, tags: [], solved: false },
  ],
  ...overrides,
});

test("a catalog record carries nothing about the user who added it", () => {
  const record = catalogRecord(contest());
  assert.ok(!("addedAt" in record));
  assert.ok(record.problems.every((problem) => !("solved" in problem)), "solved history would be published");
  assert.deepEqual(record.problems.map((p) => p.rating), [800, 1900]);
});

test("markPending clears every rating, the site's published ones included, and keeps tags", () => {
  const c = markPending(contest());
  assert.deepEqual(c.problems.map((p) => [p.rating, p.ratingSource]), [[null, "pending"], [null, "pending"]]);
  assert.deepEqual(c.problems[0].tags, ["math"]);
});

test("applying the catalog moves ratings and tags, never solved status", () => {
  const mine = markPending(contest());
  const record = catalogRecord(contest({
    problems: [
      { index: "A", name: "Alpha", rating: 900, ratingSource: "official", tags: ["dp"], solved: false },
    ],
  }));

  assert.equal(applyCatalogRatings(mine, record), true);
  assert.equal(mine.problems[0].rating, 900);
  assert.deepEqual(mine.problems[0].tags, ["dp"]);
  assert.equal(mine.problems[0].solved, true, "the user's own solved flag was overwritten");
  // B is not in the record, so it stays pending rather than becoming "???".
  assert.equal(mine.problems[1].ratingSource, "pending");

  assert.equal(applyCatalogRatings(mine, record), false, "a second pass changes nothing");
});

test("the owner publishes only contests that changed, and never a members-only platform", async () => {
  const firebase = fakeFirebase();
  const storage = fakeStorage();
  const group = contest({ id: "g1", platform: "codeforces-group-contests" });

  assert.equal(await publishCatalog([contest(), group], { firebase, storage }), 1);
  assert.deepEqual(firebase.writes, ["set catalog/codeforces-official:2237"]);

  // Solved status is not part of the shared record, so a refresh that only
  // marked problems solved publishes nothing.
  const solvedMore = contest();
  solvedMore.problems[1].solved = true;
  assert.equal(await publishCatalog([solvedMore], { firebase, storage }), 0);

  const rerated = contest();
  rerated.problems[1].rating = 2000;
  assert.equal(await publishCatalog([rerated], { firebase, storage }), 1);
});

test("a refresh asks the catalog only about contests still waiting on it", async () => {
  const firebase = fakeFirebase({
    docs: {
      "catalog/codeforces-official:2237": {
        json: JSON.stringify(catalogRecord(contest())),
        updatedAt: 1,
      },
    },
  });
  const pending = markPending(contest());
  const settled = contest({ id: "1", problems: [{ index: "A", name: "A", rating: 800, ratingSource: "official", tags: [] }] });

  const asked = [];
  const spy = { ...firebase, get: (path) => (asked.push(path), firebase.get(path)) };
  assert.equal(await refreshFromCatalog([pending, settled], { firebase: spy }), 1);

  assert.deepEqual(asked, ["catalog/codeforces-official:2237"], "every lookup is one of 50,000 daily reads");
  assert.deepEqual(pending.problems.map((p) => p.rating), [800, 1900]);
});
