/**
 * Guards the accuracy claim the sampling rests on: reading ~32 pages must
 * reach the same rating as reading every page.
 *
 * Runs against real Codeforces rounds captured in tests/fixtures — rank order,
 * pre-contest ratings and in-contest solve counts all as they actually were.
 * That matters: a synthetic field sorted perfectly by rating overstates how
 * clustered standings pages really are (real rank/rating correlation is about
 * -0.65), so simulated results are not a substitute here.
 *
 * Uniformly random page selection was tried first and is wrong — standings are
 * rank-ordered, so pages are rating clusters rather than random slices. That
 * failure is reproduced below so the rejected design can't quietly come back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spreadPages, stratifyRows } from "../core/platforms/codeforces-official/sources/sampling.js";
import { estimateProblemRating } from "../core/platforms/codeforces-official/estimator.js";

const PER_PAGE = 50;
const HEAD_PAGES = 10;
const TAIL_PAGES = 20;

const { fields } = JSON.parse(
  readFileSync(new URL("./fixtures/real-contest-fields.json", import.meta.url)),
);

const fullField = (ratings) => ({ strata: [{ ratings, scale: 1 }] });
const pageSlice = (ratings, page) =>
  ratings.slice((page - 1) * PER_PAGE, page * PER_PAGE);

function stratifiedSample(ratings) {
  const pageCount = Math.ceil(ratings.length / PER_PAGE);
  const head = ratings.slice(0, HEAD_PAGES * PER_PAGE);
  const tail = spreadPages(HEAD_PAGES + 1, pageCount, TAIL_PAGES).flatMap(
    (page) => pageSlice(ratings, page),
  );
  return {
    strata: [
      { ratings: head, scale: 1 },
      { ratings: tail, scale: (ratings.length - head.length) / tail.length },
    ],
  };
}

test("the fixture holds real, plausibly-shaped fields", () => {
  assert.ok(fields.length >= 2);
  for (const field of fields) {
    assert.ok(field.ratings.length > 5000, `${field.name} is too small to sample`);
    assert.ok(field.problems.length > 0);
    // Codeforces ratings really do go below zero; the estimator must cope.
    assert.ok(Math.min(...field.ratings) < 800);
  }
});

test("sampled ratings match full-field ratings on real contests", () => {
  for (const field of fields) {
    const full = fullField(field.ratings);
    const sampled = stratifiedSample(field.ratings);

    for (const problem of field.problems) {
      const expected = estimateProblemRating(full, problem.solves);
      const actual = estimateProblemRating(sampled, problem.solves);
      assert.ok(
        Math.abs(expected - actual) <= 100,
        `${field.name} ${problem.index} (${problem.solves} solves): full=${expected} sampled=${actual}`,
      );
    }
  }
});

test("stratified sampling beats random pages on real standings order", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (const field of fields) {
    const full = fullField(field.ratings);
    const pageCount = Math.ceil(field.ratings.length / PER_PAGE);
    let stratifiedWorst = 0;
    let randomWorst = 0;

    for (const problem of field.problems) {
      const truth = estimateProblemRating(full, problem.solves);
      stratifiedWorst = Math.max(
        stratifiedWorst,
        Math.abs(truth - estimateProblemRating(stratifiedSample(field.ratings), problem.solves)),
      );

      for (let trial = 0; trial < 15; trial++) {
        const pages = new Set();
        while (pages.size < HEAD_PAGES + TAIL_PAGES) {
          pages.add(1 + Math.floor(rnd() * pageCount));
        }
        const ratings = [...pages].flatMap((page) => pageSlice(field.ratings, page));
        const got = estimateProblemRating(
          { strata: [{ ratings, scale: field.ratings.length / ratings.length }] },
          problem.solves,
        );
        randomWorst = Math.max(randomWorst, Math.abs(truth - got));
      }
    }

    assert.ok(
      randomWorst > stratifiedWorst,
      `${field.name}: random pages (${randomWorst}) should be worse than stratified (${stratifiedWorst})`,
    );
  }
});

test("the sample is a small fraction of the field it stands in for", () => {
  for (const field of fields) {
    const blockCount = Math.ceil(field.ratings.length / PER_PAGE);
    assert.ok(
      HEAD_PAGES + TAIL_PAGES < blockCount / 4,
      `${HEAD_PAGES + TAIL_PAGES} of ${blockCount} is not a saving`,
    );
  }
});

/**
 * The tests above measure a *model* of the sample — `stratifiedSample`, written
 * here — because that is what makes the accuracy claim checkable against a
 * captured field. These check that production actually implements that model.
 *
 * That gap was real rather than theoretical: until recently `stratifyRows` read
 * ~32 paginated HTML pages while this file sliced an array, so the two could
 * have drifted and every test above would still have passed.
 */
const partiesOf = (n) =>
  Array.from({ length: n }, (_, i) => ({ party: { members: [{ handle: `u${i}` }] } }));
const sampled = (result) => result.groups.reduce((n, g) => n + g.parties.length, 0);
const represented = (result) =>
  result.groups.reduce((n, g) => n + g.parties.length * g.scale, 0);

test("stratifyRows reproduces the model this file measures", () => {
  for (const field of fields) {
    const { groups } = stratifyRows(partiesOf(field.ratings.length));
    const model = stratifiedSample(field.ratings);

    assert.equal(groups.length, model.strata.length, "different number of strata");
    groups.forEach((group, i) => {
      assert.equal(group.parties.length, model.strata[i].ratings.length);
      assert.equal(group.scale, model.strata[i].scale);
    });

    // Positional, not just sized: a head that sampled the *bottom* 500 would
    // match on every count above and be the exact mistake this design avoids.
    assert.equal(groups[0].parties[0][0], "u0", "the head must start at rank 1");
  }
});

test("a small field is taken whole, as one unweighted group", () => {
  const result = stratifyRows(partiesOf(600)); // 12 blocks, under the threshold
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].scale, 1);
  assert.equal(result.total, 600);
  assert.equal(sampled(result), 600);
});

test("a large field is sampled at a fixed cost, and the weights add back up", () => {
  const result = stratifyRows(partiesOf(4000)); // 80 blocks
  assert.equal(result.total, 4000);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].scale, 1, "head must be unweighted");
  assert.ok(sampled(result) <= 32 * 50, `sampled ${sampled(result)}`);
  // If these don't sum back to the field, every rating in the contest shifts.
  assert.equal(Math.round(represented(result)), 4000);
});

test("a partial final block is measured, not assumed full", () => {
  // 3,975 is 79 blocks of 50 plus 25. The paginated version had to fetch the
  // last page to learn this; the row count says it outright, which is why the
  // understated-page-count guard it used to carry no longer has anything to
  // guard against.
  const result = stratifyRows(partiesOf(3975));
  assert.equal(result.total, 3975);
  assert.equal(Math.round(represented(result)), 3975);
});

test("no competitor is counted twice across strata", () => {
  const result = stratifyRows(partiesOf(4000));
  const all = result.groups.flatMap((g) => g.parties).flat();
  assert.equal(all.length, new Set(all).size);
});

test("an empty or missing field samples nothing rather than guessing", () => {
  for (const rows of [[], null, undefined]) {
    assert.deepEqual(stratifyRows(rows), { groups: [], total: 0 });
  }
});

test("spreadPages covers the range evenly and stays inside it", () => {
  const pages = spreadPages(11, 600, 20);
  assert.equal(pages.length, 20);
  assert.ok(pages[0] >= 11 && pages.at(-1) <= 600);
  assert.deepEqual([...pages].sort((a, b) => a - b), pages, "should be ordered");

  const gaps = pages.slice(1).map((page, i) => page - pages[i]);
  assert.ok(
    Math.max(...gaps) - Math.min(...gaps) <= 1,
    `gaps should be uniform, saw ${Math.min(...gaps)}..${Math.max(...gaps)}`,
  );
});

test("spreadPages returns every page when the range is smaller than the ask", () => {
  assert.deepEqual(spreadPages(5, 9, 20), [5, 6, 7, 8, 9]);
});
