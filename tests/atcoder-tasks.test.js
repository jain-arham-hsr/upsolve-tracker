/**
 * The AtCoder tasks-page parser, against markup captured from the live site.
 *
 * `tests/fixtures/atcoder-tasks.html` is a real response for abc432, saved
 * verbatim — this page is public, so unlike the standings and submissions
 * fixtures it needed no session to capture and can be refreshed by anyone.
 *
 * The negative cases matter as much as the positive ones: this parser replaces
 * three kenkoooo resources, so a silent shape change would produce a contest
 * that merely looks short rather than one that fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

import {
  findContestName,
  findContestTimes,
  findTasks,
} from "../core/platforms/atcoder/dom-parsers/tasks.js";

const html = readFileSync(new URL("./fixtures/atcoder-tasks.html", import.meta.url), "utf8");
const doc = () => parseHTML(html).document;
const empty = (body) => parseHTML(`<html><body>${body}</body></html>`).document;

test("reads the contest name from the sidebar link, not the title suffix", () => {
  const name = findContestName(doc());
  assert.match(name, /AtCoder Beginner Contest 432/);
  assert.doesNotMatch(name, /- AtCoder$/);
});

test("reads start and end as epoch seconds, honouring the +0900 offset", () => {
  const { startTimeSeconds, endTimeSeconds } = findContestTimes(doc());
  // 2025-11-15 21:00:00+0900
  assert.equal(startTimeSeconds, 1763208000);
  assert.equal(endTimeSeconds, 1763214000);
  assert.ok(endTimeSeconds > startTimeSeconds);
});

test("finds every problem with its index, task id and name", () => {
  const tasks = findTasks(doc());
  assert.equal(tasks.length, 7);
  assert.deepEqual(
    tasks.map((t) => t.index),
    ["A", "B", "C", "D", "E", "F", "G"],
  );
  assert.deepEqual(
    tasks.map((t) => t.problemId),
    ["abc432_a", "abc432_b", "abc432_c", "abc432_d", "abc432_e", "abc432_f", "abc432_g"],
  );
  assert.equal(tasks[2].name, "Candy Tribulation");
});

test("identity is the task id, which is what makes a rerun clear", () => {
  // In a daily-training rerun the same problem is listed under a different
  // index, so keying on the displayed letter would treat them as different
  // problems and never clear one from the other.
  const tasks = findTasks(doc());
  assert.equal(tasks.find((t) => t.problemId === "abc432_c").index, "C");
  assert.equal(new Set(tasks.map((t) => t.problemId)).size, 7);
});

test("a missing task table returns null, not an empty contest", () => {
  // The whole point of the null discipline: `[]` would store a contest with no
  // problems, which reads as "this round had none" rather than "we could not
  // read the page".
  assert.equal(findTasks(empty("<p>no table here</p>")), null);
  assert.equal(findTasks(empty("<table><tbody></tbody></table>")), null);
});

test("a table whose rows no longer carry task links returns null", () => {
  const changed = empty(
    "<table><tbody><tr><td>A</td><td><a href='/elsewhere'>X</a></td></tr></tbody></table>",
  );
  assert.equal(findTasks(changed), null);
});

test("a missing name or missing times answer null rather than a default", () => {
  assert.equal(findContestName(empty("<p>nothing</p>")), null);
  const times = findContestTimes(empty("<p>nothing</p>"));
  assert.equal(times.startTimeSeconds, null);
  assert.equal(times.endTimeSeconds, null);
});
