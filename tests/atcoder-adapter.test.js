/**
 * The AtCoder adapter, against a stubbed fetch.
 *
 * The cases here are the ones that fail silently rather than loudly:
 * submission pagination stopping early (solved problems never leave the
 * queue), reading problems.json instead of contest-problem.json (half a
 * rerun contest goes missing), and clamping or inventing a difficulty.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearResourceCache,
  setRequestSpacing,
  getAcceptedProblemIds,
} from "../core/platforms/atcoder/problems-api.js";
import {
  fetchContestRecord,
  fetchSolvedKeys,
  syncMetadata,
} from "../core/platforms/atcoder/adapter.js";

const RESOURCES = {
  "problems.json": [
    { id: "abc471_a", contest_id: "abc471", problem_index: "A", name: "Signs" },
    { id: "abc471_b", contest_id: "abc471", problem_index: "B", name: "Bars" },
    { id: "old_x", contest_id: "abc100", problem_index: "X", name: "Reused" },
  ],
  "contests.json": [
    { id: "abc471", title: "AtCoder Beginner Contest 471", start_epoch_second: 1_755_000_000 },
    { id: "rerun", title: "Daily Training", start_epoch_second: 1_756_000_000 },
  ],
  "contest-problem.json": [
    { contest_id: "abc471", problem_id: "abc471_a", problem_index: "A" },
    { contest_id: "abc471", problem_id: "abc471_b", problem_index: "B" },
    // The same problem, run again in a later contest.
    { contest_id: "rerun", problem_id: "abc471_a", problem_index: "C" },
    { contest_id: "rerun", problem_id: "old_x", problem_index: "D" },
  ],
  "problem-models.json": {
    abc471_a: { difficulty: -320, is_experimental: false },
    abc471_b: { difficulty: 1500, is_experimental: true },
    // old_x deliberately has a model with no difficulty in it.
    old_x: { slope: -0.1, intercept: 4 },
  },
};

let submissionPages = [];
let requestLog = [];

function stubFetch() {
  requestLog = [];
  globalThis.chrome = {
    storage: { local: { async get() { return { "upsolve_tracker.atcoder_handle": "me" }; } } },
  };
  globalThis.fetch = async (url) => {
    requestLog.push(url);

    for (const [name, body] of Object.entries(RESOURCES)) {
      if (url.endsWith(`/resources/${name}`)) return jsonResponse(body);
    }
    if (url.includes("/user/submissions")) {
      const from = Number(new URL(url).searchParams.get("from_second"));
      const page = submissionPages.shift() ?? [];
      return jsonResponse(page.filter((row) => row.epoch_second >= from));
    }
    return { ok: false, status: 404, headers: { get: () => null } };
  };
}

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  async json() { return body; },
});

beforeEach(() => {
  clearResourceCache();
  setRequestSpacing(0);
  stubFetch();
});

test("a contest is built from contest-problem, so reruns are complete", async () => {
  // problems.json says "rerun" has no problems at all — every one of them
  // debuted elsewhere. Reading it instead would produce an empty contest.
  const contest = await fetchContestRecord({ contestId: "rerun", subtype: "OTHER" });
  assert.deepEqual(contest.problems.map((p) => p.index), ["C", "D"]);
  assert.deepEqual(contest.problems.map((p) => p.problemId), ["abc471_a", "old_x"]);
});

test("published difficulty is taken as-is, including negatives", async () => {
  const contest = await fetchContestRecord({ contestId: "abc471", subtype: "ABC" });
  const [a, b] = contest.problems;
  assert.equal(a.rating, -320, "a negative difficulty was clamped");
  assert.equal(a.ratingSource, "official");
  assert.equal(b.rating, 1500);
});

test("a low-confidence model is recorded as such, not passed off as measured", async () => {
  const contest = await fetchContestRecord({ contestId: "abc471", subtype: "ABC" });
  assert.equal(contest.problems[0].ratingConfidence, null);
  assert.equal(contest.problems[1].ratingConfidence, "experimental");
});

test("a model without a difficulty leaves the rating null, never a guess", async () => {
  const contest = await fetchContestRecord({ contestId: "rerun", subtype: "OTHER" });
  const reused = contest.problems.find((p) => p.problemId === "old_x");
  assert.equal(reused.rating, null);
  assert.equal(reused.ratingSource, null);
});

test("an unindexed contest fails loudly rather than storing an empty one", async () => {
  await assert.rejects(
    () => fetchContestRecord({ contestId: "abc999", subtype: "ABC" }),
    /doesn't list contest/,
  );
});

test("start time and name come from the contest list", async () => {
  const contest = await fetchContestRecord({ contestId: "abc471", subtype: "ABC" });
  assert.equal(contest.name, "AtCoder Beginner Contest 471");
  assert.equal(contest.startTimeSeconds, 1_755_000_000);
  assert.equal(contest.platform, "atcoder");
});

test("submission paging continues past a full page and dedupes the overlap", async () => {
  // A full page must not be treated as the end. The cursor moves to the newest
  // timestamp seen rather than past it, so the boundary row repeats and has to
  // be deduplicated by id.
  const full = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1, epoch_second: 1000 + i, problem_id: `p${i}`, result: i === 499 ? "AC" : "WA",
  }));
  const tail = [
    { id: 500, epoch_second: 1499, problem_id: "p499", result: "AC" },
    { id: 501, epoch_second: 1500, problem_id: "late", result: "AC" },
  ];
  submissionPages = [full, tail];

  const accepted = await getAcceptedProblemIds("me");
  assert.ok(accepted.has("p499"), "the boundary submission was lost");
  assert.ok(accepted.has("late"), "paging stopped at the first full page");
  assert.equal(accepted.size, 2);
});

test("paging terminates when a page brings nothing new", async () => {
  // Every row shares a timestamp, so the cursor cannot advance. Without the
  // no-progress check this loops until the page cap.
  const stuck = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1, epoch_second: 42, problem_id: `p${i}`, result: "AC",
  }));
  submissionPages = [stuck, stuck, stuck, stuck];

  const accepted = await getAcceptedProblemIds("me");
  assert.equal(accepted.size, 500);
  const pages = requestLog.filter((u) => u.includes("/user/submissions")).length;
  assert.ok(pages <= 3, `made ${pages} requests for a stuck cursor`);
});

test("only accepted submissions count", async () => {
  submissionPages = [[
    { id: 1, epoch_second: 1, problem_id: "solved", result: "AC" },
    { id: 2, epoch_second: 2, problem_id: "tried", result: "WA" },
    { id: 3, epoch_second: 3, problem_id: "tle", result: "TLE" },
  ]];
  const accepted = await getAcceptedProblemIds("me");
  assert.deepEqual([...accepted], ["solved"]);
});

test("solved keys are namespaced task ids, so a rerun clears too", async () => {
  submissionPages = [[{ id: 1, epoch_second: 1, problem_id: "abc471_a", result: "AC" }]];
  const keys = await fetchSolvedKeys({ handle: "me" }, []);
  assert.deepEqual([...keys], ["atcoder:abc471_a"]);
});

test("no handle means no request and no keys", async () => {
  const keys = await fetchSolvedKeys({ handle: undefined }, []);
  assert.equal(keys.size, 0);
  assert.equal(requestLog.length, 0);
});

test("a later refresh fills in a difficulty that wasn't published at add time", async () => {
  const contest = {
    id: "abc471",
    platform: "atcoder",
    startTimeSeconds: 1_755_000_000,
    problems: [
      { index: "A", problemId: "abc471_a", rating: null, ratingSource: null },
      { index: "B", problemId: "abc471_b", rating: 1500, ratingSource: "official" },
    ],
  };
  const resolved = await syncMetadata({}, [contest]);
  assert.equal(resolved, 1);
  assert.equal(contest.problems[0].rating, -320);
  assert.equal(contest.problems[0].ratingSource, "official");
});

test("a settled contest costs no requests on refresh", async () => {
  const contest = {
    id: "abc471", platform: "atcoder", startTimeSeconds: 1_755_000_000,
    problems: [{ index: "A", problemId: "abc471_a", rating: -320, ratingSource: "official" }],
  };
  await syncMetadata({}, [contest]);
  assert.equal(requestLog.length, 0);
});
