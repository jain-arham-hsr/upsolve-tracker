/**
 * Everything this extension reads from AtCoder — the client and its three routes.
 *
 * Named `sources.js` rather than `scraping.js` because scraping is what
 * `scrapers/` does: turning markup into facts. This half fetches, and one of the
 * three routes below is JSON, so "scraping" was wrong twice over.
 *
 * `Source` supplies the client plumbing — path joining, `text`/`json`/`document`,
 * the memo and the reset seam. What each route owns is its URL, how many requests
 * it takes, what an unusable answer means for it, and what the caller gets back.
 * Those differ per route even on one site: `contestTasks` returns null so the
 * contest waits, while `acceptedTaskIds` throws, because `solved` is sticky and a
 * silent empty would strand the queue permanently.
 *
 * Three routes, and none of them is matched by AtCoder's robots.txt — every
 * directive there ends in a slash (`/contests/*​/standings/`,
 * `/contests/*​/submissions/`), so the list page whose path stops at
 * `submissions` is outside them. `/submissions/me` and per-submission pages are
 * inside, and are deliberately never requested.
 *
 *   /contests/<id>/tasks                             public   name, times, problems
 *   /contests/<id>/submissions?f.User=&f.Status=AC   session  what you solved
 *   /contests/<id>/standings/json                    session  the field, for difficulty
 *
 * AtCoder publishes no API of its own — every candidate JSON route 404s, and the
 * site's own client JS makes exactly five AJAX calls, none of which lists
 * submissions. It is a server-rendered Java application, so HTML is not a
 * fallback here; it is the only interface.
 */
import { Source } from "../source.js";
import { createSiteClient } from "../../services/site-client.js";
import { atcoder } from "./descriptor.js";
import { TasksPage } from "./scrapers/tasks.js";
import { SubmissionsPage } from "./scrapers/submissions.js";

const ORIGIN = "https://atcoder.jp";
const MIN_GAP_MS = 1500;

/** Guards a runaway loop if pagination is ever misread. */
const MAX_SUBMISSION_PAGES = 20;

/** Thrown rather than returned, so no caller can mistake it for "nothing found". */
export class NotSignedInError extends Error {
  constructor(url) {
    super(
      "AtCoder is not signed in, so your submissions can't be read. " +
        "Open atcoder.jp, sign in, and refresh.",
    );
    this.name = "NotSignedInError";
    this.isNotSignedIn = true;
    this.url = url;
  }
}

class AtCoderSources extends Source {
  constructor() {
    super({
      origin: ORIGIN,
      client: createSiteClient({
        // Both the submissions list and standings/json are login-gated, and a
        // cross-site request carries no cookies — so without a tab open on
        // atcoder.jp those two answer with a sign-in form, and `refusal` says so.
        site: atcoder,
        pacer: { gapMs: MIN_GAP_MS },

        /**
         * **AtCoder refuses by succeeding.** `fetch` follows the 302
         * transparently, so a signed-out request arrives as a healthy 200 whose
         * body is the sign-in form. Scraping that yields no submissions —
         * indistinguishable from having solved nothing — and `solved` is sticky,
         * so a swallowed refusal would look like a healthy sync while quietly
         * stranding the queue. Caught by checking where we actually landed
         * rather than what the status says.
         */
        refusal({ response, url }) {
          if (new URL(response.url).pathname === "/login") return new NotSignedInError(url);
          if (response.ok) return null;

          // The status rides along so a caller can say something better than
          // this: `identity.js` turns a 404 into "AtCoder has no user X", which
          // is the difference between a typo and an outage.
          return Object.assign(
            new Error(`AtCoder returned ${response.status} for ${new URL(url).pathname}.`),
            { status: response.status },
          );
        },
      }),
    });
  }

  /**
   * A contest's name, schedule and problem list — from one public page.
   *
   * This single request replaces three AtCoder Problems resources, and does the
   * job better: reading a contest's *own* task list sidesteps the reason
   * `contest-problem.json` existed, since a global list only records the contest
   * a problem debuted in.
   *
   * @returns {{name: string, startTimeSeconds: number|null, endTimeSeconds: number|null,
   *            problems: Array<{index: string, problemId: string, name: string}>}|null}
   *   `null` when the page yields no task table — the caller decides whether that
   *   means "not published yet" or something worse.
   */
  async contestTasks(contestId) {
    const doc = await this.document(`/contests/${encodeURIComponent(contestId)}/tasks`);

    const page = TasksPage.scrape(doc);
    if (page === null) return null;

    // Only the display fallback is left here: a scraper returns null rather than
    // inventing a name, so choosing what to show instead is the caller's.
    return { ...page, name: page.name ?? `Contest ${contestId}` };
  }

  /**
   * Task ids this handle has an accepted submission for, in one contest.
   *
   * Per contest, because AtCoder has no per-user submission list — the only
   * route to a submission is through the contest that hosted it. That is the one
   * real cost of leaving AtCoder Problems behind: its feed was user-wide, so it
   * also caught a task solved in a *different* contest from the one tracked.
   *
   * Filtered server-side to accepted submissions, but the verdict is re-read
   * from each row anyway; see `scrapers/submissions.js` for why that is not
   * redundant.
   */
  async acceptedTaskIds(contestId, handle) {
    const base =
      `/contests/${encodeURIComponent(contestId)}/submissions` +
      `?f.User=${encodeURIComponent(handle)}&f.Status=AC`;

    const first = SubmissionsPage.scrape(await this.document(base));

    // A missing table is a layout change, not an empty history. Refuse rather
    // than report "nothing solved", which `solved` being sticky would make
    // permanent-looking.
    if (first === null) {
      throw new Error(
        `Couldn't read your AtCoder submissions for ${contestId} — the page layout may have changed.`,
      );
    }

    const accepted = first.acceptedTaskIds;
    const pages = Math.min(first.pageCount, MAX_SUBMISSION_PAGES);

    for (let page = 2; page <= pages; page++) {
      // Only page one is asked how many pages there are; the rest add ids.
      const next = SubmissionsPage.scrape(await this.document(`${base}&page=${page}`));
      if (next === null) break;
      for (const id of next.acceptedTaskIds) accepted.add(id);
    }

    return accepted;
  }

  /**
   * The contest's full standings, which is where difficulty comes from.
   *
   * Shape-validated against the schema AtCoder Problems' own
   * `estimator/models.py` declares — a citable spec for a response that cannot
   * be fetched from a shell, which is a better position than the Codeforces
   * scrape, where the markup is only inferred.
   *
   * @returns {{TaskInfo: object[], StandingsData: object[]}|null} `null` when the
   *   payload does not match, so a shape change refuses instead of estimating
   *   from something it does not understand.
   */
  async standings(contestId) {
    const payload = await this.json(
      `/contests/${encodeURIComponent(contestId)}/standings/json`,
    );

    if (!Array.isArray(payload?.TaskInfo) || !Array.isArray(payload?.StandingsData)) {
      return null;
    }

    const row = payload.StandingsData[0];
    if (row && (typeof row.OldRating !== "number" || typeof row.TaskResults !== "object")) {
      return null;
    }

    return payload;
  }
}

/**
 * AtCoder needs no credentials — only a handle, which is a *parameter* to the
 * routes rather than state on the client. So one instance serves the whole
 * extension and callers never write `new`. Codeforces is the opposite; see
 * `source.js`.
 */
export const sources = new AtCoderSources();

/** Test seam: resets pacing between cases. Production always uses MIN_GAP_MS. */
export const resetHttpState = (ms = MIN_GAP_MS) => sources.reset(ms);
