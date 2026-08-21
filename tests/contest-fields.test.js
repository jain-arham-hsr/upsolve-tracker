/**
 * Which fields the code reads off a `contest`.
 *
 * This exists because of a real escape: removing the `tagsSynced` fallback left
 * a read of it behind, and the edit that removed its sibling line also mangled
 * the line above into `contest.tagsSyncedAt == nullAt`. Both are valid
 * JavaScript, so `node --check` passed and the build succeeded; the failure
 * only appeared as "Sync failed: nullAt is not defined" at runtime, in the one
 * layer with no automated coverage.
 *
 * A whitelist is a blunt instrument, but it is the cheap half of the fix: a
 * field that is retired, renamed or misspelled has to be removed here too, so
 * the stale read cannot sit unnoticed in a view nobody tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Fields of a stored contest record. */
const STORED = [
  "id",
  "platform",
  "sourceId",
  "name",
  "type",
  "problems",
  "startTimeSeconds",
  "tagsSyncedAt",
];

/**
 * Fields of the platforms' API payloads, which the adapters also happen to
 * call `contest`. Not part of the stored shape.
 */
const API_PAYLOAD = [
  "child_contests",
  "is_a_parent_contest",
  "list",
  "ratingChanges",
  "standings",
  "start_epoch_second",
  "time",
];

const ALLOWED = new Set([...STORED, ...API_PAYLOAD]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("no code reads a contest field that is not part of the shape", () => {
  const root = new URL("../core", import.meta.url).pathname;
  const offenders = [];

  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    for (const match of src.matchAll(/\bcontest\.(\w+)/g)) {
      if (!ALLOWED.has(match[1])) {
        offenders.push(`${path.relative(root, file)}: contest.${match[1]}`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "unknown contest field — retired, renamed, or a typo",
  );
});

test("the retired tag-sync flag is gone", () => {
  // The stored shape carries a timestamp, never a boolean: the timestamp is
  // what distinguishes "never fetched" from "fetched, genuinely untagged".
  assert.ok(ALLOWED.has("tagsSyncedAt"));
  assert.ok(!ALLOWED.has("tagsSynced"));
});
