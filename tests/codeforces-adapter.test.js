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
import { shouldWait } from "../core/contest-status.js";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { CodeforcesHttp } = await import("../core/platforms/codeforces-gyms/http.js");
const { getAdapter } = await import("../core/platforms/adapters.js");

/**
 * These cases stub the page the way Codeforces serves it — as HTML — while
 * production's `getDocument` hands back a parsed `Document`. This bridges the
 * two so each stub below stays a readable page rather than a constructed DOM.
 * The real `getDocument`, parse included, is covered by
 * `tests/codeforces-http.test.js`.
 */
CodeforcesHttp.getDocument = async (...args) =>
  new DOMParser().parseFromString(await CodeforcesHttp.get(...args), "text/html");

/**
 * Codeforces is two platforms now, and the subtype is what picks between them —
 * so this routes the way `matchContestUrl` does, and every case below keeps
 * naming the subtype it is about.
 */
const fetchContestRecord = ({ subtype, ...rest }) =>
  getAdapter(subtype === "GYM" ? "codeforces-gyms" : "codeforces-official")
    .fetchContestRecord({ subtype, ...rest });

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

/**
 * fetchContestRecord answers with one of the statuses in
 * core/contest-status.js. These tests are about the record it builds, so this
 * unwraps a "ready" and throws otherwise. Status handling is asserted
 * directly, below.
 */
const record = async (service) => {
  const result = await fetchContestRecord({
    contestId: "702859",
    subtype: "GYM",
    session: { service },
  });
  if (result.status !== "ready") {
    throw Object.assign(new Error(result.reason), { contestStatus: result.status });
  }
  return result.contest;
};

test("a fully rated gym takes Codeforces' numbers and never measures the field", async () => {
  CodeforcesHttp.get = async () => standingsPage("702859");

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
  // response solve-stats already paid for.
  assert.equal(contest.startTimeSeconds, 1000);
});

test("a mixed gym estimates only what Codeforces leaves unrated", async () => {
  CodeforcesHttp.get = async () => standingsPage("702859");
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
  CodeforcesHttp.get = async (url) =>
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
      // The flag `api.js#getContestStandings` sets from Codeforces' comment;
      // these stubs bypass the real client, so they raise it themselves.
      throw Object.assign(new Error("contestId: Standings are not available"), {
        isStandingsHidden: true,
      });
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
  CodeforcesHttp.get = async (url) =>
    url.includes("/standings") ? NO_TABLE : problemsPage("712373");

  const contest = await record({
    getContestStandings: async () => {
      // The flag `api.js#getContestStandings` sets from Codeforces' comment;
      // these stubs bypass the real client, so they raise it themselves.
      throw Object.assign(new Error("contestId: Standings are not available"), {
        isStandingsHidden: true,
      });
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

// ---------------------------------------------------------------------------
// Statuses: the answers that are not a contest.
// ---------------------------------------------------------------------------

const status = (args, service) =>
  fetchContestRecord({ session: { service }, ...args });

test("an official round Codeforces has not published waits, and is not scraped", async () => {
  // The scrape is the expensive half — tens of deliberately throttled requests.
  // Asking the problemset first means a contest that is going to wait never
  // pays for it, and produces no estimate to be overwritten later.
  CodeforcesHttp.get = async () => {
    throw new Error("a waiting contest must not be scraped");
  };
  const result = await status(
    { contestId: "9999", subtype: "OFFICIAL" },
    {
      getProblemsetProblems: async () => ({ problems: [{ contestId: 2193, index: "A" }] }),
    },
  );
  assert.equal(result.status, "notPublishedYet");
  assert.match(result.reason, /hasn't published/);
});

test("a gym is never asked about the problemset — it would never be in one", async () => {
  // Gyms are absent from problemset.problems entirely, so applying the official
  // gate to them would make every gym unaddable.
  CodeforcesHttp.get = async () => standingsPage("702859");
  const contest = await record({
    getProblemsetProblems: async () => {
      throw new Error("a gym must not consult the problemset");
    },
    getContestStandings: async () => standingsApi([1300, 900, 2100]),
    getContestList: async () => [],
  });
  assert.equal(contest.problems.length, 3);
});

test("a gym still running waits rather than storing estimates fitted to it", async () => {
  // The worst version of the bug: a running gym has visible standings carrying
  // partial solve counts, and a gym is the one contest nothing ever re-rates,
  // so anything derived now would be permanent.
  CodeforcesHttp.get = async () => standingsPage("702859");
  const running = standingsApi([null, null, null]);
  running.contest.phase = "CODING";

  const result = await status(
    { contestId: "702859", subtype: "GYM" },
    {
      getContestStandings: async () => running,
      getUsersInfo: async () => {
        throw new Error("a running gym must not measure the field");
      },
      getContestList: async () => [],
    },
  );
  assert.equal(result.status, "notEndedYet");
  assert.match(result.reason, /still running/);
});

test("a finished gym with no visible field refuses instead of waiting forever", async () => {
  // The fact that replaced `mayBeUnpublished("GYM") === false`. Private or
  // empty standings do not become visible later, so retrying cannot help —
  // and `unavailable` is the one status that does not wait.
  CodeforcesHttp.get = async () => standingsPage("702859");
  const empty = standingsApi([null, null, null]);
  empty.contest.phase = "FINISHED";
  empty.rows = [];

  const result = await status(
    { contestId: "702859", subtype: "GYM" },
    {
      getContestStandings: async () => empty,
      getUsersInfo: async () => [],
      getContestList: async () => [],
    },
  );
  assert.equal(result.status, "unavailable");
});

test("an unreadable phase proceeds rather than blocking the add", async () => {
  // `finished === null` means the source did not say. Refusing then would make
  // a contest unaddable for a reason we cannot state.
  CodeforcesHttp.get = async () => standingsPage("702859");
  const noPhase = standingsApi([1300, 900, 2100]);
  delete noPhase.contest.phase;

  const contest = await record({
    getContestStandings: async () => noPhase,
    getContestList: async () => [],
  });
  assert.equal(contest.problems.length, 3);
});


test("a blocked scrape answers sourceUnreachable, and that status waits", async () => {
  // The other half of the fix: the flag has to become a status, or nothing
  // upstream can act on it. `shouldWait` is asserted here rather than assumed,
  // because "returns a status" and "actually retries" are different claims.
  //
  // Driven through the **hidden-standings** gym, which is now the only path
  // that reads HTML at all — a visible gym is read entirely from the API and
  // has no scrape left to block.
  CodeforcesHttp.get = async () => {
    throw Object.assign(new Error("Codeforces is blocking requests."), {
      isSourceUnreachable: true,
    });
  };

  const result = await fetchContestRecord({
    contestId: "702859",
    subtype: "GYM",
    session: {
      service: {
        getContestStandings: async () => {
          throw Object.assign(new Error("contestId: Standings are not available"), {
            isStandingsHidden: true,
          });
        },
      },
    },
  });

  assert.equal(result.status, "sourceUnreachable");
  assert.equal(shouldWait(result.status), true, "a challenge clears on its own, so it must retry");
});

test("a scrape failure that is not a block still escapes", async () => {
  // `unavailable` and a bare throw both remain possible; only the challenge is
  // reclassified. Swallowing everything here would hide real faults.
  CodeforcesHttp.get = async () => {
    throw new Error("something else went wrong");
  };

  await assert.rejects(
    () =>
      fetchContestRecord({
        contestId: "702859",
        subtype: "GYM",
        session: {
          service: {
            getContestStandings: async () => {
              throw Object.assign(new Error("contestId: Standings are not available"), {
                isStandingsHidden: true,
              });
            },
          },
        },
      }),
    /something else went wrong/,
  );
});

test("an official contest takes Codeforces' published ratings, not estimates", async () => {
  // The regression this exists for: `problems.js` used to hand the metadata
  // syncs a record with no `type`, and `problemset-sync.js#needsSync` gates on
  // `contest.type !== "OFFICIAL"`. So every official add silently skipped the
  // published ratings and tags, the estimator then ran on problems Codeforces
  // had already rated, and the queue stored estimates — mean error ~211 — in
  // their place. Nothing failed; the numbers were just quietly wrong.
  //
  // The whole suite passed with that bug present, because every other case here
  // adds a GYM, where `needsSync` correctly answers false either way.
  CodeforcesHttp.get = async () => standingsPage("2197");

  const result = await fetchContestRecord({
    contestId: "2197",
    subtype: "OFFICIAL",
    session: {
      service: {
        getProblemsetProblems: async () => ({
          problems: INDEXES.map((index, i) => ({
            contestId: 2197,
            index,
            rating: 800 + i * 400,
            tags: ["math"],
          })),
        }),
        // The official path builds the whole record from this now — roster,
        // name, ratings and solve counts — and never touches the scrape.
        getPublicContestStandings: async () => ({
          contest: { name: "Round", startTimeSeconds: 1000 },
          problems: INDEXES.map((index, i) => ({
            index, name: `Problem ${index}`, rating: 800 + i * 400, tags: ["math"],
          })),
          rows: [],
        }),
        getContestList: async () => [],
        getUsersInfo: async () => {
          throw new Error("the field must not be measured when CF published every rating");
        },
        getContestStandings: async () => {
          throw new Error("no estimate should be needed");
        },
      },
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.contest.problems.map((p) => p.rating), [800, 1200, 1600]);
  assert.deepEqual(
    result.contest.problems.map((p) => p.ratingSource),
    ["official", "official", "official"],
  );
  assert.deepEqual(result.contest.problems.map((p) => p.tags), [["math"], ["math"], ["math"]]);
});

test("a gym's standings are fetched once, not once per concern", async () => {
  // `solve-stats.js` fetches contest.standings to count gym solves, and the
  // estimator needs the very same response to measure the field. It used to
  // fetch it again — one extra throttled API call per gym add, for bytes
  // already in memory. The response now travels through `acquired.context`.
  //
  // Counted rather than eyeballed, because nothing about a correct rating says
  // how many requests produced it: this could regress silently forever.
  CodeforcesHttp.get = async () => standingsPage("702859");

  let standingsCalls = 0;
  const contest = await record({
    getContestStandings: async () => {
      standingsCalls++;
      return standingsApi([1300, null, null]);
    },
    getUsersInfo: async (handles) => handles.map((handle) => ({ handle, rating: 1500 })),
    getContestList: async () => [],
  });

  // Something must actually have needed estimating, or this proves nothing:
  // a fully rated gym skips the estimator and would pass trivially.
  assert.equal(contest.problems[1].ratingSource, "estimated");
  assert.equal(standingsCalls, 1, "contest.standings was fetched more than once");
});

test("a shared Div 1 / Div 2 problem takes its published rating, not an estimate", async () => {
  // The regression this exists for. `problemset.problems` lists each problem
  // once, under the contest it originated in — so a Div 2 round sharing
  // problems with a Div 1 one finds nothing for them under its own id, and the
  // estimator rated problems Codeforces had already rated. Round 1079 stored
  // D as 1500 against a published 1600, and E2 as 2100 against 2000.
  //
  // Nothing exposes the pairing — not the API, not the HTML — so the fix is to
  // read the ratings Codeforces attaches to *this* contest's own indices.
  CodeforcesHttp.get = async () => standingsPage("2197");

  const result = await fetchContestRecord({
    contestId: "2197",
    subtype: "OFFICIAL",
    session: {
      service: {
        // Only A is filed under this contest; B and C live under the Div 1 twin.
        getProblemsetProblems: async () => ({
          problems: [{ contestId: 2197, index: "A", rating: 800, tags: ["math"] }],
        }),
        // …but the contest's own standings carry all three, correctly.
        getPublicContestStandings: async () => ({
          problems: [
            { index: "A", name: "Problem A", rating: 800, tags: ["math"] },
            { index: "B", name: "Problem B", rating: 1600, tags: ["dp"] },
            { index: "C", name: "Problem C", rating: 2000, tags: ["graphs"] },
          ],
          rows: [],
        }),
        getContestList: async () => [],
        getUsersInfo: async () => {
          throw new Error("the field must not be measured — every rating is published");
        },
        getContestStandings: async () => {
          throw new Error("the signed call is refused for a non-gym contest");
        },
      },
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.contest.problems.map((p) => p.rating), [800, 1600, 2000]);
  assert.deepEqual(
    result.contest.problems.map((p) => p.ratingSource),
    ["official", "official", "official"],
    "B and C are published under the twin, so they must not read as estimates",
  );
});

test("losing the standings answers sourceUnreachable, so the add retries", async () => {
  // This used to be soft: the standings call only supplied ratings, so losing it
  // cost the shared problems an estimate. It is now the *only* source of the
  // roster, so losing it means there is no contest to store — and an unreachable
  // API is a reason to wait and retry, not to refuse.
  const result = await fetchContestRecord({
    contestId: "2197",
    subtype: "OFFICIAL",
    session: {
      service: {
        getProblemsetProblems: async () => ({
          problems: [{ contestId: 2197, index: "A", rating: 800, tags: [] }],
        }),
        getPublicContestStandings: async () => {
          throw Object.assign(new Error("network"), { isSourceUnreachable: true });
        },
        getContestList: async () => [],
      },
    },
  });

  assert.equal(result.status, "sourceUnreachable");
  assert.equal(shouldWait(result.status), true);
});

test("the official path makes no HTML request at all, estimator included", async () => {
  // The whole point of the change, and nothing else would catch a
  // reintroduction: a scrape here is what Cloudflare challenges, and it is why
  // adding official contests broke entirely.
  //
  // **This has to reach the estimator to mean anything.** An earlier version
  // stubbed the problemset empty, so the add short-circuited on
  // `notPublishedYet` before acquiring anything and the assertion held for the
  // wrong reason — it passed just as happily while the official path was still
  // sampling ~32 standings pages over HTTP. So the contest is in the
  // problemset, one problem is left unrated, and `contest.ratingChanges` is
  // empty: exactly the combination that used to scrape.
  let scraped = false;
  CodeforcesHttp.get = async () => { scraped = true; return standingsPage("2197"); };

  const result = await fetchContestRecord({
    contestId: "2197",
    subtype: "OFFICIAL",
    session: {
      service: {
        getProblemsetProblems: async () => ({
          problems: [{ contestId: 2197, index: "A", rating: 800, tags: ["math"] }],
        }),
        getPublicContestStandings: async () => ({
          contest: { name: "Round", startTimeSeconds: 1000 },
          // B is unrated everywhere, so the estimator must run for it.
          problems: [
            { index: "A", name: "Alpha", rating: 800, tags: [] },
            { index: "B", name: "Beta", tags: [] },
          ],
          rows: Array.from({ length: 120 }, (_, i) => ({
            party: { ghost: false, members: [{ handle: `u${i}` }] },
            problemResults: [
              { bestSubmissionTimeSeconds: 5 },
              { bestSubmissionTimeSeconds: i < 4 ? 9 : null },
            ],
          })),
        }),
        // Empty: the round is not rated yet, which is what sends the field to
        // the standings rows rather than to ratingChanges.
        getContestRatingChanges: async () => [],
        getUsersInfo: async (handles) => handles.map((handle) => ({ handle, rating: 1500 })),
        getContestList: async () => [],
      },
    },
  });

  assert.equal(scraped, false, "official contests must not touch the standings page");
  assert.equal(result.status, "ready", result.reason);

  // Proof the run actually reached the branch that used to scrape: B has no
  // published rating anywhere, so a number here can only have been fitted
  // against a field measured from the standings rows.
  const beta = result.contest.problems.find((problem) => problem.index === "B");
  assert.equal(beta.ratingSource, "estimated", "the estimator never ran, so this proves nothing");
  assert.ok(beta.rating > 0);
});
