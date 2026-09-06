/**
 * AtCoder differs from Codeforces in two ways that these tests pin, because
 * both fail silently: a problem belongs to several contests (so identity is
 * the task id), and difficulty is unbounded below (so nothing may clamp).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { atcoder } from "../core/platforms/atcoder/descriptor.js";
import { matchContestUrl, getPlatform } from "../core/platforms/registry.js";

test("contest URLs are recognised, including non-numeric ids", () => {
  for (const [url, id, subtype] of [
    ["https://atcoder.jp/contests/abc471", "abc471", "ABC"],
    ["https://atcoder.jp/contests/abc471/tasks/abc471_d", "abc471", "ABC"],
    ["https://atcoder.jp/contests/arc227", "arc227", "ARC"],
    ["https://atcoder.jp/contests/agc010/standings", "agc010", "AGC"],
    ["https://atcoder.jp/contests/ahc051", "ahc051", "AHC"],
    ["https://atcoder.jp/contests/typical90", "typical90", "OTHER"],
    ["https://atcoder.jp/contests/adt_all_20260820_1", "adt_all_20260820_1", "OTHER"],
  ]) {
    const match = matchContestUrl(url);
    assert.ok(match, `${url} should match`);
    assert.equal(match.platform.id, "atcoder", url);
    assert.equal(match.contestId, id);
    assert.equal(match.subtype, subtype);
  }
});

test("the Codeforces regex would have rejected every one of those", () => {
  // Both old regexes captured (\d+); abc471 and typical90 are not numeric.
  assert.equal(
    getPlatform("codeforces-official").matchUrl("https://atcoder.jp/contests/abc471"),
    null,
  );
});

test("the contest archive is not a contest", () => {
  assert.equal(matchContestUrl("https://atcoder.jp/contests/archive"), null);
  assert.equal(matchContestUrl("https://atcoder.jp/users/tourist"), null);
  assert.equal(matchContestUrl("https://atcoder.jp/"), null);
});

test("solved status keys on the task id, so a reused problem clears everywhere", () => {
  // abc471_a runs in abc471 and again in a daily-training round. Solving it
  // once must clear both.
  const inOriginal = atcoder.solvedKey({ id: "abc471" }, { problemId: "abc471_a", index: "A" });
  const inRerun = atcoder.solvedKey(
    { id: "adt_all_20260820_1" },
    { problemId: "abc471_a", index: "C" },
  );
  assert.equal(inOriginal, inRerun);
  assert.match(inOriginal, /^atcoder:/);
});

test("keys are namespaced away from Codeforces", () => {
  const cf = getPlatform("codeforces-official").solvedKey({ id: "471" }, { index: "A" });
  const ac = atcoder.solvedKey({ id: "abc471" }, { problemId: "471-A", index: "A" });
  assert.notEqual(cf, ac);
});

test("problem URLs use the contest being viewed, not the problem's original", () => {
  const url = atcoder.problemUrl(
    { id: "adt_all_20260820_1" },
    { problemId: "abc471_a", index: "C" },
  );
  assert.equal(url, "https://atcoder.jp/contests/adt_all_20260820_1/tasks/abc471_a");
});

test("a problem with no task id degrades to the contest link, not a wrong one", () => {
  assert.equal(
    atcoder.problemUrl({ id: "abc471" }, { index: "A" }),
    "https://atcoder.jp/contests/abc471",
  );
});

test("AtCoder estimates, so a leftover null is a fault and not a \"???\"", () => {
  // One declared fact rather than two that must agree. It used to be
  // `allowsPartialRatings`, separately declared and the exact inverse of this
  // on all three platforms — so a fourth could have set them inconsistently
  // and made every partly-rated contest silently unaddable.
  //
  // This asserted `false` for as long as AtCoder had no estimator of its own.
  // It has one now — the same one Codeforces uses — so a problem it cannot rate
  // is a fault rather than a fact about the problem, judged in the single place
  // that judges it for every platform.
  assert.equal(atcoder.capabilities.canEstimate, true);
  assert.equal(getPlatform("codeforces-official").capabilities.canEstimate, true);
});
