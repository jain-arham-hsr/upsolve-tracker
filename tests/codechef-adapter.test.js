/**
 * CodeChef's silent failure modes, all confirmed against the live API:
 * `problemsstats.solved` changes type between signed-out and signed-in, the
 * difficulty field carries two out-of-band sentinels (one of which collides
 * with the queue's own), and a parent contest returns an empty problem list
 * rather than an error.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { extractSession, extractUserData } from "../core/platforms/codechef/page-data.js";
import { resetApiState } from "../core/platforms/codechef/api.js";
import {
  fetchContestRecord,
  fetchSolvedKeys,
} from "../core/platforms/codechef/adapter.js";

const PROBLEMS = {
  IOI7: { code: "IOI7", name: "IOI Gold", successful_submissions: "24922" },
  MODSUB: { code: "MODSUB", name: "Mod Subtract", successful_submissions: "1489" },
  UPDQS: { code: "UPDQS", name: "Update Queries", successful_submissions: "647" },
};

const DETAILS = {
  IOI7: { difficulty_rating: "182", user_tags: ["cakewalk", "raysh07_adm", "start252"] },
  // -1 is CodeChef's "not rated"; 9999 is the other sentinel, and it collides
  // with the queue's own sort-last value.
  MODSUB: { difficulty_rating: "-1", user_tags: [] },
  UPDQS: { difficulty_rating: "9999", user_tags: ["dynamic-programming", "START252"] },
};

let contests = {};
let requestLog = [];

function stub({ signedIn = true } = {}) {
  requestLog = [];
  globalThis.fetch = async (url) => {
    requestLog.push(url);

    if (url.endsWith("/dashboard")) {
      const user = signedIn
        ? `{"user":{"username":"jain_arham_hsr","rating":"1450","note":"has } brace"}}`
        : `{"user":{"username":null,"rating":null}}`;
      return textResponse(`<script>window.codeChefUserData = ${user};</script>`);
    }

    const problemMatch = url.match(/\/api\/contests\/([^/]+)\/problems\/([^/?]+)/);
    if (problemMatch) return jsonResponse(DETAILS[problemMatch[2]] ?? {});

    const contestMatch = url.match(/\/api\/contests\/([^/?]+)$/);
    if (contestMatch) {
      const body = contests[contestMatch[1]];
      if (!body) return { ok: false, status: 404 };
      return jsonResponse(body);
    }
    return { ok: false, status: 404 };
  };
}

const jsonResponse = (body) => ({ ok: true, status: 200, async json() { return body; } });
const textResponse = (body) => ({ ok: true, status: 200, async text() { return body; } });

beforeEach(() => {
  resetApiState();
  contests = {
    START252D: {
      code: "START252D",
      name: "Starters 252 (Rated)",
      is_a_parent_contest: false,
      time: { start: 1_787_150_160 },
      problems: PROBLEMS,
      // Signed in, this is an object keyed by code — not an array.
      problemsstats: { solved: { IOI7: true }, partially_solved: { MODSUB: true }, attempted: {} },
    },
    START252: {
      code: "START252",
      name: "Starters 252",
      is_a_parent_contest: true,
      problems: {},
      child_contests: {
        div_1: { contest_code: "START252A", div: { name: "Division 1", min_rating: 2000, max_rating: 50000 } },
        div_3: { contest_code: "START252C", div: { name: "Division 3", min_rating: 1400, max_rating: 1599 } },
      },
    },
    START252C: {
      code: "START252C", name: "Starters 252 (Div 3)", is_a_parent_contest: false,
      time: { start: 1_787_150_160 }, problems: { IOI7: PROBLEMS.IOI7 },
      problemsstats: { solved: [] },
    },
  };
  stub();
});

test("the bootstrap object is sliced on balanced braces, not a lazy regex", () => {
  // The real payload nests objects and contains braces inside strings.
  const session = extractSession(
    `<script>window.codeChefUserData = {"user":{"username":"me","rating":"1450","x":"a } b"}};</script>`,
  );
  assert.deepEqual(session, { username: "me", rating: 1450 });
});

test("a changed page shape returns null rather than a plausible session", () => {
  assert.equal(extractSession("<html>no bootstrap here</html>"), null);
  assert.equal(extractSession(`<script>window.codeChefUserData = {broken`), null);
  assert.equal(extractSession(null), null);
  assert.equal(extractUserData("nothing"), null);
  // Signed out: a real object, but no username.
  assert.equal(extractSession(`<script>window.codeChefUserData = {"user":{"username":null}};</script>`), null);
});

test("solved is read from an object, which is the shape that carries data", () => {
  // Signed out it is [], signed in it is {code: true}. Array methods would see
  // nothing on the second — the one that matters.
  return fetchContestRecord({ contestId: "START252D", subtype: "STARTERS", session: {} })
    .then((contest) => {
      const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));
      assert.equal(byCode.IOI7.solved, true);
      assert.equal(byCode.UPDQS.solved, false);
    });
});

test("partially solved stays in the queue — scoring subtasks isn't finishing", () => {
  return fetchContestRecord({ contestId: "START252D", subtype: "STARTERS", session: {} })
    .then((contest) => {
      const modsub = contest.problems.find((p) => p.index === "MODSUB");
      assert.equal(modsub.solved, false);
    });
});

test("both difficulty sentinels become null, never a rating", async () => {
  const contest = await fetchContestRecord({
    contestId: "START252D", subtype: "STARTERS", session: {},
  });
  const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));

  assert.equal(byCode.IOI7.rating, 182);
  assert.equal(byCode.MODSUB.rating, null, "-1 was read as a rating");
  assert.equal(byCode.UPDQS.rating, null, "9999 was read as a rating");
  // 9999 is the queue's own sort-last value, so passing it through would look
  // like a legitimate, very hard problem rather than an unrated one.
  assert.equal(byCode.UPDQS.ratingSource, null);
});

test("contest-code and setter-handle noise is stripped from tags", async () => {
  const contest = await fetchContestRecord({
    contestId: "START252D", subtype: "STARTERS", session: {},
  });
  const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));
  assert.deepEqual(byCode.IOI7.tags, ["cakewalk"]);
  assert.deepEqual(byCode.UPDQS.tags, ["dynamic-programming"]);
});

test("a parent contest resolves to the division matching your rating", async () => {
  // /START252 returns an empty problem list rather than an error, so without
  // this it would store as a contest with no problems.
  const contest = await fetchContestRecord({
    contestId: "START252", subtype: "STARTERS", session: { rating: 1450 },
  });
  assert.equal(contest.id, "START252C");
  assert.equal(contest.problems.length, 1);
});

test("a resolved parent records the id the user navigated from", async () => {
  // Without this the add banner compares /START252 against a stored START252D
  // and offers to add an already-tracked contest.
  const viaParent = await fetchContestRecord({
    contestId: "START252", subtype: "STARTERS", session: { rating: 1450 },
  });
  assert.equal(viaParent.id, "START252C");
  assert.equal(viaParent.sourceId, "START252");
});

test("a contest added directly carries no sourceId", async () => {
  const direct = await fetchContestRecord({
    contestId: "START252D", subtype: "STARTERS", session: {},
  });
  assert.equal(direct.sourceId, undefined);
});

test("a parent contest with no known rating names the divisions instead of guessing", async () => {
  await assert.rejects(
    () => fetchContestRecord({ contestId: "START252", subtype: "STARTERS", session: {} }),
    /START252A, START252C/,
  );
});

test("signed out, solved status refuses rather than reporting nothing solved", async () => {
  stub({ signedIn: false });
  const { createSession } = await import("../core/platforms/codechef/adapter.js");
  const session = await createSession();
  assert.equal(session.signedIn, false);

  await assert.rejects(
    () => fetchSolvedKeys(session, [{ id: "START252D" }]),
    /Not signed in/,
  );
});

test("solved keys are gathered per contest, since there is no per-user endpoint", async () => {
  const keys = await fetchSolvedKeys({ signedIn: true }, [{ id: "START252D" }]);
  assert.deepEqual([...keys], ["codechef:IOI7"]);
});
