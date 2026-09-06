/**
  * sync/published-data and sync/start-times match on bare `contestId` values, so they are
 * Codeforces-only and must be handed Codeforces contests exclusively.
 * These tests pin the filter that guarantees it — the failure it prevents is
 * silent: another platform's contest picking up a Codeforces start time
 * because the two happen to share a number.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { contestsOnPlatform } from "../core/platforms/registry.js";
import { syncStartTimes } from "../core/platforms/codeforces-official/sync/start-times.js";
import { syncPublishedProblemData } from "../core/platforms/codeforces-official/sync/published-data.js";

/**
 * `startTimeSeconds` defaults to *now* because the re-check stops asking about a
 * contest six weeks after it ran — a fixture with no date would read as epoch 0
 * and be silently out of scope, which passes the tests below for the wrong
 * reason. Note it is epoch **seconds**, unlike every millisecond stamp here.
 */
const cf = (over = {}) => ({
  id: "1000",
  platform: "codeforces-official",
  type: "OFFICIAL",
  problems: [],
  startTimeSeconds: Math.floor(Date.now() / 1000),
  ...over,
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgoSeconds = (days) => Math.floor((Date.now() - days * DAY) / 1000);

test("contestsOnPlatform keeps only the named platform", () => {
  const contests = [
    cf({ id: "1" }),
    cf({ id: "2", platform: "atcoder" }),
    cf({ id: "3", platform: "codechef" }),
  ];
  assert.deepEqual(contestsOnPlatform(contests, "codeforces-official").map((c) => c.id), ["1"]);
  assert.deepEqual(contestsOnPlatform(contests, "atcoder").map((c) => c.id), ["2"]);
  assert.deepEqual(contestsOnPlatform(contests, "nope"), []);
  assert.deepEqual(contestsOnPlatform(undefined, "codeforces-official"), []);
});


test("the filter is what stops a foreign contest inheriting a CF start time", async () => {
  // Same id on two platforms. Unfiltered, the bare-id match would date both.
  // Both undated, since `syncStartTimes` only looks at contests missing a date —
  // the `cf` helper supplies one by default for the re-check tests below.
  const foreign = cf({ id: "1000", platform: "atcoder", type: "ABC", startTimeSeconds: null });
  const service = {
    async getContestList() {
      return [{ id: 1000, startTimeSeconds: 1_700_000_000 }];
    },
    async getContestStandings() {
      throw new Error("should not be called");
    },
  };

  const filtered = contestsOnPlatform(
    [cf({ startTimeSeconds: null }), foreign],
    "codeforces-official",
  );
  await syncStartTimes(service, filtered);

  assert.equal(filtered[0].startTimeSeconds, 1_700_000_000, "the CF contest is dated");
  assert.equal(foreign.startTimeSeconds, null, "the AtCoder contest was left alone");
});

test("gyms never reach the official sync — they are a different platform", async () => {
  // This used to work by handing the sync a gym and asserting it declined,
  // because the module gated on `contest.type !== "OFFICIAL"`.
  //
  // That gate is gone, and deliberately: the module lives in
  // `codeforces-official/` now and gyms are a different platform, so a gym
  // cannot arrive here at all. What is worth asserting is the thing that makes
  // that true — `contestsOnPlatform` keeps them apart — because the gate it
  // replaced had a real failure: a record built before `type` was stamped on it
  // read as "not official", so every official add silently skipped its
  // published ratings.
  const gym = { id: "104123", platform: "codeforces-gyms", type: "GYM", problems: [{ index: "A", tags: [] }] };
  const official = cf({ id: "2193", problems: [{ index: "A", tags: [] }] });

  const mine = contestsOnPlatform([gym, official], "codeforces-official");
  assert.deepEqual(mine.map((contest) => contest.id), ["2193"], "a gym reached the official sync");

  let called = false;
  const service = {
    async getPublicContestStandings() {
      called = true;
      return { problems: [] };
    },
  };
  assert.equal(await syncPublishedProblemData(service, contestsOnPlatform([gym], "codeforces-official")), 0);
  assert.equal(called, false, "no request should be made when nothing is eligible");
});

/** A standings response carrying one published problem. */
const standingsFor = (index, rating, tags) => ({
  problems: [{ index, name: "Alpha", rating, tags }],
});

test("a published rating replaces an estimate and records its source", async () => {
  const contest = cf({
    id: "2193",
    problems: [{ index: "A", rating: 1100, ratingSource: "estimated", tags: [] }],
  });
  let asked = null;
  const service = {
    async getPublicContestStandings(id) {
      asked = id;
      return standingsFor("A", 1300, ["dp"]);
    },
  };

  await syncPublishedProblemData(service, [contest]);

  assert.equal(asked, "2193", "the re-check asks about this contest by id");
  assert.equal(contest.problems[0].rating, 1300);
  assert.equal(contest.problems[0].ratingSource, "official");
  assert.deepEqual(contest.problems[0].tags, ["dp"]);
  assert.ok(contest.publishedDataCheckedAt > 0, "a successful re-check stamps the contest");
});

test("the re-check never reads problemset.problems", async () => {
  // The whole point of the move. `problemset.problems` files a shared
  // Div. 1 / Div. 2 problem under the originating contest, so for a third of
  // Div. 2 rounds it cannot supply most of the ratings — and a contest it could
  // not fix stayed incomplete and was re-fetched every week forever.
  const contest = cf({
    id: "2256",
    problems: [{ index: "C", rating: 1000, ratingSource: "estimated", tags: [] }],
  });
  const service = {
    async getPublicContestStandings() {
      return standingsFor("C", 1200, ["math"]);
    },
    async getProblemsetProblems() {
      throw new Error("the re-check must not consult the problemset");
    },
  };

  await syncPublishedProblemData(service, [contest]);
  assert.equal(contest.problems[0].rating, 1200);
});

test("a contest stops being asked about six weeks after it ran", async () => {
  // Without this the re-check never terminates: a round Codeforces will never
  // rate — an ICPC challenge, a Kotlin Heroes practice round — stays incomplete
  // and so is re-fetched weekly for the life of the queue.
  const stale = { index: "A", rating: 900, ratingSource: "estimated", tags: [] };
  const young = cf({ id: "1", startTimeSeconds: daysAgoSeconds(40), problems: [{ ...stale }] });
  const old = cf({ id: "2", startTimeSeconds: daysAgoSeconds(43), problems: [{ ...stale }] });

  const asked = [];
  const service = {
    async getPublicContestStandings(id) {
      asked.push(id);
      return standingsFor("A", 1500, ["dp"]);
    },
  };

  await syncPublishedProblemData(service, [young, old]);

  assert.deepEqual(asked, ["1"], "a contest past the cutoff must never be asked");
  assert.equal(old.problems[0].rating, 900, "and must be left exactly as it was");
});

test("the cutoff reads seconds, not milliseconds", async () => {
  // `startTimeSeconds` is epoch seconds while every other stamp on a record is
  // milliseconds. Treating it as milliseconds dates every contest to 1970 and
  // silently puts the whole queue past the cutoff — the re-check would then do
  // nothing at all, and every test above would still pass.
  const contest = cf({
    startTimeSeconds: daysAgoSeconds(1),
    problems: [{ index: "A", rating: 900, ratingSource: "estimated", tags: [] }],
  });
  let asked = false;
  const service = {
    async getPublicContestStandings() {
      asked = true;
      return standingsFor("A", 1500, ["dp"]);
    },
  };

  await syncPublishedProblemData(service, [contest]);
  assert.equal(asked, true, "a contest that ran yesterday must be in scope");
});

test("an undated contest falls back to when it was added", async () => {
  // `solve-stats.js` takes the start time from the standings with `?? null`, so
  // it is usual but not guaranteed. A contest we cannot date is better bounded
  // by when it was added than not bounded at all.
  const problems = [{ index: "A", rating: 900, ratingSource: "estimated", tags: [] }];
  const recent = cf({ id: "1", startTimeSeconds: null, addedAt: Date.now(), problems: [...problems] });
  const ancient = cf({ id: "2", startTimeSeconds: null, addedAt: Date.now() - 50 * DAY, problems: [...problems] });

  const asked = [];
  const service = {
    async getPublicContestStandings(id) {
      asked.push(id);
      return standingsFor("A", 1500, ["dp"]);
    },
  };

  await syncPublishedProblemData(service, [recent, ancient]);
  assert.deepEqual(asked, ["1"]);
});

test("a fully published contest is never asked again", async () => {
  // The steady state, and what keeps the cost bounded: once every problem
  // carries an official rating and tags, there is nothing left to converge to.
  const contest = cf({
    problems: [{ index: "A", rating: 1300, ratingSource: "official", tags: ["dp"] }],
  });
  const service = {
    async getPublicContestStandings() {
      throw new Error("a settled contest must not be re-asked");
    },
  };
  assert.equal(await syncPublishedProblemData(service, [contest]), 0);
});

test("a contest asked about recently waits out its week", async () => {
  const contest = cf({
    publishedDataCheckedAt: Date.now() - 2 * DAY,
    problems: [{ index: "A", rating: 900, ratingSource: "estimated", tags: [] }],
  });
  const service = {
    async getPublicContestStandings() {
      throw new Error("asked again inside the week");
    },
  };
  assert.equal(await syncPublishedProblemData(service, [contest]), 0);

  contest.publishedDataCheckedAt = Date.now() - 8 * DAY;
  const service2 = { async getPublicContestStandings() { return standingsFor("A", 1500, ["dp"]); } };
  assert.equal(await syncPublishedProblemData(service2, [contest]), 1);
});

test("a failed re-check is not stamped, so it retries next refresh", async () => {
  const contest = cf({
    problems: [{ index: "A", rating: 900, ratingSource: "estimated", tags: [] }],
  });
  const service = {
    async getPublicContestStandings() {
      throw new Error("network");
    },
  };

  assert.equal(await syncPublishedProblemData(service, [contest]), 0);
  assert.equal(
    contest.publishedDataCheckedAt ?? 0,
    0,
    "stamping on failure would make the contest wait another week for nothing",
  );
});
