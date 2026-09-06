/**
 * Everything this extension reads from AtCoder itself.
 *
 * Three routes, and none of them is matched by AtCoder's robots.txt — every
 * directive there ends in a slash (`/contests/*​/standings/`,
 * `/contests/*​/submissions/`), so the list page whose path stops at
 * `submissions` is outside them. `/submissions/me` and per-submission pages are
 * inside, and are deliberately never requested.
 *
 *   /contests/<id>/tasks                      public   name, times, problems
 *   /contests/<id>/submissions?f.User=&f.Status=AC   session  what you solved
 *   /contests/<id>/standings/json             session  the field, for difficulty
 *
 * AtCoder publishes no API of its own — every candidate JSON route 404s, and the
 * site's own client JS makes exactly five AJAX calls, none of which lists
 * submissions. It is a server-rendered Java application, so HTML is not a
 * fallback here; it is the only interface.
 */
import { getPage, getJson } from "./http.js";
import { findContestName, findContestTimes, findTasks } from "./dom-parsers/tasks.js";
import { parseAcceptedTaskIds, parsePageCount } from "./dom-parsers/submissions.js";

const ORIGIN = "https://atcoder.jp";

/** Guards a runaway loop if pagination is ever misread. */
const MAX_SUBMISSION_PAGES = 20;

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

/**
 * A contest's name, schedule and problem list — from one public page.
 *
 * This single request replaces three AtCoder Problems resources, and does the
 * job better: reading a contest's *own* task list sidesteps the reason
 * `contest-problem.json` existed, since a global list only records the contest a
 * problem debuted in.
 *
 * @returns {{name: string, startTimeSeconds: number|null, endTimeSeconds: number|null,
 *            problems: Array<{index: string, problemId: string, name: string}>}|null}
 *   `null` when the page yields no task table — the caller decides whether that
 *   means "not published yet" or something worse.
 */
export async function fetchContestTasks(contestId) {
  const html = await getPage(`${ORIGIN}/contests/${encodeURIComponent(contestId)}/tasks`);
  const doc = parse(html);

  const problems = findTasks(doc);
  if (problems === null) return null;

  const { startTimeSeconds, endTimeSeconds } = findContestTimes(doc);
  return {
    name: findContestName(doc) ?? `Contest ${contestId}`,
    startTimeSeconds,
    endTimeSeconds,
    problems,
  };
}

/**
 * Task ids this handle has an accepted submission for, in one contest.
 *
 * Per contest, because AtCoder has no per-user submission list — the only route
 * to a submission is through the contest that hosted it. That is the one real
 * cost of leaving AtCoder Problems behind: its feed was user-wide, so it also
 * caught a task solved in a *different* contest from the one being tracked.
 *
 * Filtered server-side to accepted submissions, but the verdict is re-read from
 * each row anyway; see `dom-parsers/submissions.js` for why that is not
 * redundant.
 */
export async function fetchAcceptedTaskIds(contestId, handle) {
  const base =
    `${ORIGIN}/contests/${encodeURIComponent(contestId)}/submissions` +
    `?f.User=${encodeURIComponent(handle)}&f.Status=AC`;

  const first = parse(await getPage(base));
  const accepted = parseAcceptedTaskIds(first);

  // A missing table is a layout change, not an empty history. Refuse rather
  // than report "nothing solved", which `solved` being sticky would make
  // permanent-looking.
  if (accepted === null) {
    throw new Error(
      `Couldn't read your AtCoder submissions for ${contestId} — the page layout may have changed.`,
    );
  }

  const pages = Math.min(parsePageCount(first), MAX_SUBMISSION_PAGES);
  for (let page = 2; page <= pages; page++) {
    const next = parseAcceptedTaskIds(parse(await getPage(`${base}&page=${page}`)));
    if (next === null) break;
    for (const id of next) accepted.add(id);
  }

  return accepted;
}

/**
 * The contest's full standings, which is where difficulty comes from.
 *
 * Shape-validated against the schema AtCoder Problems' own `estimator/models.py`
 * declares — a citable spec for a response that cannot be fetched from a shell,
 * which is a better position than the Codeforces scrape, where the markup is
 * only inferred.
 *
 * @returns {{TaskInfo: object[], StandingsData: object[]}|null} `null` when the
 *   payload does not match, so a shape change refuses instead of estimating
 *   from something it does not understand.
 */
export async function fetchStandings(contestId) {
  const payload = await getJson(
    `${ORIGIN}/contests/${encodeURIComponent(contestId)}/standings/json`,
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
