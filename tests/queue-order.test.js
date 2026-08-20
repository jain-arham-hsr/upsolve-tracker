/**
 * The merged queue's ordering. Getting this wrong is silent — the list still
 * renders, just in an order that quietly means nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  solveProbability,
  compareQueueItems,
  formatSolveProbability,
} from "../core/queue-order.js";

test("a problem at your own rating is a coin flip", () => {
  assert.equal(solveProbability(1600, 1600), 0.5);
});

test("probability moves the right way and stays in range", () => {
  assert.ok(solveProbability(1300, 1800) > 0.9);
  assert.ok(solveProbability(2400, 1800) < 0.1);
  for (const [d, r] of [[-1000, 1500], [4000, 800], [0, 0]]) {
    const p = solveProbability(d, r);
    assert.ok(p > 0 && p < 1, `${d}/${r} gave ${p}`);
  }
});

test("negative AtCoder difficulties work — nothing assumes a floor", () => {
  const p = solveProbability(-817, 1200);
  assert.ok(p > 0.99, `expected near-certain, got ${p}`);
});

test("an unknown input gives null, never a default probability", () => {
  assert.equal(solveProbability(null, 1600), null);
  assert.equal(solveProbability(1600, null), null);
  assert.equal(solveProbability(undefined, undefined), null);
  assert.equal(solveProbability(NaN, 1600), null);
});

test("the same rating on two platforms can mean different probabilities", () => {
  // The whole point: a 1600 problem is easy for a 2000 Codeforces user and
  // hard for a 1200 AtCoder one. Raw rating would have sorted them equal.
  const cf = solveProbability(1600, 2000);
  const ac = solveProbability(1600, 1200);
  assert.ok(cf > 0.9 && ac < 0.1);
});

const item = (over = {}) => ({
  platform: "codeforces", contestId: "1", index: "A",
  rating: 1500, solveProbability: 0.5, startTimeSeconds: 100, ...over,
});

test("easier problems come first", () => {
  const sorted = [
    item({ index: "C", solveProbability: 0.2 }),
    item({ index: "A", solveProbability: 0.9 }),
    item({ index: "B", solveProbability: 0.5 }),
  ].sort(compareQueueItems);
  assert.deepEqual(sorted.map((i) => i.index), ["A", "B", "C"]);
});

test("rows with no probability sort after every row that has one", () => {
  const sorted = [
    item({ index: "unrated", rating: null, solveProbability: null }),
    item({ index: "hardest", solveProbability: 0.01 }),
    item({ index: "noUserRating", rating: 1200, solveProbability: null }),
  ].sort(compareQueueItems);
  assert.deepEqual(sorted.map((i) => i.index), ["hardest", "noUserRating", "unrated"]);
});

test("the two reasons for having no probability stay distinct", () => {
  // Rated-but-no-user-rating still carries a meaningful number, so it outranks
  // a problem with no published difficulty at all.
  const sorted = [
    item({ index: "unrated", rating: null, solveProbability: null }),
    item({ index: "rated", rating: 3000, solveProbability: null }),
  ].sort(compareQueueItems);
  assert.deepEqual(sorted.map((i) => i.index), ["rated", "unrated"]);
});

test("without a probability, native rating orders within the band", () => {
  const sorted = [
    item({ index: "hard", rating: 2400, solveProbability: null }),
    item({ index: "easy", rating: 900, solveProbability: null }),
  ].sort(compareQueueItems);
  assert.deepEqual(sorted.map((i) => i.index), ["easy", "hard"]);
});

test("ties break deterministically, so the list doesn't reshuffle on re-render", () => {
  const rows = [
    item({ platform: "codechef", contestId: "S1", index: "B" }),
    item({ platform: "atcoder", contestId: "abc1", index: "A" }),
    item({ platform: "codeforces", contestId: "9", index: "A", startTimeSeconds: 500 }),
    item({ platform: "codeforces", contestId: "8", index: "A", startTimeSeconds: 100 }),
  ];
  const once = [...rows].sort(compareQueueItems).map((i) => `${i.platform}:${i.contestId}${i.index}`);
  const twice = [...rows].reverse().sort(compareQueueItems).map((i) => `${i.platform}:${i.contestId}${i.index}`);
  assert.deepEqual(once, twice, "order depends on input order");
  // Newer contests first within a platform, matching the contest list.
  assert.ok(once.indexOf("codeforces:9A") < once.indexOf("codeforces:8A"));
});

test("probabilities are shown coarsely, because they are modelled", () => {
  assert.equal(formatSolveProbability(0.7234), "~72%");
  assert.equal(formatSolveProbability(0.5), "~50%");
  assert.equal(formatSolveProbability(null), "—");
  assert.equal(formatSolveProbability(undefined), "—");
});

test("a hard problem never reads as 0% — it is an upsolving queue", () => {
  // A 3500-rated problem against a 1450 rating is about 0.0008%.
  assert.equal(formatSolveProbability(solveProbability(3500, 1450)), "~1%");
  assert.equal(formatSolveProbability(0.000001), "~1%");
  assert.equal(formatSolveProbability(0.004), "~1%");
});

test("nothing reads as 100% either — no model is that certain", () => {
  assert.equal(formatSolveProbability(solveProbability(-817, 1450)), "~99%");
  assert.equal(formatSolveProbability(0.9999), "~99%");
  assert.equal(formatSolveProbability(1), "~99%");
});

test("values in between are not nudged — only the extremes clamp", () => {
  // A blanket ceiling would push every one of these up a point.
  assert.equal(formatSolveProbability(0.721), "~72%");
  assert.equal(formatSolveProbability(0.015), "~2%");
  assert.equal(formatSolveProbability(0.985), "~99%");
  assert.equal(formatSolveProbability(0.5049), "~50%");
});

test("clamping is display-only — ordering still separates the hard ones", () => {
  const a = { platform: "cf", contestId: "1", index: "A", rating: 3500, solveProbability: solveProbability(3500, 1450) };
  const b = { platform: "cf", contestId: "1", index: "B", rating: 4000, solveProbability: solveProbability(4000, 1450) };
  assert.equal(formatSolveProbability(a.solveProbability), formatSolveProbability(b.solveProbability));
  assert.ok(compareQueueItems(a, b) < 0, "both show ~1% but 3500 must still come first");
});
