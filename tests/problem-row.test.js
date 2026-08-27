/**
 * The shared row renderer. Both the queue and a contest's expansion go through
 * it, so a difference here is a difference between two views that are supposed
 * to agree.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toProblemRow, renderProblemRow } from "../core/ui/problem-row.js";
import { getPlatform } from "../core/platforms/registry.js";
import { DOMParser } from "linkedom";

/**
 * The estimate mark is a decoration on the number, not a glyph beside it — a
 * "~" cost four consecutive layout bugs because one character of width competes
 * with the digits for space. So "marked" is a state on the rating cell, and
 * nothing about it can move anything.
 */
const isMarked = (html) => /class="(?:rating|compact-rating)[^"]*is-estimated/.test(html);

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
  assert.ok(isMarked(html));
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

/**
 * An unmarked number reads as exact. Most Codeforces gym problems are not:
 * measured against the 62 gym problems Codeforces also rates, the estimate ran
 * a mean 211 off, and 14 of them by 400 or more. So an inferred number says so.
 */
test("an estimated rating is marked", () => {
  const html = renderProblemRow(
    build("codeforces", { index: "A", name: "X", rating: 1400, ratingSource: "estimated" }),
  );
  assert.ok(isMarked(html));
  assert.match(html, /Codeforces publishes no rating/);
});

test("a published rating is not marked at all", () => {
  const html = renderProblemRow(
    build("codeforces", { index: "A", name: "X", rating: 1400, ratingSource: "official" }),
  );
  assert.ok(!isMarked(html));
  // No tooltip either: hovering an ordinary rating should not explain a mark
  // that is not there.
  assert.doesNotMatch(html, /class="rating[^"]*"[^>]*title=/);
});

test("AtCoder's own low-confidence model is marked, with its own wording", () => {
  const html = renderProblemRow(
    build("atcoder", {
      index: "A", problemId: "a_a", name: "X", rating: 1400,
      ratingSource: "official", ratingConfidence: "experimental",
    }),
  );
  assert.ok(isMarked(html));
  assert.match(html, /Low-confidence estimate/);
});

test("a problem that is both experimental and estimated gets one mark, not two", () => {
  const html = renderProblemRow(
    build("codeforces", {
      index: "A", name: "X", rating: 1400,
      ratingSource: "estimated", ratingConfidence: "experimental",
    }),
  );
  assert.equal(html.match(/is-estimated/g).length, 1);
  assert.ok(isMarked(html));
});

test("a problem with no rating at all is not marked as an estimate", () => {
  // "???" already says the number is absent; underlining it would claim there
  // is a soft number when there is none.
  for (const source of [null, "estimated"]) {
    const html = renderProblemRow(
      build("codeforces", { index: "A", name: "X", rating: null, ratingSource: source }),
    );
    assert.match(html, /\?\?\?</);
    assert.ok(!isMarked(html), `rating null + ratingSource ${source}`);
  }
});

/**
 * `.contest-problems` declares four columns and each compact row borrows them
 * with `subgrid`. A fifth child therefore drops onto an implicit row of its
 * own, under the row it belongs to.
 *
 * This is not hypothetical. The "~" flag shipped as a fifth child and put a
 * stray mark on the line below every estimated problem in a contest's
 * expansion — while the unit tests, which matched the HTML string, passed.
 * Counting children is the check that catches it; asserting where the mark
 * sits would not.
 */
const compactChildren = (problem) => {
  const html = renderProblemRow(build("codeforces", problem), { compact: true });
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return [...doc.querySelector("a.problem-row").children];
};

test("a compact row has exactly four children, whatever marks it carries", () => {
  const cases = {
    plain: { index: "A", name: "X", rating: 1800, ratingSource: "official" },
    estimated: { index: "A", name: "X", rating: 1800, ratingSource: "estimated" },
    experimental: { index: "A", name: "X", rating: 1800, ratingConfidence: "experimental" },
    unupsolvable: { index: "A", name: "X", rating: 1800, upsolvable: false },
    both: {
      index: "A", name: "X", rating: 1800,
      ratingSource: "estimated", upsolvable: false,
    },
    unrated: { index: "A", name: "X", rating: null },
  };
  for (const [label, problem] of Object.entries(cases)) {
    assert.equal(compactChildren(problem).length, 4, `${label} row broke the four-column grid`);
  }
});

test("the compact marks sit inside a cell, not beside it", () => {
  const [, nameCell, , ratingCell] = compactChildren({
    index: "A", name: "X", rating: 1800,
    ratingSource: "estimated", upsolvable: false,
  });
  // The ⚠ is still an element and still has to live inside the name cell: a
  // fifth child of this four-column subgrid drops onto a row of its own.
  assert.match(nameCell.innerHTML, /upsolve-warn/, "the warning belongs in the name cell");
  // The estimate mark is no longer an element at all — it is a state on the
  // cell, which is why it cannot land anywhere wrong.
  assert.match(ratingCell.className, /is-estimated/);
});

test("marking a rating changes no text, so nothing can move", () => {
  // The whole reason the "~" was abandoned. A mark that occupies width competes
  // with the digits for space, and every arrangement of that competition broke
  // an alignment somewhere. Identical text is what makes that impossible.
  const cell = (ratingSource) =>
    compactChildren({ index: "A", name: "X", rating: 1800, ratingSource })[3];
  assert.equal(cell("official").textContent, cell("estimated").textContent);
  assert.equal(cell("estimated").textContent.trim(), "1800");
});

test("the queue rating is the hover target, not some child of it", () => {
  // On the old glyph the title made a ~6.7px target and hovering the number
  // did nothing at all.
  const problem = { index: "A", name: "X", rating: 1800, ratingSource: "estimated" };
  const doc = new DOMParser().parseFromString(
    `<body>${renderProblemRow(build("codeforces", problem), { position: 1 })}</body>`,
    "text/html",
  );
  const rating = doc.querySelector(".rating");
  assert.match(rating.getAttribute("title") ?? "", /Codeforces publishes no rating/);
  assert.equal(rating.children.length, 0, "the number is a bare text node");
});

test("both layouts mark the same element, so the views can't drift", () => {
  const problem = { index: "A", name: "X", rating: 1800, ratingSource: "estimated" };
  const full = renderProblemRow(build("codeforces", problem), { position: 1 });
  const doc = new DOMParser().parseFromString(`<body>${full}</body>`, "text/html");

  assert.match(doc.querySelector(".rating").className, /is-estimated/);
  assert.match(compactChildren(problem)[3].className, /is-estimated/);
});
