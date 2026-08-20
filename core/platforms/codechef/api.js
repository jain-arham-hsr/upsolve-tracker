/**
 * Client for CodeChef's internal JSON API.
 *
 * CodeChef's public API was retired years ago and the site is an SPA, so the
 * only route to its data is the same `/api/` endpoints the front end calls.
 * That shapes the rules this file follows, all of which are deliberate:
 *
 *  - **Only what a user's own browser would load.** One contest they are
 *    looking at, and its problems. There is no catalogue sweep here and there
 *    must never be one — `/api/list/problems` would make this a crawler.
 *  - **`/api/` paths only.** robots.txt disallows `/problems/*` and
 *    `/status/*`; `/api/` is not mentioned.
 *  - **Never evade a block.** A 403 stops and surfaces an error, exactly as
 *    http-client.js does for Codeforces. No retries, no header games.
 *
 * Cookies are sent because `problemsstats` is per-user; everything else the
 * endpoints return is public.
 */
import { createPacer } from "../../services/request-pacer.js";

const BASE = "https://www.codechef.com";

/** Human-paced. A contest costs 1 + one request per problem. */
const MIN_GAP_MS = 1500;

/** Contest payloads are reused within a single add; nothing is kept long. */
const CONTEST_TTL_MS = 60 * 1000;

const paced = createPacer({ minGapMs: MIN_GAP_MS, credentials: "include" });
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
