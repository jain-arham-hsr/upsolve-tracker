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
import { spreadPages } from "../core/platforms/codeforces/scraping.js";
import { estimateProblemRating } from "../core/rating-estimator.js";

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

test("the sample is a small fraction of the pages it stands in for", () => {
  for (const field of fields) {
    const pageCount = Math.ceil(field.ratings.length / PER_PAGE);
    const read = HEAD_PAGES + TAIL_PAGES + 2; // +2 to size the field
    assert.ok(read < pageCount / 4, `${read} of ${pageCount} is not a saving`);
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
