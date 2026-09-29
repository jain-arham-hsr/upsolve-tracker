/**
 * Codeforces' pages: a gym's problems page, and a contest's standings.
 *
 * Two kinds of contest need them, and nothing else does:
 *
 * - **A gym whose standings the setter hid** answers `FAILED` to
 *   `contest.standings` and renders no standings table, so its problems page
 *   is read for the definitive problem list. Everything else comes from the
 *   JSON API.
 * - **A group contest** is invisible to the API altogether — `contest.standings`
 *   and `contest.status` both answer "not found" to a member's key — so both
 *   its problems page and its standings are read here.
 *
 * The official platform never reaches this file at all, which
 * `module-boundaries.test.js` pins, along with which platform reads the
 * standings page.
 *
 * Its client is a different site surface from the API's with different rules
 * — it needs the session cookie and the page transport, Cloudflare challenges
 * it, and its throttling is tuned against the live site rather than the API's
 * published limit — so it is its own client, on its own pace.
 */
import { Scraper, first, all, text } from "../scraper.js";
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

const ORIGIN = "https://codeforces.com";

/**
 * **Do not shorten these delays when optimising.** `measureFrom: "end"` is
 * load-bearing for the same reason: it waits the full gap after each request
 * finishes rather than letting a slow page count towards the next gap.
 * `tests/request-pacer.test.js` fails if that is collapsed.
 */
const PAGE_GAP_MS = [1000, 2500];
const COOLDOWN = { everyNth: 15, gapMs: [6000, 12000] };

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const SIGNED_OUT =
  "Codeforces asked to sign in. Open codeforces.com in a tab, sign in, and it will be retried on the next refresh.";

/**
 * Routed through a Codeforces tab when one is open, so the request carries
 * the session and Cloudflare sees the user rather than a stranger. Falls back
 * to a direct fetch otherwise, which still reads anything public.
 */
const client = createSiteClient({
  site,
  pacer: {
    gapMs: PAGE_GAP_MS,
    measureFrom: "end",
    cooldown: COOLDOWN,
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[Codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[Codeforces] Request ${count}: waiting ${seconds}s`);
      }
    },
  },

  /**
   * Cloudflare answers a challenge two ways, and both must be caught: a 403
   * with no useful body, or a 200 whose body is the interstitial. Measured
   * live — `cf-mitigated: challenge`, a page of scripts pointing at
   * challenges.cloudflare.com — so this is not a heuristic.
   *
   * Flagged rather than thrown bare: `contest-status.js` defines
   * `sourceUnreachable` as exactly this, and the flag is what lets the add
   * wait and retry instead of failing outright.
   */
  refusal({ response, body }) {
    // A page behind membership — a group contest's — redirects to the sign-in
    // form when the request carries no session, typically because no
    // codeforces.com tab was open. Read as a page it is merely "no table", which
    // would refuse the add as a layout change; it is a failure to ask, and the
    // add waits instead.
    if (response.url && new URL(response.url).pathname === "/enter") {
      return Object.assign(new Error(SIGNED_OUT), { isSourceUnreachable: true });
    }
    if (response.status !== 403 && !body.includes("Just a moment")) return null;
    return Object.assign(new Error(BLOCKED), { isSourceUnreachable: true });
  },
});

export class CodeforcesScraper extends Scraper {
  constructor() {
    super({ origin: ORIGIN, client });
  }

  /** A page read carries the browser's session, not the key pair: one instance serves every session. */
  static fromSettings() {
    return scraper;
  }

  /** Test seam: resets the page client's pacing between cases. */
  static reset(spacingMs = 0) {
    scraper.reset(spacingMs);
  }

  /**
   * A contest's own problems page — a hidden-standings gym's, or a group
   * contest's dashboard, which `/gym/<id>` redirects to: the contest name,
   * whether it has finished, the link to its standings, and the definitive
   * problem list — **including problems nobody submitted to**,
   * which is why the list cannot be derived from submissions.
   *
   * @returns {Promise<{contestName: string|null, problems: object[], finished: boolean|null}|null>}
   *   null when the page is not the shape the parser knows.
   */
  async problemsPage(contestId) {
    const contestPath = `/gym/${contestId}`;
    return parseProblemsPage(await this.document(contestPath), { contestPath });
  }

  /**
   * A contest's standings, every page of them: its name, whether it has
   * ended, one party per row, and the in-contest solve counts from the totals
   * row. A contest still running stops at the first page: its counts are
   * partial, and the rest would be read for nothing.
   *
   * @param {string} standingsPath - the standings link the contest's own page
   *   carries. Never a path built from the id: `/gym/<id>` redirects a group
   *   contest to its group, but `/gym/<id>/standings` lands on its dashboard.
   *
   * @returns {Promise<{contestName: string|null, ended: boolean,
   *   parties: string[][], solveCounts: Record<string, number>}>}
   * @throws naming the page, and the title it had, when one is not the shape
   *   the parser knows — "the standings" alone does not say which of several
   *   pages broke, or whether Codeforces served a standings page at all.
   */
  async standingsPage(standingsPath) {
    const read = async (path, { needsCounts }) => {
      const doc = await this.document(path);
      const page = parseStandingsPage(doc);
      if (page && (page.solveCounts || !needsCounts)) return page;
      const title = text(first(doc, "title"));
      throw new Error(
        `Couldn't read the standings: ${this.url(path)} ` +
          (page ? "has no totals row to count solves from" : "is not a standings page the parser knows") +
          (title ? ` (page title "${title}").` : "."),
      );
    };

    // Only the first page's totals are used — they count the whole field — so
    // only the first is required to carry them.
    const firstPage = await read(standingsPath, { needsCounts: true });
    if (!firstPage.ended) return { ...firstPage, parties: [] };

    // Later pages by the page's own link, never a path built here: a group
    // contest's are `/group/<g>/contest/<id>/standings/groupmates/true/page/N`,
    // which no `/gym/<id>` form reproduces.
    // A short field reads as an easier contest, not as a failure — so one
    // unreadable page refuses the whole read rather than being skipped.
    const parties = [...firstPage.parties];
    for (let page = 2; page <= firstPage.pageCount; page++) {
      const next = await read(firstPage.pagePath.replace(/\/page\/\d+/, `/page/${page}`), { needsCounts: false });
      parties.push(...next.parties);
    }

    return { contestName: firstPage.contestName, ended: true, parties, solveCounts: firstPage.solveCounts };
  }
}

export const scraper = new CodeforcesScraper();

// ---------------------------------------------------------------------------
// /gym/<id>
// ---------------------------------------------------------------------------

const PROBLEMS_PAGE = {
  problemsTable: "table.problems",
  problemRow: "tr",
  indexLink: "td.id a",
  problemLink: 'a[href*="/problem/"]',

  /**
   * The contest name lives in the sidebar box's header link, whose href is
   * the contest root — **not** in a `.caption`.
   *
   * The old standings parser's chain was `.contest-name` → `.caption` →
   * `<title>`. A problems page has no `.contest-name`, and its first
   * `.caption` is the "→ About Contest" sidebox heading — so pointing that
   * chain here filed the first real gym in the queue under the name
   * **"→ About Contest"**. That parser is gone; the warning stays.
   */
  contestName: ["#sidebar .rtable th a", "#sidebar .rtable th"],
  title: "title",

  /** "Finished", "Running", "Before start" — the sidebar's phase label. */
  contestPhase: ".contest-state-phase",

  /**
   * The contest's standings, as its own menu links them. On a group contest
   * this is the only way to the right path — see `standingsPage`. Matched on
   * the path's shape rather than its ending: the tab may link
   * `…/standings/groupmates/true` (the group's own standings, which is what
   * the tab opens) as readily as `…/standings`. An exact `$="/standings"`
   * found nothing on 719724's dashboard.
   */
  standingsLink: ['.second-level-menu a[href*="/standings"]', 'a[href*="/standings"]'],
  standingsHref: /\/contest\/\d+\/standings(?:\/|$)/,
};

/** Shared by both problem readers so their fallbacks can't drift. */
const UNKNOWN_PROBLEM = "Unknown Problem";

/**
 * @param {Document} doc
 * @param {{contestPath?: string}} [options] - e.g. "/gym/712373". The sidebar
 *   header links to exactly this, which is the most specific way to find the
 *   name; without it the chain above still answers.
 * @returns {{contestName: string|null,
 *   problems: Array<{index: string, name: string, url: string}>,
 *   finished: boolean|null, standingsPath: string|null, pageTitle: string|null}|null}
 *   `null` when there is no problems table, or a row has no index — either is
 *   a layout change, and the caller refuses loudly rather than storing a
 *   contest that merely looks short.
 */
export function parseProblemsPage(doc, { contestPath = null } = {}) {
  const problems = problemRows(doc);
  if (problems === null) return null;

  return {
    contestName: contestName(doc, contestPath),
    problems,
    finished: hasFinished(doc),
    standingsPath: standingsPath(doc),
    pageTitle: text(first(doc, PROBLEMS_PAGE.title)),
  };
}

/**
 * The first link to *this kind* of page — a contest's standings — preferring
 * the menu's. The shape check keeps out anything else that merely mentions
 * standings; the sidebar's links to other contests point at their roots.
 */
function standingsPath(doc) {
  for (const selector of PROBLEMS_PAGE.standingsLink) {
    const href = all(doc, selector)
      .map((link) => link.getAttribute("href"))
      .find((candidate) => PROBLEMS_PAGE.standingsHref.test(candidate ?? ""));
    if (href) return href;
  }
  return null;
}

/**
 * Null rather than `Contest <id>` when unreadable: a display fallback is the
 * caller's to choose, and a parser never invents a plausible value. Note the
 * name is read once at add time and never re-read, so a contest added under
 * the wrong name keeps it until removed and re-added.
 */
function contestName(doc, contestPath) {
  if (contestPath) {
    const linked = text(first(doc, `#sidebar a[href="${contestPath}"]`));
    if (linked) return linked;
  }

  const fromSidebar = text(first(doc, PROBLEMS_PAGE.contestName));
  if (fromSidebar) return fromSidebar;

  // Codeforces titles pages "<section> - <contest> - Codeforces". Dropping the
  // suffix is worth doing; guessing at the section prefix is not, since a
  // slightly long name still reads correctly and a wrong split does not.
  const title = text(first(doc, PROBLEMS_PAGE.title));
  return title?.replace(/\s*-\s*Codeforces\s*$/i, "").trim() || null;
}

/**
 * The definitive problem list. Deriving one from the submissions instead
 * would silently omit any problem nobody attempted, so this page is the
 * authority on what a contest contains.
 */
function problemRows(doc) {
  const table = first(doc, PROBLEMS_PAGE.problemsTable);
  if (!table) return null;

  const problems = [];

  for (const row of all(table, PROBLEMS_PAGE.problemRow)) {
    // The header row has no id cell, so this skips it without matching text.
    const indexLink = first(row, PROBLEMS_PAGE.indexLink);
    if (!indexLink) continue;

    const index = text(indexLink);
    const href = indexLink.getAttribute("href");

    // An indexless problem would silently mismatch every later lookup by
    // index, so the whole page is refused rather than the one row skipped.
    if (!index || !href) return null;

    // The name is the row's *other* link to the same problem. Matching on
    // column position would break the first time a column is added.
    const nameLink = all(row, PROBLEMS_PAGE.problemLink).find(
      (link) => link !== indexLink && text(link),
    );

    problems.push({ index, name: text(nameLink) ?? UNKNOWN_PROBLEM, url: new URL(href, ORIGIN).href });
  }

  return problems.length > 0 ? problems : null;
}

/**
 * Whether the contest has finished, read off the page rather than the API.
 *
 * The hidden-standings path has no `contest.standings` to ask, and adding a
 * contest mid-flight is not harmless: the estimator would fit partial solve
 * counts, and on a gym nothing ever corrects the result.
 *
 * @returns {boolean|null} null when the page doesn't say, which callers treat
 *   as "proceed" — refusing on an unreadable label would make a contest
 *   unaddable for a reason we cannot even state.
 */
function hasFinished(doc) {
  const label = text(first(doc, PROBLEMS_PAGE.contestPhase));
  if (!label) return null;
  return /finished/i.test(label);
}

// ---------------------------------------------------------------------------
// A contest's standings, by whatever path its own page links
// ---------------------------------------------------------------------------

const STANDINGS_PAGE = {
  /**
   * The contest's own name. On a group contest this is the only place it
   * appears: the problems page's sidebar header is the *group's* name, so the
   * chain `parseProblemsPage` uses would file the contest under that.
   */
  contestName: ".contest-name",

  /**
   * The line under the name: "Contest is running" above a timer, or
   * "Finished" once it is over. Seen on 719724's standings in both states. A
   * group contest's *sidebar* shows the viewer's role ("Participant") where a
   * gym's shows its phase, so this line is the one place the state is said.
   */
  contestStatus: ".contest-status",

  /** The timer shown while the status reads running; the fallback when the label is not found. */
  timer: ".countdown",

  standingsTable: "table.standings",

  /** The totals row, as 719724's standings mark it. */
  totalsRow: "tr.standingsStatisticsRow",
  row: "tr",
  /** The header row's problem columns; the index is the link text. */
  problemHeader: 'th a[href*="/problem/"]',
  /** A team's cell also links the team itself, so only profile links are members. */
  profileLink: 'a[href*="/profile/"]',

  /**
   * Links to the other pages, 200 rows each. On a group contest these are
   * `…/standings/groupmates/true/page/N`, so the match is on `/page/` inside
   * the standings path rather than on one fixed shape.
   */
  pageLink: [".custom-links-pagination a[href*=\"/page/\"]", 'a[href*="/standings/"][href*="/page/"]'],
};

/**
 * The totals row's label, the fallback when the row's class is not found.
 * Only a fallback: a team can be named "Accepted".
 */
const TOTALS_ROW_MARKER = "Accepted";

/** Node.TEXT_NODE, inlined so the parser runs outside a browser too. */
const TEXT_NODE = 3;

/**
 * @param {Document} doc
 * @returns {{contestName: string|null, ended: boolean, parties: string[][],
 *   solveCounts: Record<string, number>|null, pageCount: number, pagePath: string|null}|null}
 *   `pagePath` is the highest-numbered page's own link, which the reader
 *   renumbers for every page after the first; null when there is one page.
 *   `solveCounts` is null when the page has no totals row — a later page may
 *   well not carry one, so that is a fact for the reader to judge. The page is
 *   `null` when there is no standings table, no problem columns, or a totals
 *   row that is there and will not parse — each a layout change, never a zero.
 */
export function parseStandingsPage(doc) {
  const table = first(doc, STANDINGS_PAGE.standingsTable);
  if (!table) return null;

  const indices = all(table, STANDINGS_PAGE.problemHeader).map(text);
  // An indexless column would silently shift every count after it.
  if (indices.length === 0 || indices.some((index) => !index)) return null;

  const rows = all(table, STANDINGS_PAGE.row);
  const totals =
    first(table, STANDINGS_PAGE.totalsRow) ??
    rows.find((row) => (text(row) ?? "").includes(TOTALS_ROW_MARKER)) ??
    null;
  const counts = totals ? solveCounts(totals, indices.length) : null;
  if (totals && !counts) return null;

  // One party per row, not one per handle: a team is collapsed into a single
  // effective rating (`api.js#teamRating`), and flattening its members would
  // count it as several competitors. Rows without a profile link — the header,
  // the totals, a ghost party — are not parties we can rate.
  const parties = rows
    .filter((row) => row !== totals)
    .map((row) => all(row, STANDINGS_PAGE.profileLink).map(text).filter(Boolean))
    .filter((handles) => handles.length > 0);

  return {
    contestName: text(first(doc, STANDINGS_PAGE.contestName)),
    ended: hasEnded(doc),
    parties,
    solveCounts: counts && Object.fromEntries(indices.map((index, i) => [index, counts[i]])),
    ...pages(doc),
  };
}

/**
 * The last `problemCount` cells of the totals row, one count each. Any cell
 * that will not parse refuses the row: a missing count read as zero is a
 * confident, wrong rating.
 */
function solveCounts(totalsRow, problemCount) {
  const cells = all(totalsRow, "td").slice(-problemCount);
  if (cells.length !== problemCount) return null;
  const counts = cells.map(solveCount);
  return counts.some((count) => count === null) ? null : counts;
}

/** The first number in a totals cell — "Accepted" above "Tried", split by a `<br>`. */
function solveCount(cell) {
  const firstText = [...cell.childNodes].find(
    (node) => node.nodeType === TEXT_NODE && node.nodeValue.trim() !== "",
  );
  const raw = firstText?.nodeValue ?? text(cell.firstElementChild) ?? text(cell);
  const digits = raw?.trim().split(/\s+/)[0];
  return digits && /^\d+$/.test(digits) ? Number(digits) : null;
}

/**
 * The status label when it says either way, since it is what the page shows a
 * reader. Found by class, or else as the text beside the name inside the same
 * header block. When neither says, a timer on the page means not ended.
 */
function hasEnded(doc) {
  const name = first(doc, STANDINGS_PAGE.contestName);
  const label =
    text(first(doc, STANDINGS_PAGE.contestStatus)) ??
    (name?.parentElement ? text(name.parentElement)?.replace(text(name) ?? "", "") : null);

  if (/\bfinished\b/i.test(label ?? "")) return true;
  if (/\b(running|before|pending|system testing)\b/i.test(label ?? "")) return false;
  return first(doc, STANDINGS_PAGE.timer) === null;
}

function pages(doc) {
  const selector = [STANDINGS_PAGE.pageLink].flat().find((one) => doc.querySelector(one));
  const links = selector
    ? all(doc, selector)
      .map((link) => ({
        href: link.getAttribute("href"),
        number: Number(link.getAttribute("href").match(/\/page\/(\d+)/)?.[1]),
      }))
      .filter((link) => Number.isFinite(link.number))
    : [];
  if (links.length === 0) return { pageCount: 1, pagePath: null };

  const last = links.reduce((best, link) => (link.number > best.number ? link : best));
  return { pageCount: last.number, pagePath: last.href };
}
