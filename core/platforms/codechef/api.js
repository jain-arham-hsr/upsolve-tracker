/**
 * Client for CodeChef's internal JSON API.
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
 *    codeforces/http.js does for Codeforces. No retries, no header games.
 *
 * Cookies are sent because `problemsstats` is per-user; everything else the
 * endpoints return is public.
 */
import { createPacer } from "../../services/request-pacer.js";

const BASE = "https://www.codechef.com";

/** Human-paced. A contest costs 1 + one request per problem. */
const MIN_GAP_MS = 1500;

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

const paced = createPacer({ gapMs: MIN_GAP_MS, credentials: "include" });
const contestCache = new Map();

async function getJson(path) {
  const response = await paced(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (response.status === 403) {
    throw new Error(
      "CodeChef refused the request. Open codechef.com in a tab, make sure you're " +
        "signed in, and try again.",
    );
  }
  if (!response.ok) {
    throw new Error(`CodeChef returned ${response.status} for ${path}.`);
  }
  return response.json();
}

export async function getContest(code) {
  const cached = contestCache.get(code);
  if (cached && Date.now() - cached.at < CONTEST_TTL_MS) return cached.body;

  const body = await getJson(`/api/contests/${encodeURIComponent(code)}`);
  contestCache.set(code, { body, at: Date.now() });
  return body;
}

/**
 * Difficulty and tags live only here — absent from the contest payload and
 * from every bulk listing, signed in or not. Hence one request per problem.
 */
export function getProblem(contestCode, problemCode) {
  return getJson(
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
export async function getAttemptedProblems(onProgress = () => {}) {
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

    const body = await getJson(`/api/list/problems?${query}`);

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
 * The lightest page carrying `window.codeChefUserData`: ~9 KB, against 84 KB
 * for the homepage, which doesn't carry it at all.
 */
export async function getDashboardHtml() {
  const response = await paced(`${BASE}/dashboard`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`CodeChef returned ${response.status} for the dashboard.`);
  }
  return response.text();
}

/** Test seam. */
export function resetApiState() {
  contestCache.clear();
  paced.reset();
  paced.setSpacing(0);
}
