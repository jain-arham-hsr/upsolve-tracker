/**
 * The standings page is not a contract, so these tests pin down what happens
 * when Codeforces changes it: every extractor must return null rather than a
 * plausible-looking default that would become a wrong rating.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import {
  extractHandles,
  extractProblems,
  extractSolveCounts,
  findContestName,
  findStandingsTable,
  hasPageLink,
  highestPageNumber,
} from "../core/services/standings-dom.js";

const parse = (body) =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html");

// Shaped after a real standings page, including the <br> inside totals cells.
const PAGE = `
<div class="contest-name"><a href="/contest/2193">Codeforces Round 1076 (Div. 3)</a></div>
<table class="standings">
  <tr>
    <th>#</th><th>Who</th>
    <th><a href="/contest/2193/problem/A" title="A - DBMB and the Array">A</a></th>
    <th><a href="/contest/2193/problem/B" title="B - Reverse a Permutation">B</a></th>
  </tr>
  <tr><td>1</td><td><a href="/profile/tourist">tourist</a></td><td>+</td><td>+1</td></tr>
  <tr><td>2</td><td><a href="/profile/Petr">Petr</a></td><td>+</td><td>+</td></tr>
  <tr><td colspan="2">Accepted</td><td>4821<br/>x</td><td>1290</td></tr>
</table>
<div class="pagination">
  <a href="/contest/2193/standings/page/2">2</a>
  <a href="/contest/2193/standings/page/47">47</a>
</div>`;

test("reads a well-formed page", () => {
  const doc = parse(PAGE);
  const table = findStandingsTable(doc);
  assert.ok(table);

  const problems = extractProblems(table);
  assert.deepEqual(
    problems.map((p) => p.index),
    ["A", "B"],
  );
  assert.equal(problems[0].name, "DBMB and the Array");
  assert.equal(problems[0].url, "https://codeforces.com/contest/2193/problem/A");

  assert.deepEqual(extractSolveCounts(table, 2), [4821, 1290]);
  assert.equal(findContestName(doc), "Codeforces Round 1076 (Div. 3)");
  assert.deepEqual(extractHandles(doc), ["tourist", "Petr"]);
});

test("a missing totals row yields null, not silent zeroes", () => {
  const doc = parse(PAGE.replace(/<tr><td colspan="2">Accepted[\s\S]*?<\/tr>/, ""));
  const table = findStandingsTable(doc);
  assert.equal(extractSolveCounts(table, 2), null);
});

test("one unparseable count invalidates the whole row", () => {
  const doc = parse(PAGE.replace(">1290<", ">—<"));
  const table = findStandingsTable(doc);
  assert.equal(extractSolveCounts(table, 2), null);
});

test("a mismatched cell count is refused rather than misaligned", () => {
  const table = findStandingsTable(parse(PAGE));
  // Claiming three problems when the row holds two would shift every count.
  assert.equal(extractSolveCounts(table, 3), null);
});

test("a renamed standings table is not found", () => {
  const doc = parse(PAGE.replace('class="standings"', 'class="standings-v2"'));
  assert.equal(findStandingsTable(doc), null);
});

test("renamed problem links yield null rather than an empty problem set", () => {
  const doc = parse(PAGE.replace(/\/problem\//g, "/task/"));
  assert.equal(extractProblems(findStandingsTable(doc)), null);
});

test("a problem with no index is refused, since lookups key on it", () => {
  const doc = parse(PAGE.replace('title="A - DBMB and the Array">A<', 'title="x">  <'));
  assert.equal(extractProblems(findStandingsTable(doc)), null);
});

test("contest name falls back through the chain, then to null", () => {
  assert.equal(
    findContestName(parse('<div class="caption">Backup Title</div>')),
    "Backup Title",
  );
  assert.equal(findContestName(parse("<div>nothing useful</div>")), null);
});

test("pagination is read from the highest link, not the first", () => {
  const doc = parse(PAGE);
  assert.equal(highestPageNumber(doc), 47);
  assert.equal(hasPageLink(doc, 47), true);
  assert.equal(hasPageLink(doc, 48), false);
});

test("an unpaginated page reports a single page", () => {
  assert.equal(highestPageNumber(parse("<table class='standings'></table>")), 1);
});
