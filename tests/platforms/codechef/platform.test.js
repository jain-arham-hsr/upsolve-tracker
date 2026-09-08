/**
 * CodeChef's silent failure modes, all confirmed against the live API:
 * `problemsstats.solved` changes type between signed-out and signed-in, the
 * difficulty field carries two out-of-band sentinels (one of which collides
 * with the queue's own), and a parent contest returns an empty problem list
 * rather than an error.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { parseDashboard } from "../../../core/platforms/codechef/scraper.js";

// The bootstrap object lives in a `<script>`, so these now go through a real
// document the way production does, rather than being regexed off a string.
const extractSession = (html) =>
  parseDashboard(parseHTML(`<html><body>${html ?? ""}</body></html>`).document);
import { api } from "../../../core/platforms/codechef/api.js";
import { scraper } from "../../../core/platforms/codechef/scraper.js";
import { getPlatform } from "../../../core/platforms/registry.js";

// The platform is instantiated in registry.js, so this exercises the real
// assembled object rather than a module's raw exports.
const platform = getPlatform("codechef");
const fetchContestRecord = (...args) => platform.fetchContestRecord(...args);
const fetchSolvedKeys = (...args) => platform.fetchSolvedKeys(...args);
const syncMetadata = (...args) => platform.syncMetadata(...args);

const PROBLEMS = {
  IOI7: {
    code: "IOI7", name: "IOI Gold", successful_submissions: "24922",
    is_added_to_practice: true,
  },
  // No `is_added_to_practice` at all — must read as mirrored, not as missing.
  MODSUB: { code: "MODSUB", name: "Mod Subtract", successful_submissions: "1489" },
  // The MAXTHEMIN case: in the contest, never mirrored to /problems/.
  UPDQS: {
    code: "UPDQS", name: "Update Queries", successful_submissions: "647",
    is_added_to_practice: false,
  },
};

const DETAILS = {
  IOI7: { difficulty_rating: "182", user_tags: ["cakewalk", "raysh07_adm", "start252"] },
  // -1 is CodeChef's "not rated"; 9999 is the other sentinel, and it collides
  // with the queue's own sort-last value.
  MODSUB: { difficulty_rating: "-1", user_tags: [] },
  UPDQS: { difficulty_rating: "9999", user_tags: ["dynamic-programming", "START252"] },
};

let contests = {};
/** Per-test copy of DETAILS, for the same reason `contests` is cloned below. */
let details = {};
let requestLog = [];
/** Rows the practice listing answers with, and the count it advertises. */
let attempted = { rows: [], count: null };

function stub({ signedIn = true } = {}) {
  requestLog = [];
  globalThis.fetch = async (url) => {
    requestLog.push(url);

    if (url.endsWith("/dashboard")) {
      const user = signedIn
        ? `{"user":{"username":"tourist","rating":"1450","note":"has } brace"}}`
        : `{"user":{"username":null,"rating":null}}`;
      return textResponse(`<script>window.codeChefUserData = ${user};</script>`);
    }

    if (url.includes("/api/list/problems")) {
      const query = new URL(url).searchParams;
      const page = Number(query.get("page"));
      const limit = Number(query.get("limit"));
      const rows = attempted.rows.slice(page * limit, (page + 1) * limit);
      return jsonResponse({ count: attempted.count ?? attempted.rows.length, data: rows });
    }

    const problemMatch = url.match(/\/api\/contests\/([^/]+)\/problems\/([^/?]+)/);
    if (problemMatch) return jsonResponse(details[problemMatch[2]] ?? {});

    const contestMatch = url.match(/\/api\/contests\/([^/?]+)$/);
    if (contestMatch) {
      const body = contests[contestMatch[1]];
      if (!body) return { ok: false, status: 404 };
      return jsonResponse(body);
    }
    return { ok: false, status: 404 };
  };
}

// Both shapes carry `text()` and a `url`, because a real Response does. The
// stubs used to expose only the one method the caller happened to use, which
// quietly encoded *how* the client read the body — so moving that read broke
// eleven tests that were not about reading bodies at all.
const respond = (body, { status = 200, url = "https://www.codechef.com/x" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  async text() { return body; },
  async json() { return JSON.parse(body); },
});
const jsonResponse = (body) => respond(JSON.stringify(body));
const textResponse = (body) => respond(body);

/**
 * Deep, because tests flip `is_added_to_practice` on a payload entry to model
 * CodeChef mirroring a problem later. Sharing the PROBLEMS literal by reference
 * leaked that mutation into every test that ran afterwards.
 */
const clone = (value) => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  platform.reset();
  attempted = { rows: [], count: null };
  details = clone(DETAILS);
  contests = {
    START252D: {
      code: "START252D",
      name: "Starters 252 (Rated)",
      is_a_parent_contest: false,
      time: { start: 1_787_150_160 },
      problems: clone(PROBLEMS),
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
      time: { start: 1_787_150_160 }, problems: { IOI7: clone(PROBLEMS.IOI7) },
      problemsstats: { solved: [] },
    },
  };
  stub();
});

/**
 * fetchContestRecord answers with one of the statuses in
 * core/contest-status.js. Most tests here are about the record it builds, so
 * this unwraps a "ready" and throws otherwise — the shape contest-manager
 * gives the rest of the app. Status handling is asserted directly, below.
 */
const record = async (args) => {
  const result = await fetchContestRecord(args);
  if (result.status !== "ready") {
    throw Object.assign(new Error(result.reason), { contestStatus: result.status });
  }
  return result.contest;
};

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
  assert.equal(extractSession("nothing"), null);
  // Signed out: a real object, but no username.
  assert.equal(extractSession(`<script>window.codeChefUserData = {"user":{"username":null}};</script>`), null);
});

test("solved is read from an object, which is the shape that carries data", () => {
  // Signed out it is [], signed in it is {code: true}. Array methods would see
  // nothing on the second — the one that matters.
  return record({ contestId: "START252D", subtype: "STARTERS", session: { api, scraper } })
    .then((contest) => {
      const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));
      assert.equal(byCode.IOI7.solved, true);
      assert.equal(byCode.UPDQS.solved, false);
    });
});

test("partially solved stays in the queue — scoring subtasks isn't finishing", () => {
  return record({ contestId: "START252D", subtype: "STARTERS", session: { api, scraper } })
    .then((contest) => {
      const modsub = contest.problems.find((p) => p.index === "MODSUB");
      assert.equal(modsub.solved, false);
    });
});

test("both difficulty sentinels become null, never a rating", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
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
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));
  assert.deepEqual(byCode.IOI7.tags, ["cakewalk"]);
  assert.deepEqual(byCode.UPDQS.tags, ["dynamic-programming"]);
});

test("a parent contest resolves to the division matching your rating", async () => {
  // /START252 returns an empty problem list rather than an error, so without
  // this it would store as a contest with no problems.
  const contest = await record({
    contestId: "START252", subtype: "STARTERS", session: { api, scraper, rating: 1450 },
  });
  assert.equal(contest.id, "START252C");
  assert.equal(contest.problems.length, 1);
});

test("a resolved parent records the id the user navigated from", async () => {
  // Without this the add banner compares /START252 against a stored START252D
  // and offers to add an already-tracked contest.
  const viaParent = await record({
    contestId: "START252", subtype: "STARTERS", session: { api, scraper, rating: 1450 },
  });
  assert.equal(viaParent.id, "START252C");
  assert.equal(viaParent.sourceId, "START252");
});

test("a contest added directly carries no sourceId", async () => {
  const direct = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  assert.equal(direct.sourceId, undefined);
});

test("a parent contest with no known rating names the divisions instead of guessing", async () => {
  await assert.rejects(
    () => record({ contestId: "START252", subtype: "STARTERS", session: { api, scraper } }),
    /START252A, START252C/,
  );
});

test("signed out, solved status refuses rather than reporting nothing solved", async () => {
  await assert.rejects(
    () => fetchSolvedKeys({ handle: "me", signedIn: false }, [{ id: "START252D" }]),
    /Not signed in/,
  );
});

test("the wrong account signed in refuses before reading anything", async () => {
  await assert.rejects(
    () => fetchSolvedKeys(
      { handle: "me", signedIn: true, signedInAs: "someone_else" },
      [{ id: "START252D" }],
    ),
    /Signed in to CodeChef as someone_else/,
  );

  // The listing answers for whoever holds the cookie, so reading it under the
  // wrong account would write their solves onto this queue.
  assert.deepEqual(
    requestLog.filter((url) => url.includes("/api/list/problems")),
    [],
    "no solve history may be read once identity fails",
  );
});

const SESSION = { api, scraper, handle: "me", signedIn: true, signedInAs: "me" };

test("only an Accepted status counts as solved", async () => {
  // CodeChef's own map: 0 unattempted, 1 accepted, 2 partially correct,
  // 3 wrong answer. Anything but 1 leaves the problem in the queue — `solved`
  // is never cleared, so a wrong guess here hides a problem permanently.
  attempted.rows = [
    { code: "IOI7", status: 1 },
    { code: "MODSUB", status: 2 },
    { code: "UPDQS", status: 3 },
    { code: "NEVER", status: 0 },
  ];

  const keys = await fetchSolvedKeys(SESSION, []);
  assert.deepEqual([...keys], ["codechef:IOI7"]);
});

test("an unrecognised status is not treated as solved", async () => {
  // A value the site adds later must fail closed rather than clear the queue.
  attempted.rows = [{ code: "IOI7", status: 42 }, { code: "MODSUB", status: null }];
  assert.deepEqual([...await fetchSolvedKeys(SESSION, [])], []);
});

test("solved history is read per user, not per contest", async () => {
  // The whole point: an upsolve is invisible to any contest payload, so no
  // contest endpoint may be consulted for solved status any more.
  attempted.rows = [{ code: "IOI7", status: 1 }];
  await fetchSolvedKeys(SESSION, [{ id: "START252D" }, { id: "START252C" }]);

  const contestReads = requestLog.filter((url) => /\/api\/contests\/[^/?]+$/.test(url));
  assert.deepEqual(contestReads, [], "no per-contest read should remain");
});

test("paging stops once the advertised count is covered", async () => {
  attempted.rows = Array.from({ length: 250 }, (_, i) => ({ code: `P${i}`, status: 1 }));
  const keys = await fetchSolvedKeys(SESSION, []);

  assert.equal(keys.size, 250);
  const pages = requestLog.filter((url) => url.includes("/api/list/problems"));
  assert.equal(pages.length, 3, "250 rows at 100 per page is three requests");
});

test("a count that means the filter was ignored refuses to page the catalogue", async () => {
  // Signed out, `group=attempted` is ignored and the endpoint answers with the
  // whole catalogue. Paging that would be the crawl this client forbids.
  attempted.rows = [{ code: "IOI7", status: 1 }];
  attempted.count = 21_488;

  await assert.rejects(() => fetchSolvedKeys(SESSION, []), /ignored the filter/);
  const pages = requestLog.filter((url) => url.includes("/api/list/problems"));
  assert.equal(pages.length, 1, "it must stop on the first page, not keep going");
});

test("the listing is scoped to the signed-in account and includes unrated problems", async () => {
  attempted.rows = [{ code: "IOI7", status: 1 }];
  await fetchSolvedKeys(SESSION, []);

  const query = new URL(requestLog.find((u) => u.includes("/api/list/problems"))).searchParams;
  assert.equal(query.get("group"), "attempted", "unscoped would be a catalogue read");
  assert.equal(query.get("page"), "0", "the endpoint is zero-based");
  assert.equal(query.get("start_rating"), "-1", "0 would drop every unrated problem");
});

/**
 * Some old problems were never mirrored to CodeChef's practice archive, so once
 * the contest closes to submissions there is nowhere left to solve them. The
 * signal is `is_added_to_practice` on the contest payload — verified live
 * against START32C/MAXTHEMIN, which is the only one of its ten problems that
 * 404s at /problems/.
 */
test("a problem never added to practice is flagged, and no other problem is", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  const byCode = Object.fromEntries(contest.problems.map((p) => [p.index, p]));

  assert.equal(byCode.UPDQS.upsolvable, false);
  // Absent, not `true`. The key means "this is dead work" and is written only
  // when it is — every problem on Codeforces and AtCoder omits it.
  assert.equal("upsolvable" in byCode.IOI7, false);
  // The field missing from the payload must read as mirrored. Treating unknown
  // as unmirrored would empty the queue on any payload shape change.
  assert.equal("upsolvable" in byCode.MODSUB, false);
});

test("detecting it costs no extra request", async () => {
  requestLog = [];
  await record({ contestId: "START252D", subtype: "STARTERS", session: { api, scraper } });

  // One contest payload plus one detail per problem — the flag rides along on
  // the payload that was already being fetched.
  assert.equal(requestLog.filter((url) => /\/api\/contests\/[^/]+$/.test(url)).length, 1);
  assert.equal(requestLog.filter((url) => url.includes("/problems/")).length, 3);
});

test("a problem CodeChef later mirrors comes back to the queue", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  const updqs = contest.problems.find((p) => p.index === "UPDQS");
  assert.equal(updqs.upsolvable, false);

  // CodeChef adds it to practice.
  platform.reset();
  contests.START252D.problems.UPDQS.is_added_to_practice = true;

  const changed = await syncMetadata({ api, scraper }, [contest]);

  assert.equal(changed, 1);
  // Deleted rather than set true, so the stored shape stays consistent with
  // what buildProblem writes.
  assert.equal("upsolvable" in updqs, false);
});

test("the re-check runs every refresh, not on the weekly rating stamp", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  // Freshly stamped, so the weekly rating re-check is skipped entirely.
  contest.publishedDataCheckedAt = Date.now();

  platform.reset();
  contests.START252D.problems.UPDQS.is_added_to_practice = true;
  await syncMetadata({ api, scraper }, [contest]);

  assert.equal("upsolvable" in contest.problems.find((p) => p.index === "UPDQS"), false);
});

test("a contest with nothing flagged is never asked about", async () => {
  // The re-check exists to clear a flag, so it only looks at contests that have
  // one. Asking about every tracked contest on every refresh would be a request
  // each, forever, to find something that does not happen — CodeChef does not
  // pull problems back out of practice.
  const contest = await record({
    contestId: "START252C", subtype: "STARTERS", session: { api, scraper },
  });
  assert.deepEqual(contest.problems.filter((p) => p.upsolvable === false), []);

  platform.reset();
  requestLog = [];
  await syncMetadata({ api, scraper }, [contest]);
  assert.equal(requestLog.length, 0);
});

test("a flagged contest is re-checked until it clears, then stops costing anything", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  assert.equal(contest.problems.find((p) => p.index === "UPDQS").upsolvable, false);

  // Still unmirrored: asked again, and stays flagged.
  platform.reset();
  requestLog = [];
  await syncMetadata({ api, scraper }, [contest]);
  assert.equal(requestLog.length, 1);
  assert.equal(contest.problems.find((p) => p.index === "UPDQS").upsolvable, false);

  // CodeChef mirrors it: the flag clears...
  platform.reset();
  contests.START252D.problems.UPDQS.is_added_to_practice = true;
  await syncMetadata({ api, scraper }, [contest]);
  assert.equal("upsolvable" in contest.problems.find((p) => p.index === "UPDQS"), false);

  // ...and with nothing left flagged, the contest drops out of the pass.
  platform.reset();
  requestLog = [];
  await syncMetadata({ api, scraper }, [contest]);
  assert.equal(requestLog.length, 0, "a settled contest must cost nothing");
});

test("a failed re-check leaves the flag alone rather than clearing it", async () => {
  // The contest is not in the stub, so getContest throws. Guessing the problem
  // back into the queue on a network blip would undo the whole point.
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  platform.reset();
  delete contests.START252D;

  await syncMetadata({ api, scraper }, [contest]);

  assert.equal(contest.problems.find((p) => p.index === "UPDQS").upsolvable, false);
});

test("a problem missing from the payload keeps its flag rather than being guessed back", async () => {
  // Distinct from a failed request: the response arrives and simply does not
  // mention the problem. Treating that as "mirrored" would put a problem that
  // cannot be submitted back into the queue on a payload shape change.
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  platform.reset();
  delete contests.START252D.problems.UPDQS;

  await syncMetadata({ api, scraper }, [contest]);

  assert.equal(contest.problems.find((p) => p.index === "UPDQS").upsolvable, false);
});

/**
 * The other half of syncMetadata. CodeChef publishes difficulty promptly but
 * not always by the time a contest is added, so an unrated problem stores null,
 * renders "???" and is re-read later — at most weekly, since that pass costs a
 * request per still-unrated problem rather than one per contest.
 */
test("a difficulty published after the contest was added is filled in", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  const modsub = contest.problems.find((p) => p.index === "MODSUB");
  assert.equal(modsub.rating, null, "-1 is CodeChef's 'not rated'");

  // Rated since, and the contest has not been looked at for a fortnight.
  platform.reset();
  details.MODSUB = { difficulty_rating: "1500", user_tags: ["greedy", "start252"] };
  contest.publishedDataCheckedAt = Date.now() - 14 * 24 * 60 * 60 * 1000;

  await syncMetadata({ api, scraper }, [contest]);

  assert.equal(modsub.rating, 1500);
  assert.equal(modsub.ratingSource, "official");
  assert.deepEqual(modsub.tags, ["greedy"], "the contest code is still stripped");
});

test("the difficulty re-check is throttled to a week, unlike the practice one", async () => {
  const contest = await record({
    contestId: "START252D", subtype: "STARTERS", session: { api, scraper },
  });
  // Looked at today. The practice pass still runs — UPDQS is flagged — so this
  // pins that the two cadences really are independent rather than both firing.
  contest.publishedDataCheckedAt = Date.now();

  platform.reset();
  details.MODSUB = { difficulty_rating: "1500", user_tags: [] };
  requestLog = [];
  await syncMetadata({ api, scraper }, [contest]);

  assert.equal(contest.problems.find((p) => p.index === "MODSUB").rating, null);
  assert.equal(
    requestLog.filter((url) => url.includes("/problems/")).length,
    0,
    "no per-problem request: the weekly gate held",
  );
});

// ---------------------------------------------------------------------------
// Statuses: the answers that are not a contest.
// ---------------------------------------------------------------------------

const statusOf = (contestId = "START252D") =>
  fetchContestRecord({ contestId, subtype: "STARTERS", session: { api, scraper } });

test("a contest still running waits, and its problems are never fetched", async () => {
  // CodeChef reports its own clock beside the contest's end, so this asks *its*
  // time rather than ours. Nothing checked this before, and the payload lists
  // problems during the contest — so the add succeeded against in-contest data.
  contests.START252D.time = { start: 100, end: 200, current: 150 };
  stub();

  const result = await statusOf();
  assert.equal(result.status, "notEndedYet");
  assert.match(result.reason, /still running/);
  assert.equal(
    requestLog.filter((url) => url.includes("/problems/")).length,
    0,
    "a running contest must not cost one request per problem",
  );
});

test("a contest whose problems are not listed yet waits rather than failing", async () => {
  // Previously a bare throw, unflagged — the reason CodeChef never joined the
  // waiting mechanism at all, while AtCoder waits for exactly this.
  contests.START252D.time = { start: 100, end: 200, current: 300 };
  contests.START252D.problems = {};
  stub();

  const result = await statusOf();
  assert.equal(result.status, "notPublishedYet");
  assert.match(result.reason, /hasn't listed the problems/);
});

test("a failed problem request waits — it is not evidence of an unrated problem", async () => {
  // The conflation this removes. Swallowing the failure set rating to null,
  // which is indistinguishable from CodeChef answering "-1", so one timed-out
  // request showed "???" for a problem CodeChef *has* rated — and it stayed
  // wrong for up to a week.
  for (const httpStatus of [403, 500, 404]) {
    stub();
    const inner = globalThis.fetch;
    globalThis.fetch = async (url) =>
      url.includes("/problems/IOI7")
        ? respond("", { status: httpStatus })
        : inner(url);

    const result = await statusOf();
    assert.equal(result.status, "sourceUnreachable", `HTTP ${httpStatus}`);
  }
});

test("but CodeChef answering -1 still stores the contest, with ???", async () => {
  // The one path that may produce a "???", and the reason none of the others
  // may: here the site answered, and what it said was "unrated".
  stub();
  const contest = await record({
    contestId: "START252D",
    subtype: "STARTERS",
    session: { api, scraper },
  });

  const modsub = contest.problems.find((p) => p.index === "MODSUB");
  assert.equal(modsub.rating, null, "-1 means unrated, which renders ???");
  assert.equal(modsub.ratingSource, null);
});

test("a parent contest with no rating refuses outright rather than waiting", async () => {
  // It needs you to pick a division, so retrying silently would never resolve.
  // `unavailable` carries its reason precisely so an actionable refusal needs
  // no category of its own.
  stub();
  const result = await fetchContestRecord({
    contestId: "START252",
    subtype: "STARTERS",
    session: { api, scraper },
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /Open the division/);
});

