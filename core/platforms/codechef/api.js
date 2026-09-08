/**
 * CodeChef's JSON: the three routes, and what their payloads mean.
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
 * Cookies are sent because the attempted list is per-user; everything else
 * the endpoints return is public.
 *
 *   /api/contests/<code>                     public    the contest and its problems
 *   /api/contests/<code>/problems/<code>     public    difficulty and tags
 *   /api/list/problems?group=attempted       session   what you have attempted
 */
import { Api } from "../api.js";
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

const ORIGIN = "https://www.codechef.com";

/** Human-paced; `scraper.js` names the same site, so both clients queue as one. */
const GAP_MS = 1500;

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

/**
 * Routed through a codechef.com tab when one is open, since the site answers
 * for whoever holds the session cookie.
 *
 * CodeChef's refusal is a 403 — its `/api/` routes are CSRF-gated, and an
 * unauthenticated or rate-limited caller gets one rather than an error body.
 * Note this is *not* how a signed-out session shows up: that returns a
 * perfectly good 200 with the filter ignored, which is why `fetchAccepted`
 * verifies identity rather than trusting the payload.
 */
const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },
  refusal({ response, url }) {
    if (response.status === 403) {
      return new Error(
        "CodeChef refused the request. Open codechef.com in a tab, make sure you're " +
          "signed in, and try again.",
      );
    }
    if (response.ok) return null;
    return new Error(`CodeChef returned ${response.status} for ${new URL(url).pathname}.`);
  },
});

export class CodeChefApi extends Api {
  constructor() {
    super({ origin: ORIGIN, client });

    /** Memoised: one add reads a contest payload two or three times. */
    this.contest = this.memo(
      (code) => this.#get(`/api/contests/${encodeURIComponent(code)}`),
      { ttlMs: CONTEST_TTL_MS },
    );
  }

  /** CodeChef needs no credentials: one instance serves every session. */
  static fromSettings() {
    return api;
  }

  /** Test seam: resets pacing and the contest memo between cases. */
  static reset(spacingMs = 0) {
    api.reset(spacingMs);
  }

  /** Every read here wants the same Accept header. */
  #get(path) {
    return this.json(path, { headers: { Accept: "application/json" } });
  }

  /**
   * Difficulty and tags live only here — absent from the contest payload and
   * from every bulk listing, signed in or not. Hence one request per problem.
   */
  problem(contestCode, problemCode) {
    return this.#get(
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

      const body = await this.#get(`/api/list/problems?${query}`);

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
}

/** CodeChef needs no credentials of its own — the browser's session *is* the identity. */
export const api = new CodeChefApi();

// ---------------------------------------------------------------------------
// What the payloads mean: the difficulty sentinels, the tag noise, the status
// map, and the practice-mirror flag. Pure; `platform.js` decides with them.
// ---------------------------------------------------------------------------

/**
 * `difficulty_rating` arrives as a string and uses two out-of-band values:
 * `-1` for "not rated" (74% of the catalogue) and `9999` for a handful more.
 * Both must become null. `9999` is especially dangerous — it is also the
 * queue's own sort-last sentinel, so passing it through would look like a
 * legitimate, very hard problem.
 */
const NOT_RATED = new Set([-1, 9999]);

/** Setter handles and contest codes get tagged alongside real topics. */
const TAG_NOISE = /^(?:start|cook|ltime|snck)\d+$|_adm$/i;

/**
 * Accepted, from the practice bundle's own status map:
 * `{0: Unattempted, 1: Accepted, 2: Partially Correct, 3: Wrong Answer, …}`.
 *
 * Match this value explicitly rather than "anything but 0" — `solved` is sticky
 * and never cleared, so a false positive hides a problem permanently while a
 * false negative costs one refresh. `2` is Partially Correct and is excluded for
 * the same reason `partially_solved` always was.
 */
export const ACCEPTED = 1;

export function parseDifficulty(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || NOT_RATED.has(value)) return null;
  return value;
}

export function cleanTags(detail, contestCode) {
  const raw = [...(detail?.user_tags ?? []), ...(detail?.computed_tags ?? [])];
  const seen = new Set();

  return raw.filter((tag) => {
    if (typeof tag !== "string") return false;
    const trimmed = tag.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === contestCode.toLowerCase()) return false;
    if (TAG_NOISE.test(trimmed)) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Some old problems were never mirrored into CodeChef's practice archive.
 * `START32C/problems/MAXTHEMIN` still shows its statement inside the contest,
 * but `/problems/MAXTHEMIN` 404s — and a contest stops accepting submissions
 * when it ends, so there is nowhere left to submit it. It is dead work, and
 * because `solved` is only ever set true nothing would ever clear it from the
 * queue.
 *
 * `is_added_to_practice` on the contest payload answers this exactly, and comes
 * free — `fetchContestRecord` already has that payload in hand. Two nearby
 * fields do **not** answer it, so don't reach for them again: `problem_url` is
 * `/problems/MAXTHEMIN` even for the problem that 404s there, and
 * `is_direct_submittable` is false for everything when signed out, since it
 * tracks login state rather than mirroring.
 *
 * The key is written only when the answer is no. Absent means upsolvable, which
 * is every problem on Codeforces and AtCoder — both serve their whole history
 * from a stable per-contest route.
 */
export function practiceFlag(problem) {
  return problem?.is_added_to_practice === false ? { upsolvable: false } : {};
}
