/**
 * The AtCoder difficulty port: the row selection, not just the fit.
 *
 * `tests/rating-models.test.js` pins the *models* against AtCoder Problems'
 * Python. This pins everything around them — which filter applies to which
 * task, what counts as an accepted submission, and when the estimator refuses.
 * That layer had no coverage at all for a while, and it is the part most likely
 * to be quietly wrong: every filter below changes the answer, and a wrong one
 * yields a plausible rating rather than a failure.
 *
 * `fixtures/atcoder-standings.json` holds whole standings payloads with the
 * difficulties that `estimator/main.py` produces for them, computed by running
 * that Python verbatim. So a disagreement here is a porting bug.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { estimateContest, inverseAdjustRating } from "../core/platforms/atcoder/estimator.js";

const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/atcoder-standings.json", import.meta.url), "utf8"),
);

/** A field where everyone is a settled, rated competitor unless said otherwise. */
function standings(taskIds, entrants) {
  return {
    TaskInfo: taskIds.map((TaskScreenName) => ({ TaskScreenName })),
    StandingsData: entrants.map((e) => ({
      IsRated: e.isRated ?? true,
      OldRating: e.rating ?? 1200,
      Competitions: e.previousContests ?? 10,
      TotalResult: { Count: e.submissions ?? 3 },
      TaskResults: e.results ?? {},
    })),
  };
}

/** `n` entrants, the first `solvers` of whom solved `taskId` outright. */
const field = (taskId, n, solvers, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    rating: 800 + i * 12,
    ...extra,
    results: i < solvers ? { [taskId]: { Score: 100, Status: 1 } } : {},
  }));

test("the whole path reproduces AtCoder Problems' own difficulties", () => {
  const mismatches = [];
  for (const [i, c] of cases.entries()) {
    const got = estimateContest(c.standings);
    const keys = new Set([...Object.keys(c.expected), ...got.keys()]);
    for (const key of keys) {
      const ours = got.has(key) ? got.get(key) : "refused";
      const theirs = key in c.expected ? c.expected[key] : "refused";
      if (ours !== theirs) mismatches.push(`case ${i} ${key}: ${ours} vs ${theirs}`);
    }
  }
  assert.deepEqual(mismatches, [], "a difference here is a porting bug");
});

test("the fixture actually exercises a refusal, or it proves less than it looks", () => {
  const refused = cases.filter((c) => Object.keys(c.expected).length === 0);
  assert.ok(refused.length >= 1, "no case in the fixture refuses to estimate");
});

test("a task nobody scored on is refused, not rated at the ceiling", () => {
  const result = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 0)));
  assert.equal(result.has("abc432_c"), false);
});

test("a task everyone solved is refused — no difficulty explains it", () => {
  const result = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 60)));
  assert.equal(result.has("abc432_c"), false);
});

test("a field under forty usable rows is refused", () => {
  const just_under = estimateContest(standings(["abc432_c"], field("abc432_c", 39, 20)));
  const just_over = estimateContest(standings(["abc432_c"], field("abc432_c", 41, 20)));
  assert.equal(just_under.has("abc432_c"), false);
  assert.equal(just_over.has("abc432_c"), true);
});

test("a partial score is not a solve", () => {
  // AtCoder scores some problems by subtask. Scoring half of one is not
  // finishing it, and counting it would make the problem look easier.
  const entrants = field("abc432_c", 60, 30);
  for (let i = 30; i < 45; i++) entrants[i].results = { abc432_c: { Score: 50, Status: 0 } };
  const partial = estimateContest(standings(["abc432_c"], entrants)).get("abc432_c");
  const without = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 30))).get("abc432_c");
  assert.equal(partial, without, "partial scorers must not shift the fit");
});

test("a zero score is not a solve however the status reads", () => {
  const entrants = field("abc432_c", 60, 30);
  for (let i = 30; i < 45; i++) entrants[i].results = { abc432_c: { Score: 0, Status: 1 } };
  const got = estimateContest(standings(["abc432_c"], entrants)).get("abc432_c");
  const clean = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 30))).get("abc432_c");
  assert.equal(got, clean);
});

test("entrants who never submitted anything are excluded", () => {
  // They entered and walked away, so their non-solve says nothing about
  // difficulty. Including them would make every problem look harder.
  const withGhosts = field("abc432_c", 60, 30).concat(
    field("abc432_c", 40, 0, { submissions: 0 }),
  );
  const got = estimateContest(standings(["abc432_c"], withGhosts)).get("abc432_c");
  const clean = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 30))).get("abc432_c");
  assert.equal(got, clean);
});

test("first-timers are excluded — they have no rating to fit against", () => {
  const withNewcomers = field("abc432_c", 60, 30).concat(
    field("abc432_c", 40, 0, { rating: 0, previousContests: 0 }),
  );
  const got = estimateContest(standings(["abc432_c"], withNewcomers)).get("abc432_c");
  const clean = estimateContest(standings(["abc432_c"], field("abc432_c", 60, 30))).get("abc432_c");
  assert.equal(got, clean);
});

test("ABC's A and B from abc042 on drop unrated entrants; earlier rounds do not", () => {
  // Strong contestants skip these outright, so their non-solves are not
  // evidence. The cutoff is a property of the *task id*, so this also proves the
  // branch is keyed on the id rather than the displayed index.
  const entrants = field("x", 60, 30).concat(field("x", 30, 0, { isRated: false }));
  const forTask = (id) =>
    estimateContest(
      standings([id], entrants.map((e) => ({
        ...e,
        results: Object.keys(e.results).length ? { [id]: { Score: 100, Status: 1 } } : {},
      }))),
    ).get(id);

  // abc432_a takes the branch and ignores the unrated block; abc041_a does not.
  assert.notEqual(forTask("abc432_a"), forTask("abc041_a"));
  // abc432_c is not an A or B, so it behaves like the pre-42 round.
  assert.equal(forTask("abc432_c"), forTask("abc041_a"));
});

test("AGC's first problem keeps non-submitters and fits the non-attempt rate", () => {
  // The opposite adjustment to ABC-A/B: here the absences are the signal, so
  // they stay in and are modelled explicitly.
  const entrants = field("t", 60, 30).concat(field("t", 30, 0, { submissions: 0 }));
  const forTask = (id) =>
    estimateContest(
      standings([id], entrants.map((e) => ({
        ...e,
        results: Object.keys(e.results).length ? { [id]: { Score: 100, Status: 1 } } : {},
      }))),
    ).get(id);

  assert.notEqual(forTask("agc070_a"), forTask("agc070_b"));
});

test("the newcomer rating discount is reversed before fitting", () => {
  // Pinned against values from the source's `inverse_adjust_rating`. Fitting the
  // *displayed* rating would measure AtCoder's discount rather than ability.
  // A single-contest account is discounted by a full 1200; a settled one by
  // essentially nothing, which is what the correction converges to.
  assert.ok(Math.abs(inverseAdjustRating(1200, 1) - 2400.0) < 1e-9);
  assert.ok(Math.abs(inverseAdjustRating(1200, 100) - 1200.009489449524) < 1e-9);
  assert.ok(Math.abs(inverseAdjustRating(200, 10) - 279.57313061838676) < 1e-9);
  assert.ok(Math.abs(inverseAdjustRating(400, 10) - 556.8320028423649) < 1e-9);
  // Below 400 the discount is logarithmic, not linear.
  assert.ok(inverseAdjustRating(200, 10) < inverseAdjustRating(400, 10));
  assert.ok(Number.isNaN(inverseAdjustRating(0, 5)));
});
