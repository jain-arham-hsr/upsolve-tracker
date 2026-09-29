/**
 * The standings page, read for group contests — the one kind of contest the
 * API cannot see. The page is not a contract, so these pin what happens when
 * it changes: the parser returns null rather than a plausible default, since
 * a missing count read as zero is a confident, wrong rating.
 *
 * Markup shaped after Codeforces' standings: a `contestant-cell` naming the
 * party (a team's cell also links the team), and a totals row whose cells hold
 * "Accepted" above "Tried", split by a `<br>`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import { parseStandingsPage } from "../../../core/platforms/codeforces/scraper.js";

const parse = (html) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");

const header = `<tr>
  <th class="top left">#</th><th class="top">Who</th><th class="top">=</th><th class="top">Penalty</th>
  <th class="top"><a href="/group/g/contest/719724/problem/A" title="Matching Socks">A</a></th>
  <th class="top"><a href="/group/g/contest/719724/problem/B" title="The Bus Round">B</a></th>
</tr>`;

const solo = (rank, handle) => `<tr participantId="${rank}">
  <td class="left dark">${rank}</td>
  <td class="contestant-cell"><a href="/profile/${handle}" class="rated-user user-blue">${handle}</a></td>
  <td>1</td><td>12</td><td><span class="cell-accepted">+</span></td><td></td>
</tr>`;

const team = `<tr participantId="9">
  <td class="left dark">3</td>
  <td class="contestant-cell"><a href="/group/g/contest/719724/team/1">Team Rocket</a>:
    <a href="/profile/jessie">jessie</a>, <a href="/profile/james">james</a></td>
  <td>0</td><td>0</td><td></td><td></td>
</tr>`;

const totals = (a = "2", b = "0") => `<tr>
  <td class="smaller bottom dark" colspan="4"><span class="cell-passed-system-test">Accepted</span><br><span class="notice">Tried</span></td>
  <td class="smaller bottom dark">${a}<br>3</td>
  <td class="smaller bottom dark">${b}<br>1</td>
</tr>`;

const NAME = `<div class="contest-name"><a href="/group/g/contest/719724">ICPC 2027 Mock Prelims - 1</a></div>`;

const page = ({ rows = solo(1, "tourist") + solo(2, "Petr") + team, total = totals(), pages = "", extra = "" } = {}) =>
  parse(`${extra}${NAME}<table class="standings">${header}${rows}${total}</table>${pages}`);

test("reads one party per row, and the counts by problem index", () => {
  const read = parseStandingsPage(page());
  assert.deepEqual(read.parties, [["tourist"], ["Petr"], ["jessie", "james"]]);
  assert.deepEqual(read.solveCounts, { A: 2, B: 0 });
  assert.equal(read.pageCount, 1);
  assert.equal(read.contestName, "ICPC 2027 Mock Prelims - 1");
  assert.equal(read.ended, true, "no timer on the page means it has ended");
});

/**
 * The header as 719724's standings render it: the name, then a status line —
 * "Contest is running" above a timer, or "Finished" with none.
 */
const headed = (status) => parse(`<div>
    <div class="contest-name"><a href="/group/g/contest/719724">ICPC 2027 Mock Prelims - 1</a></div>
    ${status}
  </div><table class="standings">${header}${solo(1, "tourist")}${totals()}</table>`);

test("\"Contest is running\" with a timer means not ended", () => {
  const doc = headed(`<div>Contest is running</div><div><span class="countdown">00:41:02</span></div>`);
  assert.equal(parseStandingsPage(doc).ended, false);
});

test("\"Contest is running\" means not ended even if the timer is not recognised", () => {
  // The timer's class is Codeforces' usual one, not one seen on this page; the
  // label is what was seen, so it has to stand on its own.
  const doc = headed(`<div>Contest is running</div><div><span class="timer">00:41:02</span></div>`);
  assert.equal(parseStandingsPage(doc).ended, false);
});

test("\"Finished\" means ended", () => {
  assert.equal(parseStandingsPage(headed(`<div>Finished</div>`)).ended, true);
});

test("the label wins over a stray timer elsewhere on the page", () => {
  // A countdown to some other contest must not strand a finished one.
  const doc = headed(`<div>Finished</div><div id="sidebar"><span class="countdown">2 days</span></div>`);
  assert.equal(parseStandingsPage(doc).ended, true);
});

test("with no label to read, a timer still means not ended", () => {
  const extra = `<div class="roundbox"><span class="countdown">00:41:03</span></div>`;
  assert.equal(parseStandingsPage(page({ extra })).ended, false);
});

test("a page without the contest's name says so, rather than borrowing the group's", () => {
  const doc = parse(`<div id="sidebar"><table class="rtable"><tr><th><a href="/group/g">Some Group</a></th></tr></table></div>
    <table class="standings">${header}${solo(1, "tourist")}${totals()}</table>`);
  assert.equal(parseStandingsPage(doc).contestName, null);
});

test("a team is one party, not one per member — the team link is not a member", () => {
  // Flattening would count Team Rocket as two competitors, and its own link as a third.
  const read = parseStandingsPage(page({ rows: team }));
  assert.deepEqual(read.parties, [["jessie", "james"]]);
});

test("a row with no profile link is not a party", () => {
  // A ghost party names no Codeforces account, so there is no rating to read.
  const ghost = `<tr><td>4</td><td class="contestant-cell">Some Ghost Team</td><td>0</td><td>0</td><td></td><td></td></tr>`;
  assert.deepEqual(parseStandingsPage(page({ rows: solo(1, "tourist") + ghost })).parties, [["tourist"]]);
});

test("counts are read from the Accepted half of a cell, not the Tried half", () => {
  assert.deepEqual(parseStandingsPage(page({ total: totals("17", "4") })).solveCounts, { A: 17, B: 4 });
});

test("a missing totals row is a null count, never zeroes — the page itself still reads", () => {
  // A later page may not carry one; whether that matters is the reader's call.
  const read = parseStandingsPage(page({ total: "" }));
  assert.equal(read.solveCounts, null);
  assert.equal(read.parties.length, 3);
});

test("a team named \"Accepted\" is a party, not the totals row", () => {
  const rows = solo(1, "tourist").replace(">tourist</a>", ">tourist</a> Accepted Anyway");
  const real = totals().replace("<tr>", '<tr class="standingsStatisticsRow">');
  const read = parseStandingsPage(page({ rows, total: real }));
  assert.deepEqual(read.parties, [["tourist"]]);
  assert.deepEqual(read.solveCounts, { A: 2, B: 0 });
});

test("one unparseable count refuses the whole page", () => {
  assert.equal(parseStandingsPage(page({ total: totals("2", "—") })), null);
});

test("a renamed table, or no problem columns, is null", () => {
  assert.equal(parseStandingsPage(parse(`<table class="standings-v2">${header}</table>`)), null);
  assert.equal(parseStandingsPage(parse(`<table class="standings"><tr><th>Who</th></tr>${totals()}</table>`)), null);
});

test("the page count is the highest page link, not the first, and its link is kept", () => {
  const pages = `<div class="pagination">
    <a href="/group/g/contest/719724/standings/page/2">2</a>
    <a href="/group/g/contest/719724/standings/page/7">7</a></div>`;
  const read = parseStandingsPage(page({ pages }));
  assert.equal(read.pageCount, 7);
  assert.equal(read.pagePath, "/group/g/contest/719724/standings/page/7");
});

// ── against the real page ─────────────────────────────────────────────────

/**
 * 719724's own standings, trimmed and anonymised (see the fixture's header),
 * saved while a virtual participation was running. Everything above is shaped
 * after Codeforces' markup; this is Codeforces' markup.
 */
const REAL = readFileSync(new URL("../../fixtures/cf-group-standings.html", import.meta.url), "utf8");
const real = (html = REAL) => new DOMParser().parseFromString(html, "text/html");

test("the real page: name, state, counts, and teams as one party each", () => {
  const read = parseStandingsPage(real());
  assert.equal(read.contestName, "ICPC 2027 Mock Prelims - 1");
  assert.equal(read.ended, false, "it carries \"Contest is running\" and a countdown");
  assert.deepEqual(read.solveCounts, { A: 545, B: 481, C: 323, D: 81, E: 47, F: 10, G: 10 });
  assert.deepEqual(read.parties, [
    ["member1"],
    ["member2"],
    ["member3", "member4", "member5"],
    ["member6", "member7", "member8"],
  ]);
});

test("the real page, finished: \"Finished\" and no timer", () => {
  // What the page shows once the contest is over, per the user's report.
  const finished = REAL
    .replace('<span class="contest-status">Contest is running</span>', '<span class="contest-status">Finished</span>')
    .replace(/<br><span[^>]*class="countdown"[^>]*>[^<]*<\/span>/, "");
  assert.notEqual(finished, REAL);
  assert.equal(parseStandingsPage(real(finished)).ended, true);
});

test("the real page's later pages are its own groupmates links, not a /gym/ path", () => {
  // 594 rows at 200 a page. Missing these links read a third of the field
  // and fitted every problem against it.
  const read = parseStandingsPage(real());
  assert.equal(read.pageCount, 3);
  assert.match(read.pagePath, /\/group\/\w+\/contest\/719724\/standings\/groupmates\/true\/page\/3$/);
});
