/**
 * The trunk's record contract.
 *
 * `platform.js` builds the stored shape that three platforms used to build
 * separately, so a field it forgets is a field every platform loses at once —
 * and silently, because a missing key reads as "this contest doesn't have one"
 * rather than as a failure.
 *
 * That is not hypothetical. `codeforces/problems.js` briefly handed the metadata
 * syncs a record with no `type`, and `problemset-sync.js#needsSync` gates on
 * `contest.type !== "OFFICIAL"` — so every official add quietly skipped its
 * published ratings and stored estimates instead. The whole suite stayed green,
 * because no test added an official contest. These cases exist so the next
 * omission is loud.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildContestRecord, normalizeProblem } from "../core/platforms/platform.js";

const descriptor = { id: "codeforces-official" };
const base = {
  id: "2197",
  name: "Round 1079",
  type: "OFFICIAL",
  problems: [{ index: "A", name: "Alpha" }],
  publishedDataCheckedAt: 123,
  startTimeSeconds: 456,
};

test("every field the rest of the codebase reads off a contest is present", () => {
  // Derived from grepping `contest.<field>` across core/. If a reader is added
  // for a field the trunk does not emit, this is where it should fail.
  const contest = buildContestRecord(descriptor, base);
  for (const field of [
    "id", "platform", "name", "type", "problems",
    "publishedDataCheckedAt", "startTimeSeconds", "addedAt",
  ]) {
    assert.ok(field in contest, `stored contests are missing ${field}`);
  }
});

test("platform comes from the descriptor, never a literal", () => {
  // `codeforces/adapter.js` used to write `platform: "codeforces-official"` by hand,
  // beside a descriptor that already knew its own id.
  assert.equal(buildContestRecord({ id: "codechef" }, base).platform, "codechef");
});

test("type is carried through, because two syncs gate on it", () => {
  assert.equal(buildContestRecord(descriptor, base).type, "OFFICIAL");
  assert.equal(buildContestRecord(descriptor, { ...base, type: "GYM" }).type, "GYM");
});

test("sourceId appears only when it differs from the stored id", () => {
  // A CodeChef parent contest resolves to a division, so the id stored is not
  // the id the user navigated from — and the add banner needs theirs to see
  // that /START252 is already tracked as START252D. Recording it when the two
  // match would put a redundant key on every other contest.
  const same = buildContestRecord(descriptor, { ...base, sourceId: "2197" });
  assert.equal("sourceId" in same, false);

  const differs = buildContestRecord(descriptor, { ...base, id: "START252D", sourceId: "START252" });
  assert.equal(differs.sourceId, "START252");
});

test("a missing start time stores null rather than undefined", () => {
  // The contest list sorts unknown start times last; `undefined` and `null`
  // survive a JSON round-trip differently, and the backup is JSON.
  const contest = buildContestRecord(descriptor, { ...base, startTimeSeconds: undefined });
  assert.equal(contest.startTimeSeconds, null);
});

test("problem defaults are filled without overwriting real values", () => {
  const [bare] = buildContestRecord(descriptor, base).problems;
  assert.deepEqual(
    { rating: bare.rating, ratingSource: bare.ratingSource, ratingConfidence: bare.ratingConfidence,
      officialSolves: bare.officialSolves, solved: bare.solved, tags: bare.tags },
    { rating: null, ratingSource: null, ratingConfidence: null,
      officialSolves: 0, solved: false, tags: [] },
  );

  // `??`, not `||` — a real 0 and a real false must survive.
  const kept = normalizeProblem({ index: "A", officialSolves: 0, solved: false, rating: 0 });
  assert.equal(kept.officialSolves, 0);
  assert.equal(kept.solved, false);
  assert.equal(kept.rating, 0, "AtCoder difficulties reach 0 and go negative");
});

test("upsolvable is preserved when false and never invented when absent", () => {
  // The subtle one. CodeChef writes this key *only* when a problem was never
  // mirrored to practice; absent means upsolvable, which is every problem on
  // Codeforces and AtCoder. Adding `upsolvable: true` here would turn a
  // meaningful absence into noise on every record — and `pending-problems.js`
  // drops rows on `upsolvable === false`, so inventing the key is one typo away
  // from emptying the queue.
  assert.equal("upsolvable" in normalizeProblem({ index: "A" }), false);
  assert.equal(normalizeProblem({ index: "A", upsolvable: false }).upsolvable, false);
});

test("platform-specific identity fields survive normalisation", () => {
  // AtCoder keys on the task id, CodeChef on the problem code; neither is a
  // field the trunk knows about, so both ride through the spread.
  const p = normalizeProblem({ index: "E", problemId: "abc432_c", name: "Candy Tribulation" });
  assert.equal(p.problemId, "abc432_c");
  assert.equal(p.index, "E");
  assert.equal(p.name, "Candy Tribulation");
});
