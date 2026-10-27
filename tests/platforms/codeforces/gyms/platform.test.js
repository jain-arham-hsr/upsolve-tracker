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

const { CodeforcesApi } = await import("../../../../core/platforms/codeforces/api.js");
const { CodeforcesScraper } = await import("../../../../core/platforms/codeforces/scraper.js");
const { getPlatform } = await import("../../../../core/platforms/registry.js");

/**
 * The page a hidden-standings gym reads, stubbed the way Codeforces serves it
 * — as HTML — and parsed the way the scraper's `document` would, so each stub stays
 * a readable page. `tests/codeforces-http.test.js` covers the real one.
 */
const pages = { get: async () => { throw new Error("no page served"); } };
const parsed = async (url) => new DOMParser().parseFromString(await pages.get(url), "text/html");

/**
 * Drives the platform's `fetchContest` over a real API with the fake answers
 * assigned over it and a real scraper with the page read stubbed, and
 * flattens what it acquired — the record plus its `context` — into one
 * object, which is the shape these cases assert on. `contest.list` is
 * stubbed empty so the start-time pass makes no request.
 */
async function acquire(platformId, contestId, fake) {
  const api = Object.assign(new CodeforcesApi("k", "s"), { contestList: async () => [] }, fake);
  const scraper = Object.assign(new CodeforcesScraper(), { document: parsed });
  const acquired = await getPlatform(platformId).fetchContest({ contestId, session: { api, scraper } });
  if (acquired.status) throw new Error(`${acquired.status}: ${acquired.reason}`);
  return { contestName: acquired.name, ...acquired, ...acquired.context };
}
const acquireGym = (contestId, fake) => acquire("codeforces-gyms", contestId, fake);
const acquireOfficial = (contestId, fake) => acquire("codeforces-official", contestId, fake);

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
  pages.get = async (url) => {
    seen.push(url);
    const body = url.includes("/standings") ? standings : problems;
    if (body instanceof Error) throw body;
    return body;
  };
  return seen;
}

/**
 * The error the real client raises for a gym whose standings the setter hid.
 *
 * `api.js#contestStandings` matches Codeforces' comment once and converts it
 * to this flag, so nothing downstream reads prose. These stubs bypass the real
 * client, so they have to raise the flag themselves — and the test that pins
 * the translation lives next to the others below.
 */
const standingsHidden = () =>
  Object.assign(new Error("contestId: Standings are not available"), {
    isStandingsHidden: true,
  });

/** A service whose standings are hidden, so the fallback is what runs. */
function hiddenService(extra = {}) {
  return {
    contestStandings: async () => {
      throw standingsHidden();
    },
    ...extra,
  };
}

/** A service that fails loudly if the fallback touches it. */
function forbiddenService(allow = {}) {
  return {
    contestStandings: async () => {
      throw new Error("contestStandings should not have been called");
    },
    contestStatus: async () => {
      throw new Error("contestStatus should not have been called");
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

test("the official reader is a different module, and it reaches no page at all", async () => {
  // This began as a guard that an official contest with no standings *table*
  // failed loudly rather than taking the gym fallback — a missing table being
  // far likelier a layout change than a deliberate setting.
  //
  // It is moot twice over now. Official contests read `contest.standings` and
  // never fetch the page, so there is no table to be missing; and the reader
  // below is a different module in a different platform, so the fallback is not
  // something it could reach even by mistake. The guard became the directory.
  const seen = serve({ standings: NO_TABLE, problems: problemsPage(1) });

  const stats = await acquireOfficial("2193", forbiddenService({
    // The publication gate runs first; this round is in the problemset.
    problemsetProblems: async () => ({ problems: [{ contestId: 2193, index: "A" }] }),
    publicContestStandings: async () => ({
      contest: { name: "Round 2193", startTimeSeconds: 4242 },
      problems: [{ index: "A", name: "Alpha", rating: 900, tags: ["math"] }],
      rows: [],
    }),
  }));

  assert.deepEqual(seen, [], "official contests must make no HTML request");
  assert.equal(stats.contestName, "Round 2193");
  assert.equal(stats.startTimeSeconds, 4242, "the start time arrives here now");
  assert.deepEqual(stats.problems.map((p) => p.index), ["A"]);
  assert.equal(stats.problems[0].ratingSource, "official");
});

/**
 * A mashup — problems assembled from the archive, never run as a timed event —
 * has no start time on Codeforces at all: the API omits the key rather than
 * sending a null or a 0. That is an answer, and the response the add already
 * holds is where it arrives, so nothing further should ever be fetched for it.
 */
test("a gym the site never scheduled is answered from the standings already in hand", async () => {
  let listCalls = 0;
  let standingsCalls = 0;

  const acquired = await acquireGym(
    "715029",
    {
      contestList: async () => { listCalls++; return []; },
      contestStandings: async () => {
        standingsCalls++;
        return {
          // No `startTimeSeconds`: the real shape of an unscheduled contest.
          contest: { name: "Intermediate Math I" },
          problems: [{ index: "A", name: "Alpha", rating: 1600, tags: [] }],
          rows: [],
        };
      },
    },
  );

  assert.equal(acquired.startTimeSeconds, null);
  assert.equal(acquired.startTimeUnavailable, true, "the site answered, and the answer is stored");
  assert.equal(standingsCalls, 1, "the response in hand answers it — no second fetch");
  assert.equal(listCalls, 0, "and no 1 MB gym list, which never lists a mashup anyway");
});

test("standings that carry no contest object at all are not an answer", async () => {
  // `fromStandings` already tolerates this, falling back to `Gym <id>` for the
  // name. Reading the evidence off the field through `?.` instead of off the
  // object silently files it as "the site says there is none", which would
  // permanently silence a contest that was never actually asked about.
  const acquired = await acquireGym(
    "715029",
    {
      contestStandings: async () => ({
        problems: [{ index: "A", name: "Alpha", rating: 1600, tags: [] }],
        rows: [],
      }),
    },
  );

  assert.equal(acquired.contestName, "Gym 715029");
  assert.equal(acquired.startTimeSeconds, null);
  assert.equal(acquired.startTimeUnavailable, false, "nothing answered, so it stays askable");
});

test("a visible gym is read from the API alone — no page, no contest.status", async () => {
  // The roster used to be scraped off /gym/<id>/standings while this same call
  // was made anyway for everything else. `seen` staying empty is the point.
  const seen = serve({ standings: standingsPage(702859), problems: problemsPage(702859) });

  const stats = await acquireGym(
    "702859",
    forbiddenService({
      contestStandings: async () => ({
        contest: { name: "AlgoSSTorm - #1", startTimeSeconds: 1234 },
        // A and C carry Codeforces' own rating, B does not — the usual shape,
        // since a gym mixes archive picks with the setter's own problems.
        problems: [
          { index: "A", name: "Alpha", tags: ["dp"], rating: 1300 },
          { index: "B", name: "Beta", tags: ["dp"] },
          { index: "C", name: "Gamma", tags: ["dp"], rating: 900 },
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

  assert.deepEqual(seen, [], "a visible gym must make no HTML request");
  assert.equal(stats.contestName, "AlgoSSTorm - #1", "the name comes off the API now");
  assert.deepEqual(stats.problems.map((p) => p.name), ["Alpha", "Beta", "Gamma"]);
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
  // Unflagged, so it is not the hidden-standings case: a network fault or a bad
  // key must not be routed into a rebuild that would store a shorter contest.
  serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  await assert.rejects(
    () =>
      acquireGym("712373", {
        contestStandings: async () => {
          throw new Error("Codeforces API Error");
        },
        contestStatus: async () => {
          throw new Error("contestStatus should not have been called");
        },
      }),
    /Codeforces API Error/,
  );
});

test("a gym with hidden standings is rebuilt from contest.status", async () => {
  const seen = serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  const stats = await acquireGym(
    "712373", {
    contestStandings: async () => {
      throw standingsHidden();
    },
    contestStatus: async () => [
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

  const stats = await acquireGym(
    "712373",
    hiddenService({ contestStatus: async () => [submission("A", 1)] }),
  );

  assert.equal(stats.problems.length, 3);
  const c = stats.problems.find((p) => p.index === "C");
  assert.equal(c.name, "Not Assigning");
  assert.equal(c.officialSolves, 0);
  assert.equal(c.rating, null, "left for the estimator");
});

test("refuses loudly when the problems page can't be read either", async () => {
  serve({ standings: NO_TABLE, problems: "<html><body>nothing here</body></html>" });

  await assert.rejects(
    () => acquireGym("712373", hiddenService()),
    /standings hidden.*problems page couldn't be read/s,
  );
});

test("no official submissions means the solve counts are unusable, not zero", async () => {
  serve({ standings: NO_TABLE, problems: problemsPage(712373) });

  const stats = await acquireGym(
    "712373",
    hiddenService({
      contestStatus: async () => [
        { ...submission("A", 1), author: { ...submission("A", 1).author, participantType: "PRACTICE" } },
      ],
    }),
  );

  // solveCountsRead false is what makes the adapter refuse instead of handing
  // the estimator all-zero counts, which floor every problem at 800.
  assert.equal(stats.solveCountsRead, false);
});

test("gym 712373 end to end, against its real submissions", () => {
  // The closest this can get to the live add. Everything below the problems
  // page is the contest's actual contest.status response, and the numbers are
  // what the contest page shows.
  const fixture = JSON.parse(
    readFileSync(new URL("../../../fixtures/gym-standings-hidden.json", import.meta.url)),
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
  pages.get = async (url) =>
    url.includes("/standings")
      ? NO_TABLE
      : `<html><body>${sidebar(712373)}
         <table class="problems"><tr><th>#</th></tr>${rows}</table></body></html>`;

  return acquireGym(
    "712373",
    hiddenService({ contestStatus: async () => structuredClone(fixture.submissions) }),
  ).then((stats) => {
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

// ── without a key ───────────────────────────────────────────────────────
//
// The key pair is optional: an install whose ratings come from the shared
// catalog never needs a gym's standings, so it reads the problem list off the
// gym's own page — which reaches private gyms through the user's login, as
// measured from the side panel with no codeforces.com tab open.

const keyless = (fake = {}) =>
  Object.assign(new CodeforcesApi(null, null), { contestList: async () => [] }, forbiddenService(), fake);

test("with no key, a gym is read from its page and the standings are never asked for", async () => {
  const seen = serve({ standings: new Error("standings must not be read"), problems: problemsPage(722144) });
  const scraper = Object.assign(new CodeforcesScraper(), { document: parsed });

  const acquired = await getPlatform("codeforces-gyms").fetchContest({
    contestId: "722144",
    session: { api: keyless(), scraper },
  });

  assert.equal(acquired.status, undefined, `refused: ${acquired.reason}`);
  assert.deepEqual(seen.map((url) => url.includes("/standings")), [false], "exactly one page: the problems page");
  assert.equal(acquired.name, "ICPC PRELIMS PC : 1");
  assert.deepEqual(acquired.problems.map((p) => p.index), ["A", "B", "C"]);
  // No ratings from a page: those come from the catalog on such an install.
  assert.ok(acquired.problems.every((p) => p.rating === null && p.ratingSource === null));
});

test("an install that estimates is told it needs a key, not shown an API error", async () => {
  const contest = { id: "722144", problems: [{ index: "A", rating: null }] };
  const verdict = await getPlatform("codeforces-gyms").readField({
    contest,
    context: { solveCountsRead: false, partyHandles: null, standings: null },
    session: { api: keyless() },
  });
  assert.equal(verdict.status, "unavailable");
  assert.match(verdict.reason, /needs a Codeforces API key\. Add one in Settings\./);
});

test("with no key, dating a private gym asks nothing that can only fail", async () => {
  // Each lookup is a signed contest.standings; unsigned it fails, and would
  // fail again on every refresh. The gym stays undated instead.
  // Counted rather than forbidden: the loop catches a failed lookup, so a
  // throwing stub would leave the gym undated either way and prove nothing.
  let asked = 0;
  const contest = { id: "722144" };
  const api = keyless({ contestStandings: async () => { asked++; return null; } });
  await getPlatform("codeforces-gyms").syncStartTimes({ api }, [contest]);
  assert.equal(asked, 0, "a keyless install asked for standings it cannot read");
  assert.equal(contest.startTimeSeconds, undefined);
});
