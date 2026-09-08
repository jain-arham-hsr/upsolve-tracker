/**
 * AtCoder's pages: three routes, and the parsing of each.
 *
 * AtCoder is a server-rendered Java application with no API, so HTML is the
 * interface rather than a fallback from one. Three pages, and none is matched
 * by AtCoder's robots.txt — every directive there ends in a slash
 * (`/contests/*​/submissions/`), so the list page whose path stops at
 * `submissions` is outside them. `/submissions/me` and per-submission pages
 * are inside, and are deliberately never requested.
 *
 *   /contests/<id>/tasks                             public   name, times, problems
 *   /contests/<id>/submissions?f.User=&f.Status=AC   session  what you solved
 *   /users/<handle>                                  public   rating, and who is signed in
 *
 * What each route owns is its URL, how many requests it takes, what an
 * unusable answer means for it, and what the platform gets back. Those differ
 * per route even on one site: `tasks` returns null so the contest waits, while
 * `acceptedTaskIds` throws, because `solved` is sticky and a silent empty
 * would strand the queue permanently.
 *
 * Each page's parser is a pure `parse*` export below its route, with the
 * selectors it uses declared in one block, so a layout change is one block to
 * edit rather than a hunt through function bodies.
 */
import { Scraper, first, all, text } from "../scraper.js";
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

const ORIGIN = "https://atcoder.jp";

/** Human-paced; `api.js` names the same site, so both clients queue as one. */
const GAP_MS = 1500;

/** Guards a runaway loop if pagination is ever misread. */
const MAX_SUBMISSION_PAGES = 20;

/**
 * Routed through an atcoder.jp tab when one is open: the submissions list is
 * login-gated, and a cross-site request carries no cookies.
 *
 * **AtCoder refuses by succeeding.** `fetch` follows the 302 transparently,
 * so a signed-out request arrives as a healthy 200 whose body is the sign-in
 * form. Parsing that yields no submissions — indistinguishable from having
 * solved nothing — and `solved` is sticky, so a swallowed refusal would look
 * like a healthy sync while quietly stranding the queue. Caught by checking
 * where we actually landed rather than what the status says.
 */
const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },
  refusal({ response, url }) {
    if (new URL(response.url).pathname === "/login") {
      // Thrown rather than returned, so no caller can mistake it for "nothing found".
      return Object.assign(
        new Error(
          "AtCoder is not signed in, so your submissions can't be read. " +
            "Open atcoder.jp, sign in, and refresh.",
        ),
        { isNotSignedIn: true, url },
      );
    }
    if (response.ok) return null;

    // The status rides along so a caller can say something better than this:
    // `identify` turns a 404 into "AtCoder has no user X", which is the
    // difference between a typo and an outage.
    return Object.assign(
      new Error(`AtCoder returned ${response.status} for ${new URL(url).pathname}.`),
      { status: response.status },
    );
  },
});

export class AtCoderScraper extends Scraper {
  constructor() {
    super({ origin: ORIGIN, client });
  }

  /** No page read needs credentials: one instance serves every session. */
  static fromSettings() {
    return scraper;
  }

  /** Test seam: resets pacing between cases. */
  static reset(spacingMs = 0) {
    scraper.reset(spacingMs);
  }

  /**
   * A contest's name, schedule and problem list — from one public page.
   *
   * Reading a contest's *own* task list is what retired AtCoder Problems'
   * `contest-problem.json`: a problem can belong to several contests — daily-
   * training rounds are mostly reruns — and a global list only records the
   * contest a problem debuted in. This page answers for exactly this contest.
   *
   * @returns {{name: string, startTimeSeconds: number|null, endTimeSeconds: number|null,
   *   problems: Array<{index: string, problemId: string, name: string}>}|null}
   *   `null` when the page yields no task table — the platform decides whether
   *   that means "not published yet" or something worse.
   */
  async tasks(contestId) {
    const page = parseTasks(await this.document(`/contests/${encodeURIComponent(contestId)}/tasks`));
    if (page === null) return null;

    // Only the display fallback is left here: a parser returns null rather
    // than inventing a name, so choosing what to show instead is the caller's.
    return { ...page, name: page.name ?? `Contest ${contestId}` };
  }

  /**
   * Task ids this handle has an accepted submission for, in one contest.
   *
   * Per contest, because AtCoder has no per-user submission list — the only
   * route to a submission is through the contest that hosted it. That is the
   * one real cost of leaving AtCoder Problems behind: its feed was user-wide,
   * so it also caught a task solved in a *different* contest from the one
   * tracked.
   *
   * @throws when the page carries no submissions table — a layout change,
   *   refused rather than reported as "nothing solved".
   */
  async acceptedTaskIds(contestId, handle) {
    const base =
      `/contests/${encodeURIComponent(contestId)}/submissions` +
      `?f.User=${encodeURIComponent(handle)}&f.Status=AC`;

    const firstPage = parseSubmissions(await this.document(base));
    if (firstPage === null) {
      throw new Error(
        `Couldn't read your AtCoder submissions for ${contestId} — the page layout may have changed.`,
      );
    }

    const accepted = firstPage.acceptedTaskIds;
    const pages = Math.min(firstPage.pageCount, MAX_SUBMISSION_PAGES);

    for (let page = 2; page <= pages; page++) {
      // Only page one is asked how many pages there are; the rest add ids.
      const next = parseSubmissions(await this.document(`${base}&page=${page}`));
      if (next === null) break;
      for (const id of next.acceptedTaskIds) accepted.add(id);
    }

    return accepted;
  }

  /**
   * A user's profile page, read for two facts at once: the rating shown, and
   * who the browser is signed in as — every page AtCoder serves carries
   * `var userScreenName`, so one request answers both.
   *
   * @returns {Promise<{signedInAs: string|null, rating: number|null}>}
   *   `signedInAs` is `""` when signed out and `null` when the marker is gone;
   *   the platform decides what each means.
   * @throws with `status: 404` when AtCoder has no such user.
   */
  async profile(handle) {
    const doc = await this.document(`/users/${encodeURIComponent(handle)}`);
    return { ...parsePageGlobals(doc), rating: parseProfile(doc).rating };
  }
}

/** The one instance; a handle is a parameter to the routes, not state on the client. */
export const scraper = new AtCoderScraper();

// ---------------------------------------------------------------------------
// /contests/<id>/tasks
// ---------------------------------------------------------------------------

const TASKS = {
  // The sidebar link first, `<title>` as the fallback: the title carries a
  // " - AtCoder" suffix and is localised differently.
  contestName: [".contest-title", "title"],
  // Both stamps carry an explicit `+0900`, so `Date.parse` needs no timezone
  // assumption of ours.
  times: "time.fixtime-full",
  taskRow: "table tbody tr",
  taskCell: "td",
  taskLink: "a[href]",
};

/** `/contests/<id>/tasks/<task_id>` — the id is the identity, see below. */
const TASK_HREF = /\/contests\/[^/]+\/tasks\/([^/?#]+)/;

/**
 * @returns {{name: string|null, startTimeSeconds: number|null, endTimeSeconds: number|null,
 *   problems: Array<{index: string, problemId: string, name: string}>}|null}
 *   `null` when there is no task table at all, which the caller reads as "not
 *   published yet" rather than as an empty contest.
 */
export function parseTasks(doc) {
  const problems = taskRows(doc);
  if (problems === null) return null;

  return { name: contestName(doc), ...contestTimes(doc), problems };
}

function contestName(doc) {
  const found = text(first(doc, TASKS.contestName));
  if (!found) return null;

  // Only `<title>` carries the suffix, but stripping it unconditionally is
  // safe and saves knowing which of the two chain entries matched.
  return found.replace(/\s*-\s*AtCoder\s*$/i, "").trim() || null;
}

/**
 * Start and end as epoch seconds, in document order — start first.
 *
 * Nulls rather than a guess when the stamps are unreadable: a wrong start
 * time silently mis-sorts the contest list, which is not a visible failure.
 */
function contestTimes(doc) {
  const stamps = all(doc, TASKS.times)
    .map((node) => Date.parse(text(node) ?? ""))
    .filter((ms) => Number.isFinite(ms))
    .map((ms) => Math.floor(ms / 1000));

  return { startTimeSeconds: stamps[0] ?? null, endTimeSeconds: stamps[1] ?? null };
}

/**
 * Identity is the task id from the row's link, never the displayed index: in
 * a rerun `abc432_c` can be listed as problem E, and the id is what makes one
 * solve clear every contest carrying it.
 */
function taskRows(doc) {
  const rows = all(doc, TASKS.taskRow);
  if (rows.length === 0) return null;

  const tasks = [];
  for (const row of rows) {
    const cells = all(row, TASKS.taskCell);
    if (cells.length < 2) continue;

    const link = first(cells[1], TASKS.taskLink) ?? first(cells[0], TASKS.taskLink);
    const match = (link?.getAttribute("href") ?? "").match(TASK_HREF);
    if (!match) continue;

    const index = text(cells[0]);
    const name = text(cells[1]);
    if (!index || !name) continue;

    tasks.push({ index, problemId: match[1], name });
  }

  // A table that parsed but yielded nothing is a shape change, not an empty
  // contest — AtCoder does not publish contests with no problems.
  return tasks.length > 0 ? tasks : null;
}

// ---------------------------------------------------------------------------
// /contests/<id>/submissions, filtered to one user
// ---------------------------------------------------------------------------

const SUBMISSIONS = {
  table: "table",
  row: "tbody tr",
  cell: "td",
  verdictLabel: "span",
  taskLink: 'a[href*="/tasks/"]',
  // AtCoder paginates in a `<ul class="pagination">` whose links carry page=N.
  pageLink: ".pagination a[href]",
};

/** AtCoder prints the verdict as a short label; only an exact "AC" counts. */
const ACCEPTED = "AC";

/**
 * The page is requested with `f.Status=AC`, so in principle every row is an
 * accepted submission. This reads the verdict cell anyway. If AtCoder ever
 * renames that filter parameter, the request still returns 200 with the
 * *unfiltered* list — and trusting the query string would then mark every
 * attempted problem solved, permanently, since `solved` is sticky. Reading
 * the verdict costs nothing and makes the filter an optimisation rather than
 * a load-bearing assumption.
 *
 * @returns {{acceptedTaskIds: Set<string>, pageCount: number}|null}
 *   `null` when there is no submissions table — a layout change. Distinct
 *   from an empty set, which means the table is present and you have solved
 *   nothing in this contest.
 */
export function parseSubmissions(doc) {
  const table = first(doc, SUBMISSIONS.table);
  if (!table) return null;

  return { acceptedTaskIds: acceptedIn(table), pageCount: pageCount(doc) };
}

/** Identity is the task id from the row's link, the same rule `parseTasks` follows. */
function acceptedIn(table) {
  const accepted = new Set();

  for (const row of all(table, SUBMISSIONS.row)) {
    const link = first(row, SUBMISSIONS.taskLink);
    const match = (link?.getAttribute("href") ?? "").match(TASK_HREF);
    if (!match) continue;
    if (!isAccepted(row)) continue;

    accepted.add(match[1]);
  }

  return accepted;
}

/**
 * A row counts only if some cell says exactly "AC".
 *
 * Exact, not `includes`: "WA" and "TLE" are distinct verdicts, but so is
 * "AC × 3" in some views, and a substring test would also match the word
 * inside a language name.
 */
function isAccepted(row) {
  return all(row, SUBMISSIONS.cell).some((cell) => {
    const label = first(cell, SUBMISSIONS.verdictLabel);
    return text(label ?? cell) === ACCEPTED;
  });
}

/**
 * Absent pagination means a single page, which is the common case: filtered
 * to one user and to accepted submissions, a contest rarely exceeds one.
 *
 * @returns {number} at least 1.
 */
function pageCount(doc) {
  const pages = all(doc, SUBMISSIONS.pageLink)
    .map((link) => Number(link.getAttribute("href")?.match(/[?&]page=(\d+)/)?.[1]))
    .filter((page) => Number.isInteger(page) && page > 0);

  return pages.length > 0 ? Math.max(...pages) : 1;
}

// ---------------------------------------------------------------------------
// /users/<handle>
// ---------------------------------------------------------------------------

const PROFILE = {
  header: "th",
};

/** Matched on exact label text, so "Highest Rating" doesn't win. */
const RATING_LABELS = ["Rating"];

/**
 * Server-rendered — not the SPA shell CodeChef serves — so the rating sits in
 * a plain labelled table cell. `robots.txt` disallows `/users/*​/history/`,
 * but not the profile itself, so this uses the permitted path.
 *
 * @returns {{rating: number|null}} never null itself. The page has no
 *   load-bearing table whose absence would mean "this is not a profile" — a
 *   profile with no rating row is a real profile belonging to someone who has
 *   not competed. So the *field* is nullable and the page is not, and a
 *   substituted rating would silently mis-sort every AtCoder problem in the
 *   queue, which is why it is null and never a plausible default.
 */
export function parseProfile(doc) {
  return { rating: profileRating(doc) };
}

function profileRating(doc) {
  if (!doc) return null;

  for (const label of RATING_LABELS) {
    const cell = cellFor(doc, label);
    if (cell === null) continue;

    const value = Number.parseInt(cell.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * The `<td>` paired with a `<th>` whose text is exactly `label`.
 *
 * Exact match matters: the profile table also has "Highest Rating", "Rated
 * Matches" and "Rank", and a substring match would take whichever came first.
 */
function cellFor(doc, label) {
  for (const header of all(doc, PROFILE.header)) {
    if (text(header) !== label) continue;

    const cell = header.nextElementSibling;
    if (cell?.tagName?.toLowerCase() === "td") return text(cell);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The signed-in marker every AtCoder page carries
// ---------------------------------------------------------------------------

const GLOBALS = {
  // No id or class to select on, so the script is picked by content.
  bootstrap: "script",
};

const SCREEN_NAME = /\bvar\s+userScreenName\s*=\s*"([^"]*)"/;

/**
 * Who the browser is signed in to AtCoder as. `var userScreenName = "…"` sits
 * in an inline `<script>` that the site's own code reads, which makes it a
 * far steadier signal than the navbar it is derived from.
 *
 * **Three outcomes, and conflating any two loses information:**
 *
 *   - a handle — signed in, and this is who as
 *   - `""` — the page rendered and nobody is signed in. A *fact*.
 *   - `null` — the marker is missing entirely, so the page shape changed and
 *     we do not know. Not the same as being signed out, and callers must not
 *     treat it as such: "we could not tell" is not evidence of anything.
 *
 * The page itself is never null here — every AtCoder page carries the marker,
 * so a missing one is a null *field*, not a wrong page.
 *
 * @returns {{signedInAs: string|null}}
 */
export function parsePageGlobals(doc) {
  for (const script of all(doc, GLOBALS.bootstrap)) {
    const match = SCREEN_NAME.exec(script.textContent ?? "");
    if (match) return { signedInAs: match[1] };
  }
  return { signedInAs: null };
}
