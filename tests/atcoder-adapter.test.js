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
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { getAdapter } = await import("../core/platforms/adapters.js");
const { resetHttpState } = await import("../core/platforms/atcoder/http.js");
const { fetchContestRecord, fetchSolvedKeys, syncMetadata } = getAdapter("atcoder");

const SESSION = { handle: "tourist" };

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
  resetHttpState(0);
  globalThis.fetch = async (url) => respond(String(url));
});

test("a contest is built from its own tasks page, ids and all", async () => {
  routes = [
    ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha") + taskRow("B", "abc432_b", "Beta"))],
    ["/standings/json", "LOGIN"],
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

test("difficulty that cannot be fitted stays null, never a guess", async () => {
  // Signed out, standings are unreachable — the contest must still be addable,
  // with its problems rendering "???" until a later refresh can rate them.
  routes = [
    ["/contests/abc432/tasks", tasksPage(taskRow("A", "abc432_a", "Alpha"))],
    ["/standings/json", "LOGIN"],
  ];

  const { status, contest } = await fetchContestRecord({
    contestId: "abc432",
    subtype: "ABC",
    session: SESSION,
  });

  assert.equal(status, "ready", "a signed-out user must still be able to add a contest");
  assert.equal(contest.problems[0].rating, null);
  assert.equal(contest.problems[0].ratingSource, null);
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
  const keys = await fetchSolvedKeys({ handle: null }, [{ id: "abc432" }]);
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
