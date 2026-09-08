/**
 * Everything this extension reads from CodeChef — the client and its endpoints.
 *
 * CodeChef's public API was retired years ago and the site is an SPA, so the
 * only route to its data is the same `/api/` endpoints the front end calls.
 * That shapes the rules this file follows, all of which are deliberate:
 *
 *  - **Only what a user's own browser would load.** One contest they are
 *    looking at, its problems, and their own solve history. What would make
 *    this a crawler is **enumeration** — paging the 21,000-problem catalogue to
 *    build a copy of it. `/api/list/problems` is used, but only scoped by
 *    `group=attempted` to the signed-in account, and behind a page cap that
 *    refuses to continue if that scoping ever stops applying. Never page it
 *    unscoped.
 *  - **`/api/` paths only.** robots.txt disallows `/problems/*` and
 *    `/status/*`; `/api/` is not mentioned.
 *  - **Never evade a block.** A 403 stops and surfaces an error, exactly as
 *    Codeforces' client does. No retries, no header games.
 *
 * Cookies are sent because `problemsstats` is per-user; everything else the
 * endpoints return is public.
 *
 * How a request gets there is `client.js`; what a payload means is
 * `payloads.js`. What is left here is which routes exist.
 */
import { Source } from "../source.js";
import { ORIGIN, client } from "./client.js";
import { DashboardPage } from "./scrapers/page-globals.js";

/** Rows per page of the attempted-problems listing; 100 is honoured. */
const PAGE_SIZE = 100;

/**
 * Refuse to page beyond this many problems.
 *
 * Signed out, `group=attempted` is ignored and the endpoint answers with the
 * whole catalogue. If that ever happens while signed in, paging to `count`
 * would walk ~21,000 rows and turn a user read into the sweep this file
 * forbids. Nobody has attempted this many problems, so exceeding it means the
 * scoping did not apply — stop rather than crawl.
 */
const MAX_ATTEMPTED = 5000;

/** Contest payloads are reused within a single add; nothing is kept long. */
const CONTEST_TTL_MS = 60 * 1000;

export class CodeChefSources extends Source {
  constructor() {
    super({ origin: ORIGIN, client });

    /** Memoised: one add reads a contest payload two or three times. */
    this.contest = this.memo(
      (code) => this.#api(`/api/contests/${encodeURIComponent(code)}`),
      { ttlMs: CONTEST_TTL_MS },
    );
  }

  /** CodeChef needs no credentials: one instance serves every session. */
  static fromSettings() {
    return sources;
  }

  /** Test seam: resets pacing and the contest memo between cases. */
  static reset(spacingMs = 0) {
    sources.reset(spacingMs);
  }

  /** Every read here is JSON and wants the same Accept header. */
  #api(path) {
    return this.json(path, { headers: { Accept: "application/json" } });
  }

  /**
   * Difficulty and tags live only here — absent from the contest payload and
   * from every bulk listing, signed in or not. Hence one request per problem.
   */
  problem(contestCode, problemCode) {
    return this.#api(
      `/api/contests/${encodeURIComponent(contestCode)}/problems/${encodeURIComponent(problemCode)}`,
    );
  }

  /**
   * Every problem this account has attempted — the practice page's "Attempted"
   * tab, which is `group=attempted` on the listing endpoint.
   *
   * This is the only source for an upsolve. A contest stops accepting
   * submissions when it ends, so upsolving happens in practice, and neither
   * `problemsstats` nor the per-problem `problem_status` ever sees it.
   *
   * `page` is zero-based, and the rating range must include -1 or unrated
   * problems are filtered out entirely.
   *
   * @param {(message: string) => void} [onProgress]
   * @returns {Promise<object[]>} rows carrying at least `code` and `status`
   */
  async attemptedProblems(onProgress = () => {}) {
    const rows = [];
    let total = null;

    for (let page = 0; total === null || rows.length < total; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort_by: "difficulty_rating",
        sort_order: "asc",
        start_rating: "-1",
        end_rating: "10000",
        group: "attempted",
      });

      const body = await this.#api(`/api/list/problems?${query}`);

      if (total === null) {
        total = Number(body?.count) || 0;
        if (total > MAX_ATTEMPTED) {
          throw new Error(
            `CodeChef returned ${total} problems for an "attempted" query, which means ` +
              "it ignored the filter. Refusing to page the whole catalogue.",
          );
        }
      }

      const batch = body?.data ?? [];
      // A page that comes back empty ends the loop, or a `count` that never
      // matches what the server actually returns would spin forever.
      if (batch.length === 0) break;

      rows.push(...batch);
      onProgress(`Checking CodeChef solves — ${Math.min(rows.length, total)} of ${total}…`);
    }

    return rows;
  }

    /**
   * Who the browser is signed in as, off the lightest page carrying
   * `window.codeChefUserData` (~9 KB, against 84 KB for the homepage, which
   * doesn't carry it at all).
   *
   * @returns {Promise<{username: string, rating: number|null}|null>} null both
   *   when signed out and when the shell no longer carries the bootstrap
   *   object; the platform must not read either as "nothing solved".
   */
  async dashboard() {
    return DashboardPage.scrape(await this.document("/dashboard"));
  }

    }

/**
 * CodeChef needs no credentials of its own — the browser's session *is* the
 * identity — so one instance serves the extension. See `source.js` for why
 * Codeforces is the opposite.
 */
export const sources = new CodeChefSources();

