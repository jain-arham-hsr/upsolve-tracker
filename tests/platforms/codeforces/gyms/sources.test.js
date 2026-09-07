/**
 * The hidden-standings gym path, pinned to a real contest.
 *
 * Gym 712373 has "Standings will not be visible as original contest" set, so
 * contest.standings answers FAILED and the usual acquisition path has nothing
 * to work with. The fixture is that contest's real contest.status response,
 * and the contest page it was captured against reads:
 *
 *   A x12   B x12   C x12   D x4   E x6   F x1
 *
 * Those six numbers are the whole point of this file. They are what the
 * estimator is fitted to, and getting them wrong doesn't fail loudly — it
 * produces confident, wrong ratings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { GymSources } = await import("../../../../core/platforms/codeforces/gyms/sources.js");

const summariseSubmissions = (rows) => GymSources.summariseSubmissions(rows);
/** A real source with the one API method stubbed, the way every Codeforces test injects. */
const fetchContestSubmissions = (service, contestId) =>
  Object.assign(new GymSources("k", "s"), service).contestSubmissions(contestId);

const FIXTURE = JSON.parse(
  readFileSync(new URL("../../../fixtures/gym-standings-hidden.json", import.meta.url)),
);

/** Fixtures must be cloned per test — see CLAUDE.md. */
function submissions() {
  return structuredClone(FIXTURE.submissions);
}

const PAGE_SOLVE_COUNTS = { A: 12, B: 12, C: 12, D: 4, E: 6, F: 1 };

test("reproduces the contest page's solve counts exactly", () => {
  const { solveCounts } = summariseSubmissions(submissions());
  assert.deepEqual(solveCounts, PAGE_SOLVE_COUNTS);
});

test("finds every problem, with the difficulty Codeforces publishes", () => {
  const { problemMeta } = summariseSubmissions(submissions());

  assert.deepEqual([...problemMeta.keys()].sort(), ["A", "B", "C", "D", "E", "F"]);
  assert.equal(problemMeta.get("A").name, "Everything Everywhere All But One");
  assert.deepEqual(
    ["A", "B", "C", "D", "E", "F"].map((i) => problemMeta.get(i).rating),
    [800, 1000, 1400, 1700, 1700, 2400],
  );
});

test("recovers the field, one entry per party rather than per handle", () => {
  const { partyHandles } = summariseSubmissions(submissions());

  // 12 teams, 34 distinct people across them.
  assert.equal(partyHandles.length, 12);
  assert.equal(new Set(partyHandles.flat()).size, 34);
});

test("takes the contest start time", () => {
  const { startTimeSeconds } = summariseSubmissions(submissions());
  assert.equal(startTimeSeconds, 1787573100);
});

test("excludes practice submissions", () => {
  // A contest closes when it ends, so practice solves say nothing about how
  // hard the problem was during it. The fixture has 14 practice rows.
  const rows = submissions();
  assert.ok(rows.some((s) => s.author.participantType === "PRACTICE"));

  const solvedInPractice = rows.filter(
    (s) => s.author.participantType === "PRACTICE" && s.verdict === "OK",
  );
  assert.ok(solvedInPractice.length > 0, "fixture should contain practice solves");

  const { solveCounts } = summariseSubmissions(rows);
  assert.deepEqual(solveCounts, PAGE_SOLVE_COUNTS);
});

test("excludes ghost parties, as the standings path does", () => {
  const rows = submissions();
  const target = rows.find(
    (s) => s.author.participantType === "CONTESTANT" && s.verdict === "OK",
  );
  const ghostedParty = target.author.participantId;
  rows.forEach((s) => {
    if (s.author.participantId === ghostedParty) s.author.ghost = true;
  });

  const { solveCounts, partyHandles } = summariseSubmissions(rows);
  assert.equal(partyHandles.length, 11);
  assert.ok(
    solveCounts[target.problem.index] <
      PAGE_SOLVE_COUNTS[target.problem.index],
  );
});

test("counts a party once however many times it solves the same problem", () => {
  const rows = submissions();
  const accepted = rows.find(
    (s) => s.author.participantType === "CONTESTANT" && s.verdict === "OK",
  );

  // Distinct ids, as a real resubmission has. Cloning the row wholesale would
  // dedupe on the id alone and prove nothing about the party.
  rows.push(
    { ...structuredClone(accepted), id: accepted.id + 1 },
    { ...structuredClone(accepted), id: accepted.id + 2 },
  );

  const { solveCounts } = summariseSubmissions(rows);
  assert.deepEqual(solveCounts, PAGE_SOLVE_COUNTS);
});

test("a rejected attempt is not a solve", () => {
  const rows = submissions().map((s) =>
    s.verdict === "OK" ? { ...s, verdict: "WRONG_ANSWER" } : s,
  );
  const { solveCounts, partyHandles } = summariseSubmissions(rows);

  assert.deepEqual(solveCounts, {});
  // The parties still competed, so this is "nobody solved it", not "no data" —
  // which is the distinction the caller draws from partyHandles being non-empty.
  assert.equal(partyHandles.length, 12);
});

test("reports no field rather than an empty one when nothing official ran", () => {
  const rows = submissions().map((s) => ({
    ...s,
    author: { ...s.author, participantType: "PRACTICE" },
  }));
  const { partyHandles, solveCounts } = summariseSubmissions(rows);

  // All-zero counts are indistinguishable from "nobody solved anything", and
  // feeding those to the estimator drives every problem to the *ceiling*, not
  // the 800 floor: zero solves makes it aim for 0.5 expected solves, which
  // lands near the top of its search range. The queue would then lead with a
  // wall of maximally hard problems, which is why the caller reports no field
  // at all rather than a field with nothing solved in it.
  // No parties means no field, which is what the caller checks — there is
  // deliberately no second flag saying the same thing.
  assert.deepEqual(partyHandles, []);
  assert.deepEqual(solveCounts, {});
});

test("survives malformed rows without inventing a party", () => {
  const rows = [
    ...submissions(),
    { problem: null, author: null },
    { problem: { index: "A" }, author: { participantType: "CONTESTANT" } },
  ];
  const { solveCounts, partyHandles } = summariseSubmissions(rows);
  assert.deepEqual(solveCounts, PAGE_SOLVE_COUNTS);
  assert.equal(partyHandles.length, 12);
});

test("pages until a short page, then stops", async () => {
  const asked = [];
  const service = {
    contestStatus: async (contestId, { from, count }) => {
      asked.push({ from, count });
      return asked.length === 1
        ? Array.from({ length: count }, (_, i) => ({ id: i }))
        : [{ id: 999 }];
    },
  };

  const all = await fetchContestSubmissions(service, 1);
  assert.equal(asked.length, 2);
  assert.equal(asked[1].from, asked[0].from + asked[0].count);
  assert.equal(all.length, asked[0].count + 1);
});

test("refuses a contest too large to rebuild rather than truncating", async () => {
  // An understated solve count reads as a harder problem, not as a failure.
  const service = {
    contestStatus: async (contestId, { count }) =>
      Array.from({ length: count }, (_, i) => ({ id: i })),
  };
  await assert.rejects(
    () => fetchContestSubmissions(service, 1),
    /too many to rebuild/,
  );
});

// ---------------------------------------------------------------------------
// The HTML client: recognising when Codeforces refuses, and being paced while
// asking. Neither half was executed by any adapter test, which all stub the
// page read wholesale — so a blocked scrape would otherwise hand Cloudflare's
// interstitial to the problems-page scraper, which would find no table and
// report something unrelated.
// ---------------------------------------------------------------------------

import { DOMParser } from "linkedom";

// The client parses before it answers, so these need a DOM the way the browser
// gives production one.
globalThis.DOMParser = DOMParser;


const CodeforcesHttp = new GymSources("k", "s");
const resetHttpState = (ms) => GymSources.reset(ms);

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, at: Date.now() });
    return handler(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const ok = (body) => ({ status: 200, async text() { return body; } });

test("a 403 becomes a sentence about visiting codeforces.com", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ({ status: 403, async text() { return ""; } }));
  try {
    await assert.rejects(
      () => CodeforcesHttp.page("https://codeforces.com/contest/1/standings"),
      /blocking requests.*visit codeforces\.com/s,
    );
  } finally {
    stub.restore();
  }
});

test("a 200 carrying Cloudflare's interstitial is caught too", async () => {
  // The nastier of the two: the status says success, so nothing downstream
  // would notice — the standings parser would just find no table and blame the
  // markup.
  resetHttpState();
  const stub = stubFetch(async () => ok("<html><body>Just a moment...</body></html>"));
  try {
    await assert.rejects(
      () => CodeforcesHttp.page("https://codeforces.com/contest/1/standings"),
      /blocking requests/,
    );
  } finally {
    stub.restore();
  }
});

test("an ordinary page comes back parsed, ready for the scrapers", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html><table class='problems'></table></html>"));
  try {
    const doc = await CodeforcesHttp.page("https://codeforces.com/gym/1");
    // A Document rather than the string: everything in `scrapers/` takes one,
    // and the parse happening in the client is what keeps `DOMParser` out of
    // platform code entirely.
    assert.ok(doc.querySelector("table.problems"), "the page should arrive queryable");
  } finally {
    stub.restore();
  }
});

test("the session cookie is sent, which is what makes a private gym readable", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html></html>"));
  try {
    await CodeforcesHttp.page("https://codeforces.com/gym/712373/standings");
    assert.equal(
      stub.calls[0].init.credentials,
      "include",
      "without the cookie a private gym's standings are invisible and the add fails for the wrong reason",
    );
  } finally {
    stub.restore();
  }
});

test("requests actually go through the pacer", async () => {
  // The scrape's throttling is what keeps the extension from being blocked, and
  // it is invisible: nothing about a response says whether a delay was served.
  // A pinned, small gap is observable where the real 1–2.5s one is not.
  resetHttpState(60);
  const stub = stubFetch(async () => ok("<html></html>"));
  try {
    await CodeforcesHttp.page("https://codeforces.com/contest/1/standings");
    await CodeforcesHttp.page("https://codeforces.com/contest/2/standings");

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `the second request was not paced — fired ${gap}ms after the first`);
  } finally {
    stub.restore();
    resetHttpState();
  }
});

test("a block is flagged, so it can wait instead of failing the add", async () => {
  // Before this flag existed the block threw bare, and nothing turned it into a
  // status — so `contest-manager.js` never set `isNotPublishedYet`, `ui/index.js`
  // never made a waiting entry, and a Cloudflare challenge failed the add
  // outright. The user had to notice and press Add again. `contest-status.js`
  // had always defined `sourceUnreachable` for exactly this; only the wiring
  // was missing.
  //
  // A flag, not a message match: a copy edit to that sentence must not silently
  // change which failures retry.
  for (const response of [
    { status: 403, async text() { return ""; } },
    { status: 200, async text() { return "<html>Just a moment</html>"; } },
  ]) {
    resetHttpState();
    globalThis.fetch = async () => response;

    const error = await CodeforcesHttp.page("https://codeforces.com/contest/1/standings").then(
      () => null,
      (e) => e,
    );
    assert.ok(error, "a block must throw");
    assert.equal(error.isSourceUnreachable, true, `status ${response.status} was not flagged`);
  }
});

test("an ordinary failure is not flagged, so it still fails loudly", async () => {
  // Only the challenge waits. A layout change or a genuine fault must not be
  // quietly retried forever under the same flag.
  resetHttpState();
  globalThis.fetch = async () => ({ status: 200, async text() { return "<html><p>fine</p></html>"; } });
  const doc = await CodeforcesHttp.page("https://codeforces.com/x");
  assert.match(doc.querySelector("p").textContent, /fine/);
});
