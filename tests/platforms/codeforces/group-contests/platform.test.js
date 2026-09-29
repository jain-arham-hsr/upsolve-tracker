/**
 * Group contests: read from pages, because the API cannot see them.
 *
 * Measured with a member's signed key against 719724: `contest.standings` and
 * `contest.status` both answer "not found". So the one thing these cases pin
 * beyond the add itself is that the path never *asks* — a group contest routed
 * through either call fails, and would look like a missing contest rather than
 * a wrong turn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { CodeforcesApi } = await import("../../../../core/platforms/codeforces/api.js");
const { CodeforcesScraper } = await import("../../../../core/platforms/codeforces/scraper.js");
const { getPlatform, matchContestUrl } = await import("../../../../core/platforms/registry.js");

const ID = "719724";
const platform = getPlatform("codeforces-group-contests");

/**
 * A group contest's sidebar, as 719724 renders it: the header names the
 * *group*, and where a gym shows its phase this shows the viewer's role. Read
 * the way a gym's is, that filed a finished contest as still running — and
 * would have named it after the group.
 */
const sidebar = `<div id="sidebar">
  <div class="roundbox"><table class="rtable">
    <tr><th class="left"><a href="/group/wlb0UYQSQF">Inter-College Competitive Programming Camp</a></th></tr>
    <tr><td>Private</td></tr>
    <tr><td><span class="contest-state-phase">Participant</span></td></tr>
  </table></div>
  <div class="roundbox"><div class="caption titled">→ About Group</div></div></div>`;

/**
 * The dashboard's menu: the standings under the group's path. Its tab opens
 * the group's own standings, which is the page 719724's user saved — so the
 * link ends in `/groupmates/true`, not `/standings`.
 */
const STANDINGS_PATH = `/group/wlb0UYQSQF/contest/${ID}/standings/groupmates/true`;
const menu = `<div class="second-level-menu"><ul class="second-level-menu-list">
  <li><a href="/group/wlb0UYQSQF/contest/${ID}">Problems</a></li>
  <li><a href="/group/wlb0UYQSQF/contest/${ID}/my">My submissions</a></li>
  <li><a href="${STANDINGS_PATH}">Standings</a></li></ul></div>`;

const problemsPage = () => `<html><body>${menu}${sidebar}
  <table class="problems"><tr><th>#</th><th>Name</th></tr>
    <tr><td class="id"><a href="/group/wlb0UYQSQF/contest/${ID}/problem/A">A</a></td>
        <td><a href="/group/wlb0UYQSQF/contest/${ID}/problem/A">Matching Socks</a></td></tr>
    <tr><td class="id"><a href="/group/wlb0UYQSQF/contest/${ID}/problem/B">B</a></td>
        <td><a href="/group/wlb0UYQSQF/contest/${ID}/problem/B">The Bus Round</a></td></tr>
  </table></body></html>`;

/** Later pages as the real page links them — not a path the platform could build. */
const PAGE_PATH = `/group/wlb0UYQSQF/contest/${ID}/standings/groupmates/true/page/`;

const row = (handle) => `<tr><td>1</td>
  <td class="contestant-cell"><a href="/profile/${handle}">${handle}</a></td><td>1</td><td>1</td><td></td><td></td></tr>`;

const standingsPage = ({ page = 1, pages = 1, handles, totals = ["3", "1"], timer = "" }) => `<html><body>
  ${sidebar}${timer}
  <div class="contest-name"><a href="/group/wlb0UYQSQF/contest/${ID}">ICPC 2027 Mock Prelims - 1</a></div>
  <table class="standings"><tr><th>#</th><th>Who</th><th>=</th><th>Penalty</th>
    <th><a href="/group/wlb0UYQSQF/contest/${ID}/problem/A">A</a></th>
    <th><a href="/group/wlb0UYQSQF/contest/${ID}/problem/B">B</a></th></tr>
    ${handles.map(row).join("")}
    ${totals ? `<tr><td colspan="4">Accepted<br>Tried</td><td>${totals[0]}<br>5</td><td>${totals[1]}<br>4</td></tr>` : ""}
  </table>
  <div class="custom-links-pagination">
  ${Array.from({ length: pages }, (_, i) => `<a href="${PAGE_PATH}${i + 1}">${i + 1}</a>`).join("")}</div>
  <span data-page="${page}"></span></body></html>`;

/**
 * A session over a real API and scraper, with the page read stubbed and every
 * API route the path must not reach made to throw.
 */
function session({ pages, userStatus = async () => [], usersInfo }) {
  const seen = [];
  const scraper = Object.assign(new CodeforcesScraper(), {
    async document(path) {
      seen.push(path);
      const body = typeof pages === "function" ? pages(path) : pages[path];
      if (body instanceof Error) throw body;
      if (body == null) throw new Error(`no page served for ${path}`);
      return new DOMParser().parseFromString(body, "text/html");
    },
  });
  const refuse = (name) => async () => { throw new Error(`${name} should not have been called`); };
  const api = Object.assign(new CodeforcesApi("k", "s"), {
    contestStandings: refuse("contestStandings"),
    publicContestStandings: refuse("publicContestStandings"),
    contestStatus: refuse("contestStatus"),
    contestList: refuse("contestList"),
    userStatus,
    usersInfo: usersInfo ?? (async (handles) => handles.map((handle, i) => ({ handle, rating: 1200 + 200 * i }))),
  });
  return { session: { handle: "jain_arham_hsr", api, scraper }, seen };
}

const PAGES = {
  [`/gym/${ID}`]: problemsPage(),
  [STANDINGS_PATH]: standingsPage({ handles: ["alice", "bob", "carol", "dave"] }),
};

test("a group contest URL is this platform's, not the official one's", () => {
  const match = matchContestUrl(`https://codeforces.com/group/wlb0UYQSQF/contest/${ID}/problem/B`);
  assert.equal(match.platform.id, "codeforces-group-contests");
  assert.equal(match.contestId, ID);
});

test("a finished group contest is read from its pages and every problem estimated", async () => {
  const own = {
    problem: { contestId: 719724, index: "A" },
    author: { participantId: 1, participantType: "CONTESTANT", startTimeSeconds: 1790000000, members: [{ handle: "jain_arham_hsr" }] },
    verdict: "OK",
  };
  const { session: s } = session({ pages: PAGES, userStatus: async () => [own] });

  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });

  assert.equal(result.status, "ready");
  const { contest } = result;
  assert.equal(contest.platform, "codeforces-group-contests");
  assert.equal(contest.name, "ICPC 2027 Mock Prelims - 1", "named after the contest, not the group");
  assert.equal(contest.type, "GROUP");
  assert.deepEqual(contest.problems.map((p) => [p.index, p.name, p.officialSolves]), [
    ["A", "Matching Socks", 3],
    ["B", "The Bus Round", 1],
  ]);
  for (const problem of contest.problems) {
    assert.equal(typeof problem.rating, "number", `${problem.index} was left unrated`);
    assert.equal(problem.ratingSource, "estimated");
  }
  // Harder by solves, so no easier by rating.
  assert.ok(contest.problems[1].rating >= contest.problems[0].rating);
  assert.equal(contest.startTimeSeconds, 1790000000);
  assert.equal("context" in contest, false, "the field is carried, never stored");
});

test("every standings page is read, and a party on a later page counts", async () => {
  const pages = {
    [`/gym/${ID}`]: problemsPage(),
    [STANDINGS_PATH]: standingsPage({ pages: 2, handles: ["alice", "bob"] }),
    [`${PAGE_PATH}2`]: standingsPage({ page: 2, pages: 2, handles: ["carol"] }),
  };
  const asked = [];
  const { session: s, seen } = session({
    pages,
    usersInfo: async (handles) => {
      asked.push(...handles);
      return handles.map((handle) => ({ handle, rating: 1500 }));
    },
  });

  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "ready");
  assert.ok(seen.includes(`${PAGE_PATH}2`), "the later page is read by the page's own link");
  assert.deepEqual(asked.sort(), ["alice", "bob", "carol"]);
});

test("an unreadable later page refuses rather than rating a shorter field", async () => {
  const pages = {
    [`/gym/${ID}`]: problemsPage(),
    [STANDINGS_PATH]: standingsPage({ pages: 2, handles: ["alice"] }),
    [`${PAGE_PATH}2`]: "<html><body>nothing</body></html>",
  };
  const { session: s } = session({ pages });
  await assert.rejects(
    () => platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s }),
    /Couldn't read the standings/,
  );
});

test("a later page without a totals row still counts — only the first page's totals are used", async () => {
  const pages = {
    [`/gym/${ID}`]: problemsPage(),
    [STANDINGS_PATH]: standingsPage({ pages: 2, handles: ["alice", "bob"] }),
    [`${PAGE_PATH}2`]: standingsPage({ page: 2, pages: 2, handles: ["carol"], totals: null }),
  };
  const { session: s } = session({ pages });
  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.contest.problems.map((p) => p.officialSolves), [3, 1]);
});

test("a first page without totals refuses, naming the page it read", async () => {
  const pages = {
    [`/gym/${ID}`]: problemsPage(),
    [STANDINGS_PATH]: standingsPage({ handles: ["alice"], totals: null }).replace("<body>", "<head><title>Odd Page</title></head><body>"),
  };
  const { session: s } = session({ pages });
  await assert.rejects(
    () => platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s }),
    /\/group\/wlb0UYQSQF\/contest\/719724\/standings\/groupmates\/true has no totals row.*"Odd Page"/,
  );
});

test("a timer on the standings means still running: it waits, and reads nothing more", async () => {
  const running = standingsPage({
    pages: 3,
    handles: ["alice"],
    timer: `<div class="roundbox">Contest is running <span class="countdown">01:12:09</span></div>`,
  });
  const { session: s, seen } = session({ pages: { [`/gym/${ID}`]: problemsPage(), [STANDINGS_PATH]: running } });
  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "notEndedYet");
  assert.deepEqual(seen, [`/gym/${ID}`, STANDINGS_PATH], "partial counts are not worth further pages");
});

test("the standings are read by the dashboard's own link, never /gym/<id>/standings", async () => {
  // Measured on 719724: `/gym/<id>` redirects to the group contest, but
  // `/gym/<id>/standings` lands on its dashboard, which has no standings table.
  const { session: s, seen } = session({ pages: PAGES });
  await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.ok(seen.includes(STANDINGS_PATH));
  assert.ok(!seen.includes(`/gym/${ID}/standings`));
});

test("a dashboard linking no standings refuses, rather than guessing a path, and names the page", async () => {
  const bare = problemsPage().replace(menu, "").replace("<body>", "<head><title>Dashboard - X - Codeforces</title></head><body>");
  const { session: s } = session({ pages: { [`/gym/${ID}`]: bare } });
  await assert.rejects(
    () => platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s }),
    /links no standings to read \(page title "Dashboard - X - Codeforces"\)/,
  );
});

test("a sidebar link to another contest is not taken for the standings", async () => {
  // The sidebar lists the group's other contests; only a standings path counts.
  const other = `<div class="roundbox"><a href="/group/wlb0UYQSQF/contest/719000">Camp Week 5</a>
    <a href="/group/wlb0UYQSQF/contest/719000/standings-archive-note">note</a></div>`;
  const page = problemsPage().replace(menu, "").replace('<div id="sidebar">', `<div id="sidebar">${other}`);
  const { session: s } = session({ pages: { [`/gym/${ID}`]: page } });
  await assert.rejects(
    () => platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s }),
    /links no standings/,
  );
});

test("links go to the group's own path, which no /gym/ path reaches below the root", async () => {
  const { session: s } = session({ pages: PAGES });
  const { contest } = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  const group = `https://codeforces.com/group/wlb0UYQSQF/contest/${ID}`;
  assert.equal(platform.contestUrl(contest), group);
  assert.equal(platform.problemUrl(contest, contest.problems[1]), `${group}/problem/B`);
});

test("a scraped link off codeforces.com is not stored", async () => {
  const pages = { ...PAGES, [`/gym/${ID}`]: problemsPage().replaceAll(`/group/wlb0UYQSQF/contest/${ID}/problem/A`, "https://elsewhere.example/A") };
  const { session: s } = session({ pages });
  const { contest } = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(contest.problems[0].url, undefined);
  assert.equal(platform.problemUrl(contest, contest.problems[0]), `https://codeforces.com/group/wlb0UYQSQF/contest/${ID}/problem/A`);
});

test("a page that bounced to sign-in waits rather than refusing", async () => {
  const signedOut = Object.assign(new Error("Codeforces asked to sign in."), { isSourceUnreachable: true });
  const { session: s } = session({ pages: () => signedOut });
  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "sourceUnreachable");
});

test("standings missing a problem's column refuse, rather than estimating it from zero", async () => {
  const pages = {
    [`/gym/${ID}`]: problemsPage().replace("</table></body>", `
      <tr><td class="id"><a href="/group/wlb0UYQSQF/contest/${ID}/problem/C">C</a></td>
          <td><a href="/group/wlb0UYQSQF/contest/${ID}/problem/C">Disjoint Walkways</a></td></tr></table></body>`),
    [STANDINGS_PATH]: PAGES[STANDINGS_PATH],
  };
  const { session: s } = session({ pages });
  await assert.rejects(
    () => platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s }),
    /no column for C/,
  );
});

test("standings with nobody rateable are unavailable, not waited on", async () => {
  const pages = { ...PAGES, [STANDINGS_PATH]: standingsPage({ handles: [] }) };
  const { session: s } = session({ pages });
  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "unavailable");
});

test("a failed date lookup costs the date, not the contest", async () => {
  const { session: s } = session({
    pages: PAGES,
    userStatus: async () => { throw new Error("503"); },
  });
  const result = await platform.fetchContestRecord({ contestId: ID, subtype: "GROUP", session: s });
  assert.equal(result.status, "ready");
  assert.equal(result.contest.startTimeSeconds, null);
});

test("refreshing never asks a contest list for group contests' dates", async () => {
  // They are in none, so the base's default would fetch one every refresh forever.
  const { session: s } = session({ pages: {} });
  // Counted rather than thrown: the base swallows a failed list, so a throw
  // would pass whether or not the list was asked for.
  let asked = 0;
  s.api.contestList = async () => { asked++; return []; };
  await platform.syncStartTimes(s, [{ id: ID, startTimeSeconds: null }]);
  assert.equal(asked, 0);
});
