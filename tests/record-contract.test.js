/**
 * Guards against a whole class of bug, rather than the two instances of it.
 *
 * ## The class
 *
 * A record is handed between modules missing a field the receiver *gates* on,
 * and the gate answers "no" instead of "malformed". Nothing throws, no test
 * fails, and the output is merely wrong.
 *
 * It has happened. `codeforces/problems.js` handed the metadata syncs a record
 * built before the trunk had stamped `type` on it. `problemset-sync.js#needsSync`
 * reads `contest.type !== "OFFICIAL"` and answered `false` — so every official
 * contest silently skipped its published ratings, the estimator then ran on
 * problems Codeforces had already rated, and the queue stored estimates with a
 * mean error of ~211 in their place. 358 tests passed throughout.
 *
 * Two things let that ship, and there is a check here for each:
 *
 *   1. Nothing said which fields a stored contest owes its readers.
 *   2. No test added an OFFICIAL contest, so the branch never ran. Every
 *      Codeforces adapter test used a GYM, where the broken gate happens to
 *      give the right answer.
 *
 * Both checks read the source rather than a hand-written list, so they keep
 * being true as the code moves. A list would have to be remembered, and the
 * whole point is that it wasn't.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildContestRecord } from "../core/platforms/pipeline.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CORE = path.join(ROOT, "core");
const PLATFORMS = path.join(CORE, "platforms");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Prose discusses shapes constantly; only code counts. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (file) => stripComments(readFileSync(file, "utf8"));

/**
 * Shared code — plus `registry.js`, which operates on stored contests — is
 * scanned rather than the platform folders, where `contest` just as often names
 * an API response (`contest.standings`, `contest.phase`) and would pollute this.
 */
const sharedFiles = () =>
  walk(CORE)
    .filter((file) => !file.startsWith(PLATFORMS + path.sep))
    .concat(path.join(PLATFORMS, "registry.js"));

test("the trunk emits every contest field its readers actually read", () => {
  const read_fields = new Set();
  for (const file of sharedFiles()) {
    for (const match of read(file).matchAll(/\bcontest\.([a-zA-Z_]+)/g)) {
      read_fields.add(match[1]);
    }
  }
  assert.ok(read_fields.size >= 5, "the scan found almost nothing; it has stopped working");

  const built = buildContestRecord(
    { id: "codeforces" },
    {
      id: "1",
      sourceId: "0",
      name: "n",
      type: "OFFICIAL",
      problems: [],
      publishedDataCheckedAt: 1,
      startTimeSeconds: 1,
    },
  );

  const missing = [...read_fields].filter((field) => !(field in built));
  assert.deepEqual(
    missing,
    [],
    "shared code reads a contest field the trunk never puts there, so it is " +
      "always undefined — add it to buildContestRecord, or stop reading it",
  );
});

/**
 * The published-ratings path must actually *execute* in some test.
 *
 * An earlier version of this checked whether a test file mentioned
 * `subtype: "OFFICIAL"` anywhere. That was hollow twice over — it was satisfied
 * first by this file's own fixtures, and then by
 * `codeforces-adapter.test.js`'s "an official round Codeforces has not
 * published waits", which returns `notPublishedYet` long before reaching the
 * gate that broke. Mentioning a subtype is not running its branch, and a check
 * that cannot tell the difference reads as coverage while providing none.
 *
 * So this asks the runtime instead of the source. `problemset-sync.js`'s apply
 * body only runs when an official contest gets all the way through, which is
 * precisely what silently stopped happening.
 */
test("some test actually reaches the code that applies published ratings", () => {
  const run = spawnSync(
    process.execPath,
    ["--test", "--experimental-test-coverage", "tests/codeforces-adapter.test.js"],
    {
      cwd: ROOT,
      encoding: "utf8",
      // The test runner marks its children so they report back in its own
      // protocol, which suppresses the coverage table entirely. Clearing it
      // makes the child print the human-readable summary this parses.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    },
  );

  const row = run.stdout
    .split("\n")
    .find((line) => line.includes("codeforces/problemset-sync.js"));

  // Without this, a changed coverage format would make the assertion below
  // vacuous — the same hollowness this test replaced.
  assert.ok(row, "no coverage row for problemset-sync.js; the format has changed");

  const uncovered = (row.split("|").pop() ?? "").trim();
  const ranges = uncovered.split(/\s+/).filter(Boolean).map((range) => {
    const [from, to] = range.split("-").map(Number);
    return { from, to: to ?? from };
  });

  // Located by content, never hardcoded: a fixed line number goes stale the
  // moment anything above it is edited, and a stale one points at some other
  // covered line and passes — silently, which is the failure this whole file
  // exists to prevent.
  const source = readFileSync(
    path.join(PLATFORMS, "codeforces", "problemset-sync.js"),
    "utf8",
  ).split("\n");
  const applyIndex = source.findIndex((line) => line.includes("prob.tags = published.tags"));
  assert.notEqual(applyIndex, -1, "the apply line has been renamed; update this probe");
  const APPLY_LINE = applyIndex + 1;
  const skipped = ranges.some((r) => APPLY_LINE >= r.from && APPLY_LINE <= r.to);

  assert.equal(
    skipped,
    false,
    `problemset-sync.js:${APPLY_LINE} never executes in the Codeforces adapter ` +
      `tests, so nothing proves an official contest keeps its published ` +
      `ratings — this is exactly how the missing \`type\` bug shipped green`,
  );
});
