/**
 * Reconciling solved status is the step that fails quietly: clearing a flag or
 * dropping an unfinished contest both look like ordinary behaviour until the
 * queue is silently wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applySolvedStatus } from "../core/progress-manager.js";
import { codeforcesOfficial as codeforces } from "../core/platforms/codeforces/descriptor.js";
import { getPlatform } from "../core/platforms/registry.js";

const contest = (over = {}) => ({
  id: "2193",
  platform: "codeforces-official",
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
  // The label comes off the platform now rather than off `contest.type`, so the
  // record has to name the platform that owns it.
  const c = contest({
    platform: "codeforces-gyms",
    type: "GYM",
    problems: [{ index: "A", solved: true }],
  });
  const { removed } = applySolvedStatus([c], new Set());
  assert.equal(removed[0].type, "Gym contest");
});

test("solved keys are namespaced, so platforms sharing a contest id don't cross-mark", () => {
  // Codeforces 2193A must not mark some other platform's 2193A solved.
  const key = codeforces.solvedKey({ id: "2193" }, { index: "A" });
  assert.match(key, /^codeforces-official:/);
  assert.notEqual(key, "2193-A");

  const foreign = contest({ platform: "codeforces-official" });
  const { kept } = applySolvedStatus([foreign], new Set(["2193-A"]));
  assert.equal(kept[0].problems[0].solved, false, "an unnamespaced key matched");
});

test("the two Codeforces platforms do not cross-mark each other", () => {
  // Each adapter reads the whole account's `user.status` and stamps its own
  // prefix, so both sets are in play at once. A gym key must not mark an
  // official problem solved, or a shared contest number would clear the wrong
  // row — and `solved` is never cleared again.
  const official = contest();
  const gymKey = getPlatform("codeforces-gyms").solvedKey({ id: "2193" }, { index: "A" });

  const { kept } = applySolvedStatus([official], new Set([gymKey]));
  assert.equal(kept[0].problems[0].solved, false, "a gym key marked an official problem");
});

