/**
 * The shared row renderer. Both the queue and a contest's expansion go through
 * it, so a difference here is a difference between two views that are supposed
 * to agree.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toProblemRow, renderProblemRow } from "../core/ui/problem-row.js";
import { getPlatform } from "../core/platforms/registry.js";

const build = (platformId, problem, contest = {}, ratings = {}) =>
  toProblemRow(
    {
      contest: { id: "c1", type: "OFFICIAL", startTimeSeconds: 10, ...contest },
      platform: getPlatform(platformId),
      problem,
    },
    ratings,
  );

test("the rating carries no label — the word implied one shared scale", () => {
  const html = renderProblemRow(build("codeforces", { index: "A", name: "X", rating: 1300 }));
  assert.ok(!/Rating:/.test(html), "the 'Rating:' label is what suggested a common axis");
  assert.match(html, />1300</);
});

test("the number is tinted by its own platform's band, not a shared one", () => {
  // 1500 is a different band on each site, which is the entire point.
  const cf = build("codeforces", { index: "A", name: "X", rating: 1500 });
  const cc = build("codechef", { index: "A", name: "X", rating: 1500 });
  assert.equal(cf.tone, "tone-cyan");
  assert.equal(cc.tone, "tone-green");
  assert.notEqual(cf.tone, cc.tone);
});

test("an AtCoder difficulty of exactly 0 renders as rated, not as ???", () => {
  // A truthiness check here would have shown a real 0 as unrated.
  const html = renderProblemRow(build("atcoder", { index: "A", problemId: "a_a", name: "X", rating: 0 }));
  assert.match(html, />0</);
  assert.ok(!/\?\?\?/.test(html));
});

test("a negative difficulty survives — AtCoder's scale runs below zero", () => {
  const html = renderProblemRow(build("atcoder", { index: "A", problemId: "a_a", name: "X", rating: -817 }));
  assert.match(html, />-817</);
});

test("an unrated problem shows ??? and no probability, never a stand-in", () => {
  const html = renderProblemRow(build("codeforces", { index: "A", name: "X", rating: null }));
  assert.match(html, /is-unrated">\?\?\?/);
  assert.match(html, /—/);
});

test("a known rating with no rating of yours shows the number but no chance", () => {
  // The second of the two reasons a row can lack a probability; conflating
  // them would hide a missing *user* rating behind missing problem data.
  const row = build("codeforces", { index: "A", name: "X", rating: 1600 }, {}, {});
  assert.equal(row.solveProbability, null);
  const html = renderProblemRow(row);
  assert.match(html, />1600</);
  assert.match(html, /—/);
});

test("position is optional, so an expansion can omit the queue's global numbering", () => {
  const row = build("codeforces", { index: "A", name: "X", rating: 1300 });
  assert.match(renderProblemRow(row, { position: 7 }), /problem-index">07\./);
  assert.ok(!/problem-index/.test(renderProblemRow(row)));
});

test("names are escaped; a problem title comes from scraped markup", () => {
  const html = renderProblemRow(
    build("codeforces", { index: "A", name: '<img src=x onerror=alert(1)>', rating: 1300 }),
  );
  assert.ok(!/<img/.test(html));
  assert.match(html, /&lt;img/);
});

test("a low-confidence AtCoder model is marked rather than passed off as measured", () => {
  const html = renderProblemRow(
    build("atcoder", { index: "A", problemId: "a_a", name: "X", rating: 1200, ratingConfidence: "experimental" }),
  );
  assert.match(html, /rating-flag/);
});
