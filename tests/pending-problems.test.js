/**
 * Deduplication. Without it the queue shows the same problem several times,
 * which is not hypothetical: CodeChef runs one problem in all four divisions
 * of a Starters, and a fifth of AtCoder's problems appear in more than one
 * contest.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { collectPendingProblems } from "../core/pending-problems.js";

const unsolved = (over = {}) => ({ solved: false, rating: 1000, ...over });

test("a CodeChef problem tracked in two divisions appears once", () => {
  const pending = collectPendingProblems([
    {
      id: "START252C", platform: "codechef", type: "STARTERS", startTimeSeconds: 100,
      problems: [unsolved({ index: "IOI7" }), unsolved({ index: "MEXMAX7" })],
    },
    {
      id: "START252D", platform: "codechef", type: "STARTERS", startTimeSeconds: 100,
      problems: [unsolved({ index: "IOI7" })],
    },
  ]);
  assert.equal(pending.length, 2);
});

test("an AtCoder problem rerun in a later contest appears once, via the newer one", () => {
  const pending = collectPendingProblems([
    {
      id: "abc471", platform: "atcoder", type: "ABC", startTimeSeconds: 100,
      problems: [unsolved({ index: "A", problemId: "abc471_a" })],
    },
    {
      id: "rerun", platform: "atcoder", type: "OTHER", startTimeSeconds: 900,
      problems: [unsolved({ index: "C", problemId: "abc471_a" })],
    },
  ]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].contest.id, "rerun", "the newer contest should win");
});

test("the newer contest wins regardless of storage order", () => {
  const older = {
    id: "abc471", platform: "atcoder", startTimeSeconds: 100,
    problems: [unsolved({ index: "A", problemId: "abc471_a" })],
  };
  const newer = {
    id: "rerun", platform: "atcoder", startTimeSeconds: 900,
    problems: [unsolved({ index: "C", problemId: "abc471_a" })],
  };
  for (const order of [[older, newer], [newer, older]]) {
    const pending = collectPendingProblems(order);
    assert.equal(pending[0].contest.id, "rerun");
  }
});

test("Codeforces problems sharing an index across contests are distinct", () => {
  // A problem belongs to exactly one contest there, so 1993A and 1994A are
  // different problems and must both survive.
  const pending = collectPendingProblems([
    { id: "1993", platform: "codeforces", type: "OFFICIAL", problems: [unsolved({ index: "A" })] },
    { id: "1994", platform: "codeforces", type: "OFFICIAL", problems: [unsolved({ index: "A" })] },
  ]);
  assert.equal(pending.length, 2);
});

test("problems sharing an index across platforms are distinct", () => {
  const pending = collectPendingProblems([
    { id: "1993", platform: "codeforces", type: "OFFICIAL", problems: [unsolved({ index: "A" })] },
    { id: "S1", platform: "codechef", type: "STARTERS", problems: [unsolved({ index: "A" })] },
  ]);
  assert.equal(pending.length, 2);
});

test("solved problems are excluded, and an empty queue is empty", () => {
  const pending = collectPendingProblems([
    { id: "1", platform: "codeforces", problems: [unsolved({ index: "A", solved: true })] },
  ]);
  assert.deepEqual(pending, []);
  assert.deepEqual(collectPendingProblems([]), []);
  assert.deepEqual(collectPendingProblems(undefined), []);
});

/**
 * A problem CodeChef never mirrored to practice can no longer be submitted, so
 * it is not work the queue can offer. It is dropped here rather than in each
 * view, so the queue, the platform ring and both stats histograms cannot end up
 * disagreeing about what "pending" counts.
 */
const start32c = (problems) => ({
  id: "START32C", platform: "codechef", type: "STARTERS", startTimeSeconds: 100, problems,
});

test("a problem that can no longer be submitted is not queued", () => {
  const pending = collectPendingProblems([
    start32c([
      unsolved({ index: "MAXTHEMIN", upsolvable: false }),
      unsolved({ index: "VOLCONTROL" }),
    ]),
  ]);
  assert.deepEqual(pending.map((entry) => entry.problem.index), ["VOLCONTROL"]);
});

test("the contest's own expansion opts back in, so it does not look shorter", () => {
  const pending = collectPendingProblems(
    [
      start32c([
        unsolved({ index: "MAXTHEMIN", upsolvable: false }),
        unsolved({ index: "VOLCONTROL" }),
      ]),
    ],
    { includeUnupsolvable: true },
  );
  assert.deepEqual(pending.map((entry) => entry.problem.index).sort(), [
    "MAXTHEMIN",
    "VOLCONTROL",
  ]);
});

test("solved still wins over unupsolvable, in both modes", () => {
  const contests = [
    start32c([unsolved({ index: "MAXTHEMIN", solved: true, upsolvable: false })]),
  ];
  assert.equal(collectPendingProblems(contests).length, 0);
  assert.equal(collectPendingProblems(contests, { includeUnupsolvable: true }).length, 0);
});

test("an unupsolvable problem still dedupes across divisions when included", () => {
  // The same problem runs in every division of a Starters, so an expansion that
  // opts in must not start double-counting it.
  const pending = collectPendingProblems(
    [
      start32c([unsolved({ index: "MAXTHEMIN", upsolvable: false })]),
      {
        id: "START32D", platform: "codechef", type: "STARTERS", startTimeSeconds: 200,
        problems: [unsolved({ index: "MAXTHEMIN", upsolvable: false })],
      },
    ],
    { includeUnupsolvable: true },
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].contest.id, "START32D");
});
