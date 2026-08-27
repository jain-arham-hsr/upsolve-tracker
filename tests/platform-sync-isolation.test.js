/**
 * problemset-sync and start-time-service match on bare `contestId` values, so
 * they are Codeforces-only and must be handed Codeforces contests exclusively.
 * These tests pin the filter that guarantees it — the failure it prevents is
 * silent: another platform's contest picking up a Codeforces start time
 * because the two happen to share a number.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { contestsOnPlatform } from "../core/platforms/registry.js";
import { syncStartTimes } from "../core/start-time-service.js";
import { syncOfficialProblemData } from "../core/platforms/codeforces/problemset-sync.js";

const cf = (over = {}) => ({
  id: "1000", platform: "codeforces", type: "OFFICIAL", problems: [], ...over,
});

test("contestsOnPlatform keeps only the named platform", () => {
  const contests = [
    cf({ id: "1" }),
    cf({ id: "2", platform: "atcoder" }),
    cf({ id: "3", platform: "codechef" }),
  ];
  assert.deepEqual(contestsOnPlatform(contests, "codeforces").map((c) => c.id), ["1"]);
  assert.deepEqual(contestsOnPlatform(contests, "atcoder").map((c) => c.id), ["2"]);
  assert.deepEqual(contestsOnPlatform(contests, "nope"), []);
  assert.deepEqual(contestsOnPlatform(undefined, "codeforces"), []);
});


test("the filter is what stops a foreign contest inheriting a CF start time", async () => {
  // Same id on two platforms. Unfiltered, the bare-id match would date both.
  const foreign = cf({ id: "1000", platform: "atcoder", type: "ABC" });
  const service = {
    async getContestList() {
      return [{ id: 1000, startTimeSeconds: 1_700_000_000 }];
    },
    async getContestStandings() {
      throw new Error("should not be called");
    },
  };

  const filtered = contestsOnPlatform([cf(), foreign], "codeforces");
  await syncStartTimes(service, filtered);

  assert.equal(filtered[0].startTimeSeconds, 1_700_000_000, "the CF contest is dated");
  assert.equal(foreign.startTimeSeconds, undefined, "the AtCoder contest was left alone");
});

test("gyms are skipped by the problemset sync — they aren't in the problemset", async () => {
  const gym = cf({ id: "104123", type: "GYM", problems: [{ index: "A", tags: [] }] });
  let called = false;
  const service = {
    async getProblemsetProblems() {
      called = true;
      return { problems: [] };
    },
  };
  const updated = await syncOfficialProblemData(service, [gym]);
  assert.equal(updated, 0);
  assert.equal(called, false, "no request should be made when nothing is eligible");
});

test("a published rating replaces an estimate and records its source", async () => {
  const contest = cf({
    id: "2193",
    problems: [{ index: "A", rating: 1100, ratingSource: "estimated", tags: [] }],
  });
  const service = {
    async getProblemsetProblems() {
      return { problems: [{ contestId: 2193, index: "A", rating: 1300, tags: ["dp"] }] };
    },
  };
  await syncOfficialProblemData(service, [contest]);
  assert.equal(contest.problems[0].rating, 1300);
  assert.equal(contest.problems[0].ratingSource, "official");
  assert.deepEqual(contest.problems[0].tags, ["dp"]);
});
