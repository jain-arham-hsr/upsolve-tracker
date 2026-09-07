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

const { GymSources } = await import("../core/platforms/codeforces-gyms/sources.js");

const summariseSubmissions = (rows) => GymSources.summariseSubmissions(rows);
/** A real source with the one API method stubbed, the way every Codeforces test injects. */
const fetchContestSubmissions = (service, contestId) =>
  Object.assign(new GymSources("k", "s"), service).contestSubmissions(contestId);

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/gym-standings-hidden.json", import.meta.url)),
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
    getContestStatus: async (contestId, { from, count }) => {
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
    getContestStatus: async (contestId, { count }) =>
      Array.from({ length: count }, (_, i) => ({ id: i })),
  };
  await assert.rejects(
    () => fetchContestSubmissions(service, 1),
    /too many to rebuild/,
  );
});
