/**
 * Integration cover for the scraping path: fetch -> parse -> shape, with the
 * HTTP client stubbed so no network is touched.
 *
 * The unit tests in standings-dom.test.js check parsing in isolation; these
 * check the shaping layered on top.
 *
 * This covers the **gym** roster only. Official contests read their roster from
 * `contest.standings` and no longer touch HTML at all, and the field sampling
 * that used to live here — the one official path that did — now stratifies the
 * rows of that same response; see tests/sampling.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { CodeforcesHttp } = await import("../core/platforms/codeforces/http.js");
const { scrapeContestProblems } = await import(
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
