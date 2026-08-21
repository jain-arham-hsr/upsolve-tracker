/**
 * Reconciling solved status is the step that fails quietly: clearing a flag or
 * dropping an unfinished contest both look like ordinary behaviour until the
 * queue is silently wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applySolvedStatus } from "../core/progress-manager.js";
import { codeforces } from "../core/platforms/codeforces/descriptor.js";

const contest = (over = {}) => ({
  id: "2193",
  platform: "codeforces",
  type: "OFFICIAL",
  problems: [
    { index: "A", solved: false },
    { index: "B", solved: false },
  ],
  ...over,
});

test("a matching key marks the problem solved", () => {
  const c = contest();
  const { kept } = applySolvedStatus([c], new Set([codeforces.solvedKey({ id: "2193" }, { index: "A" })]));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].problems[0].solved, true);
  assert.equal(kept[0].problems[1].solved, false);
});

test("an empty solved set never clears an existing flag", () => {
  // The logged-out case: CodeChef answers with an empty solved list rather
  // than an error. That must not resurrect finished problems.
  const c = contest({
    problems: [
      { index: "A", solved: true },
      { index: "B", solved: false },
    ],
  });
  const { kept } = applySolvedStatus([c], new Set());
  assert.equal(kept[0].problems[0].solved, true, "solved status was cleared");
});

test("a fully solved contest is removed and reported", () => {
  const c = contest();
  const keys = new Set([
    codeforces.solvedKey({ id: "2193" }, { index: "A" }),
    codeforces.solvedKey({ id: "2193" }, { index: "B" }),
  ]);
  const { kept, removed } = applySolvedStatus([c], keys);
  assert.equal(kept.length, 0);
  assert.deepEqual(removed, [{ type: "Official contest", id: "2193" }]);
});

test("a gym reports its own label", () => {
  const c = contest({ type: "GYM", problems: [{ index: "A", solved: true }] });
  const { removed } = applySolvedStatus([c], new Set());
  assert.equal(removed[0].type, "Gym contest");
});

test("solved keys are namespaced, so platforms sharing a contest id don't cross-mark", () => {
  // Codeforces 2193A must not mark some other platform's 2193A solved.
  const key = codeforces.solvedKey({ id: "2193" }, { index: "A" });
  assert.match(key, /^codeforces:/);
  assert.notEqual(key, "2193-A");

  const foreign = contest({ platform: "codeforces" });
  const { kept } = applySolvedStatus([foreign], new Set(["2193-A"]));
  assert.equal(kept[0].problems[0].solved, false, "an unnamespaced key matched");
});

test("contests predating platforms reconcile as Codeforces", () => {
  const legacy = { id: "2193", type: "OFFICIAL", problems: [{ index: "A", solved: false }] };
  const { kept, removed } = applySolvedStatus(
    [legacy],
    new Set([codeforces.solvedKey({ id: "2193" }, { index: "A" })]),
  );
  assert.equal(kept.length, 0);
  assert.equal(removed[0].id, "2193");
});
