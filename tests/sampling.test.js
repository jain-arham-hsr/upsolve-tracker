/**
 * Guards the accuracy claim the sampling rests on: reading ~32 pages must
 * reach the same rating as reading every page.
 *
 * Uniformly random page selection was tried first and is wrong — standings are
 * rank-ordered, so pages are rating clusters rather than random slices. That
 * failure is reproduced here so nobody "simplifies" the design back into it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spreadPages } from "../core/services/scraping-service.js";
import { estimateProblemRating } from "../core/rating-estimator.js";

const PER_PAGE = 50;
const HEAD_PAGES = 10;
const TAIL_PAGES = 20;

/** Deterministic pseudo-random so failures are reproducible. */
function seeded(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** A plausible round: mostly low-rated, long right tail, ranked by rating. */
function buildField(size, seed) {
  const rnd = seeded(seed);
  return Array.from({ length: size }, () => {
    const u = rnd() || 1e-9;
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    return Math.max(800, Math.min(3500, Math.round(1250 + gauss * 450)));
  }).sort((a, b) => b - a);
}

const pageSlice = (field, page) =>
  field.slice((page - 1) * PER_PAGE, page * PER_PAGE);

function stratifiedSample(field) {
  const pageCount = Math.ceil(field.length / PER_PAGE);
  const head = field.slice(0, HEAD_PAGES * PER_PAGE);
  const tail = spreadPages(HEAD_PAGES + 1, pageCount, TAIL_PAGES).flatMap(
    (page) => pageSlice(field, page),
  );
  return {
    strata: [
      { ratings: head, scale: 1 },
      { ratings: tail, scale: (field.length - head.length) / tail.length },
    ],
  };
}

test("spreadPages covers the range evenly and stays inside it", () => {
  const pages = spreadPages(11, 600, 20);
  assert.equal(pages.length, 20);
  assert.ok(pages[0] >= 11 && pages.at(-1) <= 600);
  assert.deepEqual([...pages].sort((a, b) => a - b), pages, "should be ordered");

  const gaps = pages.slice(1).map((page, i) => page - pages[i]);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  assert.ok(spread <= 1, `gaps should be uniform, saw ${Math.min(...gaps)}..${Math.max(...gaps)}`);
});

test("spreadPages returns every page when the range is smaller than the ask", () => {
  assert.deepEqual(spreadPages(5, 9, 20), [5, 6, 7, 8, 9]);
});

test("sampled ratings match full-field ratings within one rounding bucket", () => {
  for (const size of [8000, 15000, 30000, 45000]) {
    const fieldRatings = buildField(size, 7);
    const full = { strata: [{ ratings: fieldRatings, scale: 1 }] };
    const sampled = stratifiedSample(fieldRatings);

    for (const solves of [1, 3, 10, 100, 500, 2000]) {
      if (solves >= size) continue;
      const expected = estimateProblemRating(full, solves);
      const actual = estimateProblemRating(sampled, solves);
      assert.ok(
        Math.abs(expected - actual) <= 100,
        `field ${size}, ${solves} solves: full=${expected} sampled=${actual}`,
      );
    }
  }
});

test("the sample is a small fraction of the pages it stands in for", () => {
  const pageCount = Math.ceil(30000 / PER_PAGE);
  const read = HEAD_PAGES + TAIL_PAGES + 2; // +2 to size the field
  assert.ok(read < pageCount / 10, `${read} of ${pageCount} is not a saving`);
});

test("random page selection is genuinely worse — do not switch back", () => {
  const fieldRatings = buildField(30000, 7);
  const pageCount = Math.ceil(fieldRatings.length / PER_PAGE);
  const full = { strata: [{ ratings: fieldRatings, scale: 1 }] };
  const solves = 30;
  const expected = estimateProblemRating(full, solves);

  const rnd = seeded(99);
  let worstRandom = 0;
  for (let trial = 0; trial < 10; trial++) {
    const pages = new Set();
    while (pages.size < HEAD_PAGES + TAIL_PAGES) {
      pages.add(1 + Math.floor(rnd() * pageCount));
    }
    const ratings = [...pages].flatMap((page) => pageSlice(fieldRatings, page));
    const actual = estimateProblemRating(
      { strata: [{ ratings, scale: fieldRatings.length / ratings.length }] },
      solves,
    );
    worstRandom = Math.max(worstRandom, Math.abs(expected - actual));
  }

  const stratifiedError = Math.abs(
    expected - estimateProblemRating(stratifiedSample(fieldRatings), solves),
  );
  assert.ok(
    worstRandom > stratifiedError,
    `random sampling (${worstRandom}) should be worse than stratified (${stratifiedError})`,
  );
});
