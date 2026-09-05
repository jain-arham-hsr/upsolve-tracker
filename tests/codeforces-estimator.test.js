import test from "node:test";
import assert from "node:assert/strict";
import { estimateProblemRating } from "../core/platforms/codeforces/estimator.js";

const field = (ratings) => ({ strata: [{ ratings, scale: 1 }] });
const uniform = (n, rating) => Array.from({ length: n }, () => rating);

test("returns null rather than guessing when there is nothing to measure", () => {
  assert.equal(estimateProblemRating(null, 5), null);
  assert.equal(estimateProblemRating({ strata: [] }, 5), null);
  assert.equal(estimateProblemRating(field([]), 5), null);
  assert.equal(estimateProblemRating({ strata: [{ ratings: [], scale: 3 }] }, 5), null);
  assert.equal(estimateProblemRating(field([1500]), -1), null);
});

test("fewer solves means a harder problem", () => {
  const people = [...uniform(500, 1200), ...uniform(300, 1700), ...uniform(200, 2200)];
  const ratings = [1, 10, 100, 400, 800].map((solves) =>
    estimateProblemRating(field(people), solves),
  );

  for (let i = 1; i < ratings.length; i++) {
    assert.ok(
      ratings[i] <= ratings[i - 1],
      `expected monotonic decrease, got ${ratings.join(" -> ")}`,
    );
  }
  assert.ok(ratings[0] > ratings.at(-1), "hardest should outrank easiest");
});

test("answers land on the 100-point grid, never below the 800 floor", () => {
  const people = uniform(1000, 1500);
  for (const solves of [1, 7, 50, 200, 900, 999]) {
    const rating = estimateProblemRating(field(people), solves);
    assert.equal(rating % 100, 0, `${rating} is off-grid`);
    assert.ok(rating >= 800, `${rating} is below the floor`);
  }
});

test("a problem nobody solved rates above one solved once", () => {
  const people = uniform(2000, 1600);
  assert.ok(
    estimateProblemRating(field(people), 0) >=
      estimateProblemRating(field(people), 1),
  );
});

test("scale makes a sampled stratum stand in for the field it came from", () => {
  const people = [...uniform(2000, 1300), ...uniform(1000, 1900)];
  // Every third competitor, weighted x3, should reach the same conclusion.
  const sample = people.filter((_, i) => i % 3 === 0);
  const scaled = { strata: [{ ratings: sample, scale: people.length / sample.length }] };

  for (const solves of [5, 60, 600]) {
    assert.equal(
      estimateProblemRating(scaled, solves),
      estimateProblemRating(field(people), solves),
      `sampled estimate diverged at ${solves} solves`,
    );
  }
});

test("strata combine additively rather than one overriding the other", () => {
  const head = uniform(100, 2400);
  const tail = uniform(900, 1200);
  const combined = { strata: [{ ratings: head, scale: 1 }, { ratings: tail, scale: 1 }] };

  const both = estimateProblemRating(combined, 50);
  const headOnly = estimateProblemRating(field(head), 50);
  const tailOnly = estimateProblemRating(field(tail), 50);

  // More people able to solve it means the same solve count implies a harder
  // problem than either group alone would suggest.
  assert.ok(both >= headOnly, `${both} should be >= head-only ${headOnly}`);
  assert.ok(both >= tailOnly, `${both} should be >= tail-only ${tailOnly}`);
});

test("empty strata are ignored, not treated as zero-strength competitors", () => {
  const people = uniform(500, 1500);
  assert.equal(
    estimateProblemRating(
      { strata: [{ ratings: [], scale: 10 }, { ratings: people, scale: 1 }] },
      25,
    ),
    estimateProblemRating(field(people), 25),
  );
});
