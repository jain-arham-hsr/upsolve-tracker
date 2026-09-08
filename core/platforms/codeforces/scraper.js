/**
 * Codeforces' one page: `/gym/<id>`, the problems page a hidden gym renders.
 *
 * It is read for one kind of contest only: a gym whose standings the setter
 * hid, which answers `FAILED` to `contest.standings` and renders no standings
 * table. Everything else Codeforces serves comes from the JSON API in
 * `api.js` — the official platform never reaches this file at all, which
 * `module-boundaries.test.js` pins, along with the count of page reads here
 * staying at one.
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
   * A gym's own problems page: the contest name, whether it has finished, and
   * the definitive problem list — **including problems nobody submitted to**,
   * which is why the list cannot be derived from submissions.
   *
   * @returns {Promise<{contestName: string|null, problems: object[], finished: boolean|null}|null>}
   *   null when the page is not the shape the parser knows.
   */
  async problemsPage(contestId) {
    const contestPath = `/gym/${contestId}`;
    return parseProblemsPage(await this.document(contestPath), { contestPath });
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
 *   finished: boolean|null}|null}
 *   `null` when there is no problems table, or a row has no index — either is
 *   a layout change, and the caller refuses loudly rather than storing a
 *   contest that merely looks short.
 */
export function parseProblemsPage(doc, { contestPath = null } = {}) {
  const problems = problemRows(doc);
  if (problems === null) return null;

  return { contestName: contestName(doc, contestPath), problems, finished: hasFinished(doc) };
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

    problems.push({ index, name: text(nameLink) ?? UNKNOWN_PROBLEM, url: `${ORIGIN}${href}` });
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
