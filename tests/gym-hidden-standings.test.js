/**
 * The gate in front of the hidden-standings fallback.
 *
 * The fallback exists for one situation: a Codeforces gym set to "Standings
 * will not be visible as original contest", where the add fails outright
 * today. These tests are mostly about the situations it must NOT touch —
 * every path that works now has to keep working, and a fallback that opens
 * too eagerly would quietly reroute a healthy contest onto a narrower field.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { CodeforcesHttp } = await import("../core/platforms/codeforces/http.js");
const { readSolveStats } = await import("../core/platforms/codeforces/solve-stats.js");

const PROBLEMS = [
  ["A", "Everything Everywhere All But One"],
  ["B", "JOE is on TV!"],
  ["C", "Not Assigning"],
];

function problemsPage(id) {
  const rows = PROBLEMS.map(
    ([index, name]) => `
      <tr>
        <td class="id"><a href="/gym/${id}/problem/${index}">${index}</a></td>
        <td><div><a href="/gym/${id}/problem/${index}">${name}</a></div></td>
        <td class="right"><a href="/gym/${id}/status?f=${index}">x12</a></td>
      </tr>`,
  ).join("");
  return `<html><body>${sidebar(id)}
    <table class="problems"><tr><th>#</th><th>Name</th><th></th></tr>${rows}</table>
  </body></html>`;
}

/**
 * The real shape of a contest page's sidebar: the name is a link inside an
 * .rtable header, and the first .caption is the About sidebox. Reading the
 * name off .caption is what once put "→ About Contest" in the queue.
 */
function sidebar(id) {
  return `<div id="sidebar">
    <div class="roundbox"><table class="rtable">
      <tr><th class="left"><a href="/gym/${id}">ICPC PRELIMS PC : 1</a></th></tr>
    </table></div>
    <div class="roundbox"><div class="caption titled">→ About Contest</div>
      <div class="smaller">Standings will not be visible as original contest.</div></div>
  </div>`;
}

function standingsPage(id) {
  const headers = PROBLEMS.map(
    ([index, name]) =>
      `<th><a href="/gym/${id}/problem/${index}" title="${index} - ${name}">${index}</a></th>`,
  ).join("");
  return `<html><body><div class="caption">A Visible Gym</div>
    <table class="standings">
      <tr><th>#</th><th>Who</th>${headers}</tr>
      <tr><td>1</td><td><a href="/profile/tourist">tourist</a></td><td>1</td><td>1</td><td>1</td></tr>
    </table></body></html>`;
}

/** A page with neither table — what Codeforces serves when standings are hidden. */
const NO_TABLE = `<html><body><div class="caption">Hidden</div>
  <div>Standings will not be visible as original contest.</div></body></html>`;

/**
 * @param {object} pages - what each URL shape returns; a string is served,
 *   an Error is thrown.
 */
function serve({ standings, problems }) {
  const seen = [];
  CodeforcesHttp.get = async (url) => {
    seen.push(url);
    const body = url.includes("/standings") ? standings : problems;
    if (body instanceof Error) throw body;
    return body;
  };
  return seen;
}

/** A service that fails loudly if the fallback touches it. */
function forbiddenService(allow = {}) {
  return {
    getContestStandings: async () => {
      throw new Error("getContestStandings should not have been called");
    },
    getContestStatus: async () => {
      throw new Error("getContestStatus should not have been called");
    },
    ...allow,
  };
}

const submission = (index, party, verdict = "OK") => ({
  problem: { contestId: 712373, index, name: `P${index}`, rating: 1500, tags: ["math"] },
  author: {
    participantId: party,
    participantType: "CONTESTANT",
    ghost: false,
    startTimeSeconds: 1787573100,
    members: [{ handle: `user${party}` }],
  },
  verdict,
});

test("an official contest with no standings table still fails, and never reaches the fallback", async () => {
  serve({ standings: NO_TABLE, problems: problemsPage(1) });

  // Far more likely a Codeforces layout change than a deliberate setting, and
  // CLAUDE.md's rule is that those fail loudly rather than being routed around.
  await assert.rejects(
    () => readSolveStats("contest", "2193", forbiddenService()),
    /didn't contain a standings table/,
  );
});

test("a gym whose standings are readable never calls contest.status", async () => {
  serve({ standings: standingsPage(702859), problems: problemsPage(702859) });

  const stats = await readSolveStats(
    "gym",
    "702859",
    forbiddenService({
      getContestStandings: async () => ({
        contest: { startTimeSeconds: 1234 },
        // A and C carry Codeforces' own rating, B does not — the usual shape,
        // since a gym mixes archive picks with the setter's own problems.
        problems: [
          { index: "A", tags: ["dp"], rating: 1300 },
          { index: "B", tags: ["dp"] },
          { index: "C", tags: ["dp"], rating: 900 },
        ],
        rows: [
          {
            party: { ghost: false, members: [{ handle: "tourist" }] },
            problemResults: [
              { bestSubmissionTimeSeconds: 10 },
              { bestSubmissionTimeSeconds: null },
              { bestSubmissionTimeSeconds: 30 },
            ],
          },
        ],
      }),
    }),
  );

  assert.equal(stats.partyHandles, null);
  assert.equal(stats.startTimeSeconds, 1234);
  assert.equal(stats.solveCountsRead, true);
  assert.deepEqual(
    stats.problems.map((p) => p.officialSolves),
    [1, 0, 1],
  );
  // The published rating is taken where Codeforces has one; the rest is left
  // at null for the estimator. Reading it off the same objects the tags come
  // from costs nothing, and beats a mean 211-point estimate error.
  assert.deepEqual(
    stats.problems.map((p) => p.rating),
    [1300, null, 900],
  );
  assert.deepEqual(
    stats.problems.map((p) => p.ratingSource),
    ["official", null, "official"],
  );
});

test("a gym failing for any other reason rethrows rather than falling back", async () => {
  const blocked = new Error(
    "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.",
  );
  serve({ standings: blocked, problems: problemsPage(712373) });

  await assert.rejects(
    () => readSolveStats("gym", "712373", forbiddenService()),
    /blocking requests/,
  );
});

test("a gym with hidden standings is rebuilt from contest.status", async () => {
  const seen = serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  const stats = await readSolveStats("gym", "712373", {
    getContestStandings: async () => {
      throw new Error("contestId: Standings are not available");
    },
    getContestStatus: async () => [
      submission("A", 1),
      submission("A", 2),
      submission("B", 1, "WRONG_ANSWER"),
    ],
  });

  assert.equal(stats.contestName, "ICPC PRELIMS PC : 1");
  assert.deepEqual(
    stats.problems.map((p) => p.index),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    stats.problems.map((p) => p.officialSolves),
    [2, 0, 0],
  );
  assert.equal(stats.startTimeSeconds, 1787573100);
  assert.equal(stats.solveCountsRead, true);
  assert.deepEqual(stats.partyHandles, [["user1"], ["user2"]]);
  assert.ok(seen.some((url) => url.endsWith("/gym/712373")));
});

test("a problem nobody submitted to still reaches the queue", async () => {
  // The reason the list comes from the problems page rather than from the
  // submissions: C had no attempts, and would otherwise silently vanish.
  serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  const stats = await readSolveStats("gym", "712373", {
    getContestStatus: async () => [submission("A", 1)],
  });

  assert.equal(stats.problems.length, 3);
  const c = stats.problems.find((p) => p.index === "C");
  assert.equal(c.name, "Not Assigning");
  assert.equal(c.officialSolves, 0);
  assert.equal(c.rating, null, "left for the estimator");
});

test("refuses loudly when the problems page can't be read either", async () => {
  serve({ standings: NO_TABLE, problems: "<html><body>nothing here</body></html>" });

  await assert.rejects(
    () => readSolveStats("gym", "712373", forbiddenService()),
    /standings hidden.*problems page couldn't be read/s,
  );
});

test("no official submissions means the solve counts are unusable, not zero", async () => {
  serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  const stats = await readSolveStats("gym", "712373", {
    getContestStatus: async () => [
      { ...submission("A", 1), author: { ...submission("A", 1).author, participantType: "PRACTICE" } },
    ],
  });

  // solveCountsRead false is what makes the adapter refuse instead of handing
  // the estimator all-zero counts, which floor every problem at 800.
  assert.equal(stats.solveCountsRead, false);
});

test("gym 712373 end to end, against its real submissions", () => {
  // The closest this can get to the live add. Everything below the problems
  // page is the contest's actual contest.status response, and the numbers are
  // what the contest page shows.
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/gym-standings-hidden.json", import.meta.url)),
  );
  const REAL = [
    ["A", "Everything Everywhere All But One", 800, 12],
    ["B", "JOE is on TV!", 1000, 12],
    ["C", "Not Assigning", 1400, 12],
    ["D", "Bakry and Partitioning", 1700, 4],
    ["E", "Array Restoration", 1700, 6],
    ["F", "Multiple Lamps", 2400, 1],
  ];

  const rows = REAL.map(
    ([index, name]) => `
      <tr>
        <td class="id"><a href="/gym/712373/problem/${index}">${index}</a></td>
        <td><div><a href="/gym/712373/problem/${index}">${name}</a></div></td>
      </tr>`,
  ).join("");
  CodeforcesHttp.get = async (url) =>
    url.includes("/standings")
      ? NO_TABLE
      : `<html><body>${sidebar(712373)}
         <table class="problems"><tr><th>#</th></tr>${rows}</table></body></html>`;

  return readSolveStats("gym", "712373", {
    getContestStatus: async () => structuredClone(fixture.submissions),
  }).then((stats) => {
    assert.deepEqual(
      stats.problems.map((p) => [p.index, p.name, p.rating, p.officialSolves]),
      REAL,
    );
    // Every problem rated by Codeforces, so nothing is left to estimate from
    // a 12-team field.
    assert.ok(stats.problems.every((p) => p.ratingSource === "official"));
    assert.equal(stats.contestName, "ICPC PRELIMS PC : 1");
    assert.equal(stats.startTimeSeconds, 1787573100);
    assert.equal(stats.solveCountsRead, true);
    assert.equal(stats.partyHandles.length, 12);
  });
});
