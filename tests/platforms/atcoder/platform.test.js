/**
 * The AtCoder adapter, now that it reads AtCoder rather than a mirror of it.
 *
 * This file was rewritten wholesale. Every earlier case stubbed AtCoder
 * Problems' static resources — `contest-problem.json`, `problem-models.json`,
 * a paged submissions feed — and none of those is fetched any more. What
 * replaced them is three routes on atcoder.jp, so the stub serves pages.
 *
 * The fit itself is not tested here: `tests/rating-models.test.js` pins it
 * against numbers produced by running AtCoder Problems' own Python verbatim,
 * which is a sharper check than anything a hand-built fixture could make.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { shouldWait } from "../../../core/contest-status.js";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { getAdapter } = await import("../../../core/platforms/platforms.js");
const { sources } = await import("../../../core/platforms/atcoder/sources.js");
const platform = getAdapter("atcoder");
const fetchContestRecord = (...args) => platform.fetchContestRecord(...args);
const fetchSolvedKeys = (...args) => platform.fetchSolvedKeys(...args);
const syncMetadata = (...args) => platform.syncMetadata(...args);

const SESSION = { handle: "tourist", sources };

const tasksPage = (rows) => `<html><body>
  <a class="contest-title" href="/contests/abc432">Example Contest 432</a>
  <time class='fixtime fixtime-full'>2025-11-15 21:00:00+0900</time>
  <time class='fixtime fixtime-full'>2025-11-15 22:40:00+0900</time>
  <table><tbody>${rows}</tbody></table>
</body></html>`;

const taskRow = (index, id, name) =>
  `<tr><td><a href="/contests/abc432/tasks/${id}">${index}</a></td>` +
  `<td><a href="/contests/abc432/tasks/${id}">${name}</a></td>` +
  `<td>2 sec</td><td>1024 MiB</td></tr>`;

const submissionsPage = (rows, pages = 1) => `<html><body>
  <table><tbody>${rows}</tbody></table>
  ${pages > 1 ? `<ul class="pagination"><li><a href="?page=${pages}">${pages}</a></li></ul>` : ""}
</body></html>`;

const submissionRow = (taskId, verdict) =>
  `<tr><td>2026-01-01</td><td><a href="/contests/abc432/tasks/${taskId}">X</a></td>` +
  `<td>tourist</td><td>C++</td><td><span>${verdict}</span></td></tr>`;

/**
 * A standings payload the estimator can actually fit, so a test about the
 * *record* is not accidentally a test about being signed out. Forty usable rows
 * is the floor the model wants; half of them solving gives a fit in range.
 */
const standingsJson = (taskIds, rows = 60, solvers = 30) =>
  JSON.stringify({
    TaskInfo: taskIds.map((id) => ({ TaskScreenName: id })),
    StandingsData: Array.from({ length: rows }, (_, i) => ({
      OldRating: 1200 + i,
      Competitions: 5,
      IsRated: true,
      TotalResult: { Count: 1 },
      TaskResults: Object.fromEntries(
        taskIds.map((id) => [id, i < solvers ? { Score: 100, Status: 1 } : { Score: 0, Status: 0 }]),
      ),
    })),
  });

let routes;
let requested;

function respond(url) {
  requested.push(url);
  for (const [pattern, body] of routes) {
    if (url.includes(pattern)) {
      if (body === "LOGIN") {
        return { ok: true, status: 200, url: "https://atcoder.jp/login", text: async () => "", json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => body,
        json: async () => body,
      };
    }
  }
  return { ok: false, status: 404, url, text: async () => "", json: async () => ({}) };
}

beforeEach(() => {
  routes = [];
  requested = [];
  platform.reset(0);
  globalThis.fetch = async (url) => respond(String(url));
});

test("a contest is built from its own tasks page, ids and all", async () => {
  routes = [
    ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha") + taskRow("B", "abc432_b", "Beta"))],
    ["/standings/json", standingsJson(["abc432_a", "abc432_b"])],
  ];

  const { status, contest } = await fetchContestRecord({
    contestId: "abc432",
    subtype: "ABC",
    session: SESSION,
  });

  assert.equal(status, "ready");
  assert.equal(contest.name, "Example Contest 432");
  assert.equal(contest.platform, "atcoder");
  assert.equal(contest.startTimeSeconds, 1763208000);
  assert.deepEqual(contest.problems.map((p) => p.problemId), ["abc432_a", "abc432_b"]);
});

test("an unreadable task list waits rather than storing an empty contest", async () => {
  // Before a contest ends AtCoder does not list its problems. Storing a contest
  // with none would look like a round that had none.
  routes = [["/contests/abc432/tasks", "<html><body><p>nothing</p></body></html>"]];

  const result = await fetchContestRecord({
    contestId: "abc432",
    subtype: "ABC",
    session: SESSION,
  });
  assert.equal(result.status, "notPublishedYet");
});

test("signed out, the contest waits rather than storing a queue of ???", async () => {
  // This used to assert the opposite — that the contest stored with every
  // problem null, rendering "???" until some later refresh happened to run with
  // a session. That looked identical to "AtCoder cannot rate these", told the
  // user nothing, and gave no hint that a tab would fix it.
  //
  // Failing to *read* the standings is not a statement about difficulty, so it
  // answers `sourceUnreachable` and retries — the same treatment every other
  // "couldn't ask" case gets.
  routes = [
    ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha"))],
    ["/standings/json", "LOGIN"],
  ];

  const result = await fetchContestRecord({
    contestId: "abc432",
    subtype: "ABC",
    session: SESSION,
  });

  assert.equal(result.status, "sourceUnreachable");
  // "returns a status" and "actually retries" are different claims, so the
  // second is asserted rather than assumed.
  assert.equal(shouldWait(result.status), true);
  assert.match(result.reason, /signed in/, "the message must say a tab would fix it");
  assert.equal(result.contest, undefined, "nothing is stored");
});

test("solved keys are namespaced task ids, so a rerun clears too", async () => {
  routes = [["/submissions", submissionsPage(submissionRow("abc432_c", "AC"))]];

  const keys = await fetchSolvedKeys(SESSION, [{ id: "abc432" }]);
  assert.deepEqual([...keys], ["atcoder:abc432_c"]);
});

test("only accepted submissions count, even though the request filters for them", async () => {
  // The filter is an optimisation, not a guarantee: if AtCoder renamed the
  // parameter the page would return everything, and `solved` is sticky.
  routes = [
    ["/submissions", submissionsPage(submissionRow("abc432_a", "AC") + submissionRow("abc432_b", "WA"))],
  ];

  const keys = await fetchSolvedKeys(SESSION, [{ id: "abc432" }]);
  assert.deepEqual([...keys], ["atcoder:abc432_a"]);
});

test("every tracked contest is asked, because AtCoder has no per-user list", async () => {
  routes = [["/submissions", submissionsPage(submissionRow("abc432_a", "AC"))]];

  await fetchSolvedKeys(SESSION, [{ id: "abc460" }, { id: "abc461" }]);
  assert.ok(requested.some((u) => u.includes("/contests/abc460/submissions")));
  assert.ok(requested.some((u) => u.includes("/contests/abc461/submissions")));
});

test("signed out fails loudly instead of reporting nothing solved", async () => {
  // The CodeChef trap: an empty answer and a login wall look identical, and
  // because `solved` is never cleared a silent empty read strands the queue.
  routes = [["/submissions", "LOGIN"]];

  await assert.rejects(
    () => fetchSolvedKeys(SESSION, [{ id: "abc432" }]),
    /not signed in/i,
  );
});

test("no handle means no request and no keys", async () => {
  const keys = await fetchSolvedKeys({ handle: null, sources }, [{ id: "abc432" }]);
  assert.equal(keys.size, 0);
  assert.deepEqual(requested, []);
});

test("a settled contest costs no requests on refresh", async () => {
  const rated = { id: "abc432", problems: [{ problemId: "abc432_a", rating: 654 }] };
  assert.equal(await syncMetadata(SESSION, [rated]), 0);
  assert.deepEqual(requested, []);
});

test("an unrated contest is retried, but only one per refresh", async () => {
  // A standings payload is around a megabyte; a contest that can never be rated
  // must not levy that cost on every refresh forever.
  routes = [["/standings/json", "LOGIN"]];

  const unrated = () => ({ id: "abc432", problems: [{ problemId: "abc432_a", rating: null }] });
  await syncMetadata(SESSION, [unrated(), unrated(), unrated()]);

  const standingsCalls = requested.filter((u) => u.includes("/standings/json"));
  assert.equal(standingsCalls.length, 1);
});

test("the one retry per refresh rotates, so nothing starves behind it", async () => {
  // The cap is safe only if the slot moves. This used to slice the filtered
  // array in stored order, so the first unrated contest was retried on every
  // refresh and the rest were never tried at all — and the case the cap exists
  // for, a contest too old for AtCoder to hold a usable field, is precisely a
  // contest that sits at the front forever.
  routes = [["/standings/json", "LOGIN"]]; // never resolves anything

  // Distinct stamps, because that is what real records have — contests are
  // added minutes or days apart, and a refresh takes network time, so the stamp
  // written after an attempt is always strictly later than the others. Giving
  // all three the same millisecond would make the sort stable and hide the very
  // thing this test is for.
  const stuck = (id, checkedAt) => ({
    id,
    problems: [{ problemId: `${id}_a`, rating: null }],
    publishedDataCheckedAt: checkedAt,
  });
  const contests = [stuck("abc001", 1), stuck("abc002", 2), stuck("abc003", 3)];

  for (let refresh = 0; refresh < 3; refresh++) {
    await syncMetadata(SESSION, contests);
  }

  const asked = requested
    .filter((url) => url.includes("/standings/json"))
    .map((url) => url.match(/contests\/(\w+)\//)[1]);

  assert.equal(asked.length, 3, "one contest per refresh, three refreshes");
  assert.deepEqual(
    [...new Set(asked)].sort(),
    ["abc001", "abc002", "abc003"],
    `every contest should get a turn, but only ${[...new Set(asked)].join(", ")} did`,
  );
});

test("a retry is stamped even when it resolves nothing", async () => {
  // What makes the rotation move. `fill` swallows its own failures, so a
  // contest that can never be rated looks exactly like one that simply has not
  // been asked — unless the attempt itself is recorded.
  routes = [["/standings/json", "LOGIN"]];

  const contest = {
    id: "abc432",
    problems: [{ problemId: "abc432_a", rating: null }],
    publishedDataCheckedAt: 0,
  };
  await syncMetadata(SESSION, [contest]);

  assert.equal(contest.problems[0].rating, null, "the fixture must not resolve");
  assert.ok(
    contest.publishedDataCheckedAt > 0,
    "an unstamped failure would monopolise the single retry slot forever",
  );
});

test("a contest the old policy would have refused entirely still stores", async () => {
  // Ten rows, nobody solving: under the old forty-row floor *and* the
  // zero-solve refusal, so every task came back null and the queue showed
  // "???" for the whole contest. With canEstimate true that would now be a hard
  // refusal instead — so the estimator has to answer, and this is the test that
  // says it does.
  routes = [
    ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha"))],
    ["/standings/json", standingsJson(["abc432_a"], 10, 0)],
  ];

  const { status, contest } = await fetchContestRecord({
    contestId: "abc432",
    subtype: "ABC",
    session: SESSION,
  });

  assert.equal(status, "ready", "a small, nobody-solved contest must still be addable");
  assert.equal(typeof contest.problems[0].rating, "number");
  assert.equal(contest.problems[0].ratingSource, "estimated");
});

test("nothing AtCoder stores carries a null rating", async () => {
  // The property canEstimate now enforces, asserted over the record rather than
  // over the estimator: whatever the field looks like, every stored problem
  // leaves with a number.
  for (const [rows, solvers] of [[60, 30], [60, 0], [60, 60], [8, 3]]) {
    routes = [
      ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha") + taskRow("B", "abc432_b", "Beta"))],
      ["/standings/json", standingsJson(["abc432_a", "abc432_b"], rows, solvers)],
    ];

    const { status, contest } = await fetchContestRecord({
      contestId: "abc432",
      subtype: "ABC",
      session: SESSION,
    });

    assert.equal(status, "ready", `${rows} rows / ${solvers} solvers should store`);
    assert.deepEqual(
      contest.problems.filter((p) => p.rating === null),
      [],
      `${rows} rows / ${solvers} solvers left a null rating`,
    );
  }
});
