/**
 * Integration cover for the scraping path: fetch -> parse -> shape, with the
 * HTTP client stubbed so no network is touched.
 *
 * The unit tests in standings-dom.test.js check parsing in isolation; these
 * check the arithmetic layered on top, which is where a mistake would quietly
 * mis-size the field and skew every rating in a contest.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { CodeforcesHttp } = await import("../core/platforms/codeforces/http.js");
const { scrapeContestProblems, sampleParticipantHandles } = await import(
  "../core/platforms/codeforces/scraping.js"
);

const PER_PAGE = 50;

/**
 * Serves a fake contest of `total` competitors, 50 to a page.
 * @param {object} [opts]
 * @param {boolean} [opts.totalsRow] - Include the "Accepted" row.
 * @param {number} [opts.claimLastPage] - Advertise a last page that isn't.
 */
function serveContest(total, opts = {}) {
  const { totalsRow = true, claimLastPage = null } = opts;
  const lastPage = Math.ceil(total / PER_PAGE);
  const requested = [];

  CodeforcesHttp.get = async (url) => {
    const page = Number(url.match(/page\/(\d+)/)?.[1] ?? 1);
    requested.push(page);

    const start = (page - 1) * PER_PAGE;
    const rows = Math.max(0, Math.min(PER_PAGE, total - start));
    const people = Array.from(
      { length: rows },
      (_, i) =>
        `<tr><td>${start + i + 1}</td><td><a href="/profile/u${start + i}">u${start + i}</a></td><td>+</td><td>+</td></tr>`,
    ).join("");

    // Pagination advertises the next page and the last one, as CF does.
    const advertised = claimLastPage ?? lastPage;
    const links = [page + 1, advertised]
      .filter((p) => p <= lastPage)
      .map((p) => `<a href="/contest/1/standings/page/${p}">${p}</a>`)
      .join("");

    return `<html><body>
      <div class="contest-name"><a>Test Round</a></div>
      <table class="standings">
        <tr><th>#</th><th>Who</th>
          <th><a href="/contest/1/problem/A" title="A - Alpha">A</a></th>
          <th><a href="/contest/1/problem/B" title="B - Beta">B</a></th></tr>
        ${people}
        ${totalsRow ? '<tr><td colspan="2">Accepted</td><td>3120<br/>x</td><td>870</td></tr>' : ""}
      </table>
      <div class="pagination">${links}</div>
    </body></html>`;
  };

  return requested;
}

const sampledCount = (result) =>
  result.groups.reduce((n, group) => n + group.handles.length, 0);
const represented = (result) =>
  result.groups.reduce((n, group) => n + group.handles.length * group.scale, 0);

test("scrapes problems and solve counts off a standings page", async () => {
  serveContest(500);
  const { contestName, problems, solveCountsRead } = await scrapeContestProblems(
    "contest",
    "1",
  );

  assert.equal(contestName, "Test Round");
  assert.equal(solveCountsRead, true);
  assert.deepEqual(
    problems.map((p) => [p.index, p.officialSolves]),
    [
      ["A", 3120],
      ["B", 870],
    ],
  );
  // Ratings and tags are filled in later, from the API.
  assert.deepEqual(problems.map((p) => p.rating), [null, null]);
  assert.deepEqual(problems.map((p) => p.tags), [[], []]);
});

test("reports unreadable solve counts instead of inventing zeroes", async () => {
  serveContest(500, { totalsRow: false });
  const { problems, solveCountsRead } = await scrapeContestProblems("contest", "1");

  assert.equal(solveCountsRead, false);
  // Counts stay at 0, which is exactly why the flag has to be checked.
  assert.deepEqual(problems.map((p) => p.officialSolves), [0, 0]);
});

test("throws when the standings table can't be found at all", async () => {
  CodeforcesHttp.get = async () => "<html><body><p>Just a page</p></body></html>";
  await assert.rejects(() => scrapeContestProblems("contest", "1"), /standings/i);
});

test("small contests are read whole, as one unweighted group", async () => {
  const requested = serveContest(600); // 12 pages, under the sampling threshold
  const result = await sampleParticipantHandles("1");

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].scale, 1);
  assert.equal(result.total, 600);
  assert.equal(sampledCount(result), 600);
  assert.equal(new Set(requested).size, 12);
});

test("large contests are sampled at a fixed cost, sized exactly", async () => {
  const requested = serveContest(4000); // 80 pages
  const result = await sampleParticipantHandles("1");

  assert.equal(result.total, 4000);
  assert.ok(new Set(requested).size <= 32, `read ${new Set(requested).size} pages`);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].scale, 1, "head must be unweighted");
  // The weights have to add back up to the field, or every rating shifts.
  assert.equal(Math.round(represented(result)), 4000);
});

test("a partial final page is measured, not assumed full", async () => {
  serveContest(3975); // last page holds 25, not 50
  const result = await sampleParticipantHandles("1");
  assert.equal(result.total, 3975);
  assert.equal(Math.round(represented(result)), 3975);
});

test("no competitor is counted twice across strata", async () => {
  serveContest(4000);
  const result = await sampleParticipantHandles("1");
  const all = result.groups.flatMap((group) => group.handles);
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, sampledCount(result));
});

test("an understated last page falls back to reading everything", async () => {
  // Pagination claims page 40 is last when 80 is: trusting it would size the
  // field at half its true value and skew every rating in the contest.
  const requested = serveContest(4000, { claimLastPage: 40 });
  const result = await sampleParticipantHandles("1");

  assert.equal(result.total, 4000, "must not accept the understated count");
  assert.equal(result.groups.length, 1, "fallback reads the whole field");
  assert.equal(sampledCount(result), 4000);
  assert.ok(new Set(requested).size >= 80);
});
