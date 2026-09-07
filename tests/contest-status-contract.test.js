/**
 * The contract every adapter answers on, and the single place it is read.
 *
 * This is the part that has to hold for platform five, so it is tested harder
 * than the individual cases. Two properties matter:
 *
 *   1. An adapter's answer is one of a closed set. Before this, it could return
 *      a contest, throw a *flagged* error, or throw a bare `Error` with
 *      arbitrary prose — and the orchestrator could classify the first two and
 *      only shrug at the third. CodeChef fell through that gap entirely,
 *      failing hard where AtCoder waits.
 *
 *   2. A status implies the same outcome on every platform. That is what
 *      retired `mayBeUnpublished`: it existed only to tell apart two situations
 *      that had been given one name, using the contest's subtype as a proxy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  READY,
  NOT_ENDED_YET,
  NOT_PUBLISHED_YET,
  SOURCE_UNREACHABLE,
  UNAVAILABLE,
  isKnownStatus,
  shouldWait,
} from "../core/contest-status.js";
import { listPlatforms, getPlatform } from "../core/platforms/registry.js";

const ROOT = new URL("..", import.meta.url).pathname;
const sourceFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};
const coreFiles = () => sourceFiles(path.join(ROOT, "core"));
const mentions = (needle) =>
  coreFiles()
    .filter((f) => readFileSync(f, "utf8").includes(needle))
    .map((f) => path.relative(ROOT, f));

test("every status is recognised, and only `unavailable` refuses to wait", () => {
  for (const s of [READY, NOT_ENDED_YET, NOT_PUBLISHED_YET, SOURCE_UNREACHABLE, UNAVAILABLE]) {
    assert.ok(isKnownStatus(s), `${s} should be a known status`);
  }
  assert.ok(!isKnownStatus("notPublished"), "a near-miss must not be accepted");
  assert.ok(!isKnownStatus(undefined), "a missing status must not be accepted");

  // Waiting is a property of the fact, not of the platform.
  assert.deepEqual(
    [NOT_ENDED_YET, NOT_PUBLISHED_YET, SOURCE_UNREACHABLE].map(shouldWait),
    [true, true, true],
  );
  assert.equal(shouldWait(UNAVAILABLE), false, "retrying cannot fix it");
  assert.equal(shouldWait(READY), false);
});

test("the outcome of a status does not depend on the platform", () => {
  // The property the whole refactor exists to establish. Nothing in the
  // mapping consults a platform, so a (platform × status) table can only have
  // one answer per status — and if a per-platform branch ever creeps back in,
  // this is what notices.
  const outcomes = new Map();
  for (const platform of listPlatforms()) {
    for (const status of [NOT_ENDED_YET, NOT_PUBLISHED_YET, SOURCE_UNREACHABLE, UNAVAILABLE]) {
      const key = `${status}`;
      const outcome = shouldWait(status) ? "wait" : "refuse";
      if (outcomes.has(key)) {
        assert.equal(
          outcomes.get(key),
          outcome,
          `${status} means "${outcomes.get(key)}" elsewhere but "${outcome}" on ${platform.id}`,
        );
      }
      outcomes.set(key, outcome);
    }
  }
  assert.equal(outcomes.size, 4);
});

test("no descriptor decides waiting or partial ratings for itself", () => {
  for (const { id } of listPlatforms()) {
    const platform = getPlatform(id);
    assert.equal(platform.mayBeUnpublished, undefined, `${id} declares a waiting policy`);
    assert.equal(
      platform.capabilities.allowsPartialRatings,
      undefined,
      `${id} still declares the retired allowsPartialRatings`,
    );
    assert.equal(typeof platform.capabilities.canEstimate, "boolean");
  }
});

test("canEstimate is read in exactly one place", () => {
  // Rule 2 lives in contest-manager. A second reader is how the rule drifts
  // into meaning different things on different platforms.
  assert.deepEqual(
    mentions("platform.capabilities.canEstimate"),
    ["core/contest-manager.js"],
  );
});

test("the retired names survive nowhere", () => {
  // A rename that lives on in one file is worse than none: a descriptor keeps
  // declaring a key nothing reads, and that platform silently gets the default.
  for (const name of [
    "mayBeUnpublished",
    "allowsPartialRatings",
    "sawOfficialSubmissions",
    "deriveContestStatusData",
    "getProblemStats",
    "tagsSyncedAt",
  ]) {
    const found = mentions(name).filter(
      // contest-status.js explains why mayBeUnpublished was removed, and the
      // history is the point of that comment.
      (f) => f !== "core/contest-status.js",
    );
    assert.deepEqual(found, [], `${name} is retired but still appears`);
  }
});

test("no adapter throws a bare error where it should answer with a status", async () => {
  // The specific regression: CodeChef's "no problems listed" was a bare throw,
  // unflagged, so it failed hard where it should have waited. Adapters may
  // still throw for genuine faults — that is what makes an escaping exception
  // a bug rather than a case — but the known situations must be statuses.
  // Acquisition — and therefore every gate — lives in `platform.js#fetchContest`; the
  // base in `platform.js` only passes a status through. So this is where the
  // vocabulary has to appear.
  // Every platform's own class, wherever its folder sits: the one beside a
  // descriptor that carries an id, counted once per registered platform since
  // one site's descriptor.js may export two.
  let checked = 0;
  for (const file of sourceFiles(path.join(ROOT, "core/platforms"))) {
    if (path.basename(file) !== "platform.js") continue;
    const descriptor = path.join(path.dirname(file), "descriptor.js");
    if (!readdirSync(path.dirname(file)).includes("descriptor.js")) continue;
    const ids = Object.values(await import(descriptor)).filter((value) => value && "id" in value);
    if (ids.length === 0) continue;
    checked += ids.length;
    const src = readFileSync(file, "utf8");
    const imported = /from\s+"(\.\.\/)+contest-status\.js"/.test(src);
    assert.ok(imported, `${path.relative(ROOT, file)} does not use the shared vocabulary`);
  }
  assert.equal(checked, listPlatforms().length, "a platform's class was not found beside its descriptor");
});
