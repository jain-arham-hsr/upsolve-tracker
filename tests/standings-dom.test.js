/**
 * The standings page is not a contract, so these tests pin down what happens
 * when Codeforces changes it: every extractor must return null rather than a
 * plausible-looking default that would become a wrong rating.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import {
  extractProblemsFromList,
  findContestNameOnProblemsPage,
  hasFinished,
} from "../core/platforms/codeforces-gyms/standings-dom.js";

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

/**
 * The problems page, read only when a gym's standings are hidden. It is the
 * one place the full problem list appears for those contests, including
 * problems nobody submitted to — and, since a visible gym is now read entirely
 * from `contest.standings`, the only Codeforces page still parsed at all.
 */
const problemsTable = (rows) => parse(`<table class="problems">
  <tr><th>#</th><th>Name</th><th></th></tr>${rows}</table>`);

const problemRow = (index, name) => `<tr>
  <td class="id"><a href="/gym/712373/problem/${index}">${index}</a></td>
  <td><div><a href="/gym/712373/problem/${index}">${name}</a></div></td>
  <td class="right"><a href="/gym/712373/status?f=${index}">x12</a></td>
</tr>`;

test("reads the problems page, skipping its header row", () => {
  const doc = problemsTable(problemRow("A", "Theatre Square") + problemRow("B", "Spreadsheets"));

  assert.deepEqual(extractProblemsFromList(doc), [
    { index: "A", name: "Theatre Square", url: "https://codeforces.com/gym/712373/problem/A" },
    { index: "B", name: "Spreadsheets", url: "https://codeforces.com/gym/712373/problem/B" },
  ]);
});

test("a renamed problems table is not found", () => {
  const doc = parse(`<table class="problemset">${problemRow("A", "Theatre Square")}</table>`);
  assert.equal(extractProblemsFromList(doc), null);
});

test("a page with no problems table at all yields null", () => {
  // What Codeforces serves when it decides the viewer may not see the contest.
  assert.equal(extractProblemsFromList(parse("<div>Nothing here</div>")), null);
});

test("a problem with no index is refused, since lookups key on it", () => {
  // A readable sibling row alongside it: skipping the bad row rather than
  // refusing would yield a contest one problem short, which reads as a
  // shorter contest rather than as a failure.
  const doc = problemsTable(
    problemRow("A", "Theatre Square") +
      `<tr>
        <td class="id"><a href="/gym/712373/problem/B"></a></td>
        <td><div><a href="/gym/712373/problem/B">Spreadsheets</a></div></td>
      </tr>`,
  );
  assert.equal(extractProblemsFromList(doc), null);
});

test("a nameless problem keeps its index rather than dropping the row", () => {
  // The index is what everything downstream joins on; the name is a label.
  const doc = problemsTable(`<tr>
    <td class="id"><a href="/gym/712373/problem/A">A</a></td>
    <td><div></div></td>
  </tr>`);
  assert.deepEqual(extractProblemsFromList(doc), [
    { index: "A", name: "Unknown Problem", url: "https://codeforces.com/gym/712373/problem/A" },
  ]);
});

test("the name is taken from the problem link, not from column position", () => {
  // Codeforces has added columns to this table before; matching on position
  // would make that a silent renaming of every problem.
  const doc = problemsTable(`<tr>
    <td class="id"><a href="/gym/712373/problem/A">A</a></td>
    <td class="new-column">\u2605</td>
    <td><div><a href="/gym/712373/problem/A">Theatre Square</a></div></td>
  </tr>`);
  assert.equal(extractProblemsFromList(doc)[0].name, "Theatre Square");
});

/**
 * Real sidebar markup from gym 712373's problems page, trimmed.
 *
 * Kept verbatim because of a specific escape: the problems page was first read
 * with findContestName, whose second choice is `.caption` — and the first
 * `.caption` here is "→ About Contest". The contest was added to the queue
 * under that name. Note the name is NOT a `.caption` and there is no
 * `.contest-name` anywhere on this page.
 */
const REAL_SIDEBAR = `<div id="sidebar">
  <div class="roundbox sidebox borderTopRound">
    <table class="rtable"><tbody>
      <tr><th class="left" style="width:100%;"><a style="color: black;" href="/gym/712373">ICPC PRELIMS PC : 1</a></th></tr>
      <tr><td class="left"><span class="contest-state-phase">Finished</span></td></tr>
    </tbody></table>
  </div>
  <div class="roundbox sidebox borderTopRound">
    <div class="caption titled">→ About Contest<div class="top-links"></div></div>
    <div class="smaller">Standings will not be visible as original contest.</div>
  </div>
  <div class="roundbox sidebox ContestVirtualFrame borderTopRound">
    <div class="caption titled">→ Virtual participation</div>
  </div>
</div>`;

test("the problems page names the contest, not its About sidebox", () => {
  const doc = parse(REAL_SIDEBAR);
  assert.equal(
    findContestNameOnProblemsPage(doc, "/gym/712373"),
    "ICPC PRELIMS PC : 1",
  );
});



test("the contest name is found even if the sidebar box stops being a link", () => {
  const doc = parse(`<div id="sidebar"><div class="roundbox">
    <table class="rtable"><tr><th class="left">ICPC PRELIMS PC : 1</th></tr></table>
  </div><div class="caption titled">→ About Contest</div></div>`);
  assert.equal(
    findContestNameOnProblemsPage(doc, "/gym/712373"),
    "ICPC PRELIMS PC : 1",
  );
});

test("falls back to the page title, minus Codeforces' own suffix", () => {
  const doc = parse("<div>no sidebar</div>");
  // linkedom keeps <title> out of body, so set it directly.
  doc.title = "Problems - ICPC PRELIMS PC : 1 - Codeforces";
  assert.equal(
    findContestNameOnProblemsPage(doc, "/gym/712373"),
    "Problems - ICPC PRELIMS PC : 1",
  );
});

test("an unnameable page yields null so the caller can say Contest <id>", () => {
  assert.equal(findContestNameOnProblemsPage(parse("<div></div>"), "/gym/1"), null);
});
