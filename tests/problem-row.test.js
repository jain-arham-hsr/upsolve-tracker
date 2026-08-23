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

test("only Codeforces tints its ratings — its colours are the site's own", () => {
  // Everywhere else the same palette would import a rank meaning that does not
  // transfer: "cyan 1600" says something on Codeforces and nothing on CodeChef.
  assert.equal(build("codeforces", { index: "A", name: "X", rating: 1500 }).tone, "tone-cyan");
  assert.equal(build("codeforces", { index: "A", name: "X", rating: 2500 }).tone, "tone-red");
});

test("platforms with no rank scheme of their own render neutral", () => {
  for (const platformId of ["atcoder", "codechef"]) {
    const problem = { index: "A", problemId: "a_a", name: "X", rating: 1500 };
    assert.equal(build(platformId, problem).tone, null);
    assert.match(renderProblemRow(build(platformId, problem)), /class="rating tone-neutral"/);
  }
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

/**
 * A problem that was never mirrored to the platform's practice archive can no
 * longer be submitted. It is out of the queue entirely, and survives only in a
 * contest's expansion — so the mark is what stops it reading as an ordinary
 * pending problem the user simply hasn't got to.
 */
const stranded = { index: "MAXTHEMIN", name: "Maximize the Minimum", rating: 1358, upsolvable: false };

test("a problem that can no longer be submitted is marked, in both row forms", () => {
  for (const options of [{ position: 3 }, { compact: true }]) {
    const html = renderProblemRow(build("codechef", stranded), options);
    assert.match(html, /class="[^"]*\bis-unupsolvable\b/);
    assert.match(html, /upsolve-warn/);
    assert.match(html, /⚠/);
  }
});

test("the mark sits inside the name cell, and leads it", () => {
  // Inside, because `.contest-problems` declares four grid columns and each
  // compact row borrows them with subgrid — a fifth child would drop onto an
  // implicit row of its own, which is the latent bug the experimental-rating
  // flag already has.
  //
  // Leading, because `.compact-name` truncates with an ellipsis: a trailing
  // mark is clipped off the end for long titles, which is precisely when the
  // row most needs explaining. It shipped that way once and was invisible.
  const html = renderProblemRow(build("codechef", stranded), { compact: true });
  assert.match(html, /<span class="compact-name"><span class="upsolve-warn"[^>]*>⚠<\/span> [^<]/);

  const full = renderProblemRow(build("codechef", stranded), { position: 1 });
  assert.match(full, /<div class="problem-title"><span class="upsolve-warn"/);
});

test("the wording names no platform — this renderer is shared by all three", () => {
  const html = renderProblemRow(build("codechef", stranded), { compact: true });
  const [, explanation] = html.match(/class="upsolve-warn" title="([^"]*)"/);
  // The href legitimately contains the origin; the sentence must not name a
  // site, or the shared renderer becomes a view that branches on the platform.
  assert.ok(!/codechef|codeforces|atcoder/i.test(explanation), explanation);
  assert.match(explanation, /submitted/);
});

test("an ordinary problem carries no mark, and neither does an absent flag", () => {
  for (const problem of [
    { index: "VOLCONTROL", name: "Volume Control", rating: 1200 },
    { index: "VOLCONTROL", name: "Volume Control", rating: 1200, upsolvable: true },
  ]) {
    for (const options of [{ position: 1 }, { compact: true }]) {
      const html = renderProblemRow(build("codechef", problem), options);
      assert.ok(!/is-unupsolvable/.test(html));
      assert.ok(!/upsolve-warn/.test(html));
    }
  }
});
