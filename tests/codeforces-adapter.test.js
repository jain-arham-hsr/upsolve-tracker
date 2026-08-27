/**
 * The Codeforces adapter end to end, which nothing else drives.
 *
 * There were `codechef-adapter.test.js` and `atcoder-adapter.test.js` but no
 * Codeforces equivalent, and the gap had already swallowed something real:
 * `getGymRatingDistFromParties` — the field recovered from submissions when a
 * gym's standings are hidden — had never executed at all. No test reached it,
 * and the one live add that used that path skipped it, because Codeforces
 * published a rating for all six problems. It shipped green and unrun.
 *
 * These tests cover the branch points of `estimateMissingRatings`: which
 * problems need estimating at all, and where the field comes from when they do.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { HttpClient } = await import("../core/services/http-client.js");
const { fetchContestRecord } = await import(
  "../core/platforms/codeforces/adapter.js"
);

const INDEXES = ["A", "B", "C"];

const sidebar = (id) => `<div id="sidebar"><div class="roundbox">
  <table class="rtable"><tr><th class="left"><a href="/gym/${id}">A Gym</a></th></tr></table>
</div><div class="caption titled">→ About Contest</div></div>`;

function standingsPage(id) {
  const th = INDEXES.map(
    (i) => `<th><a href="/gym/${id}/problem/${i}" title="${i} - Problem ${i}">${i}</a></th>`,
  ).join("");
  return `<html><body><div class="contest-name">A Gym</div>
    <table class="standings">
      <tr><th>#</th><th>Who</th>${th}</tr>
      <tr><td>1</td><td><a href="/profile/alice">alice</a></td><td>1</td><td>1</td><td>1</td></tr>
      <tr class="totals"><td>Accepted</td><td></td><td>2</td><td>1</td><td>0</td></tr>
    </table></body></html>`;
}

function problemsPage(id) {
  const rows = INDEXES.map(
    (i) => `<tr><td class="id"><a href="/gym/${id}/problem/${i}">${i}</a></td>
      <td><div><a href="/gym/${id}/problem/${i}">Problem ${i}</a></div></td></tr>`,
  ).join("");
  return `<html><body>${sidebar(id)}
    <table class="problems"><tr><th>#</th></tr>${rows}</table></body></html>`;
}

const NO_TABLE = `<html><body>${sidebar(1)}
  <div>Standings will not be visible as original contest.</div></body></html>`;

/** Two parties, so a solve count of 1 has something to discriminate against. */
function standingsApi(ratings) {
  return {
    contest: { startTimeSeconds: 1000 },
    problems: INDEXES.map((index, i) => ({
      index,
      tags: [],
      ...(ratings[i] == null ? {} : { rating: ratings[i] }),
    })),
    rows: [
      {
        party: { ghost: false, members: [{ handle: "alice" }] },
        problemResults: [
          { bestSubmissionTimeSeconds: 5 },
          { bestSubmissionTimeSeconds: 7 },
          { bestSubmissionTimeSeconds: null },
        ],
      },
      {
        party: { ghost: false, members: [{ handle: "bob" }] },
        problemResults: [
          { bestSubmissionTimeSeconds: 9 },
          { bestSubmissionTimeSeconds: null },
          { bestSubmissionTimeSeconds: null },
        ],
      },
    ],
  };
}

const record = (service) =>
  fetchContestRecord({ contestId: "702859", subtype: "GYM", session: { service } });

test("a fully rated gym takes Codeforces' numbers and never measures the field", async () => {
  HttpClient.get = async () => standingsPage("702859");

  const contest = await record({
    getContestStandings: async () => standingsApi([1300, 900, 2100]),
    getUsersInfo: async () => {
      throw new Error("the field must not be measured when nothing needs estimating");
    },
    getContestList: async () => [],
  });

  assert.deepEqual(contest.problems.map((p) => p.rating), [1300, 900, 2100]);
  assert.deepEqual(
    contest.problems.map((p) => p.ratingSource),
    ["official", "official", "official"],
  );
  // Skipping the estimate also skips a second contest.standings fetch for a
  // response get-prob-stats already paid for.
  assert.equal(contest.startTimeSeconds, 1000);
});

test("a mixed gym estimates only what Codeforces leaves unrated", async () => {
  HttpClient.get = async () => standingsPage("702859");
  let fieldMeasured = 0;

  const contest = await record({
    getContestStandings: async () => standingsApi([1300, null, 2100]),
    getUsersInfo: async (handles) => {
      fieldMeasured++;
      return handles.map((h) => ({ handle: h, rating: 1500 }));
    },
    getContestList: async () => [],
  });

  assert.equal(fieldMeasured, 1, "the field is measured once, for the one gap");
  assert.deepEqual(
    contest.problems.map((p) => p.ratingSource),
    ["official", "estimated", "official"],
  );
  assert.equal(contest.problems[0].rating, 1300);
  assert.equal(contest.problems[2].rating, 2100);
  assert.equal(typeof contest.problems[1].rating, "number");
});

test("a hidden-standings gym recovers its field from who submitted", async () => {
  // The path that had never executed. Codeforces rates A and C but not B, so
  // B has to be estimated — and contest.standings answers FAILED here, so the
  // field can only come from the submissions.
  HttpClient.get = async (url) =>
    url.includes("/standings") ? NO_TABLE : problemsPage("712373");

  const submission = (index, party, rating, verdict = "OK") => ({
    problem: { index, name: `Problem ${index}`, ...(rating == null ? {} : { rating }), tags: [] },
    author: {
      participantId: party,
      participantType: "CONTESTANT",
      ghost: false,
      startTimeSeconds: 1000,
      members: [{ handle: `p${party}` }],
    },
    verdict,
  });

  const asked = [];
  const contest = await record({
    getContestStandings: async () => {
      throw new Error("contestId: Standings are not available");
    },
    getContestStatus: async () => [
      submission("A", 1, 1300), submission("A", 2, 1300),
      submission("B", 1, null), submission("B", 2, null, "WRONG_ANSWER"),
      submission("C", 1, 2100, "WRONG_ANSWER"),
    ],
    getUsersInfo: async (handles) => {
      asked.push(...handles);
      return handles.map((h) => ({ handle: h, rating: 1600 }));
    },
    getContestList: async () => [],
  });

  // The handles came from the submissions, not from standings.
  assert.deepEqual(asked.sort(), ["p1", "p2"]);
  assert.deepEqual(
    contest.problems.map((p) => p.ratingSource),
    ["official", "estimated", "official"],
  );
  assert.equal(typeof contest.problems[1].rating, "number");
  assert.ok(contest.problems[1].rating >= 800);
});

test("a hidden-standings gym with nothing to estimate never asks for the field", async () => {
  HttpClient.get = async (url) =>
    url.includes("/standings") ? NO_TABLE : problemsPage("712373");

  const contest = await record({
    getContestStandings: async () => {
      throw new Error("contestId: Standings are not available");
    },
    getContestStatus: async () =>
      INDEXES.map((index, i) => ({
        problem: { index, name: `Problem ${index}`, rating: 1000 + i * 100, tags: [] },
        author: {
          participantId: 1, participantType: "CONTESTANT", ghost: false,
          startTimeSeconds: 1000, members: [{ handle: "p1" }],
        },
        verdict: "OK",
      })),
    getUsersInfo: async () => {
      throw new Error("nothing needs estimating, so the field must not be read");
    },
    getContestList: async () => [],
  });

  assert.deepEqual(contest.problems.map((p) => p.rating), [1000, 1100, 1200]);
});
