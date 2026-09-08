/**
 * AtCoder's JSON: one route, and the reading of it.
 *
 * AtCoder publishes no API of its own — every candidate JSON route 404s, and
 * the site's own client JS makes exactly five AJAX calls, none of which lists
 * submissions. It is a server-rendered Java application, so `scraper.js`
 * carries most of this site. What is JSON is the one thing that matters most:
 * `standings/json`, the field every difficulty here is fitted from.
 *
 *   /contests/<id>/standings/json    session    the field, for difficulty
 *
 * Not matched by AtCoder's robots.txt — every directive there ends in a slash
 * (`/contests/*​/standings/`), and this path does not.
 *
 * ## Reading the standings
 *
 * The second half of this file turns the payload into what `estimator.js`
 * fits: per task, who is in the dataset and whether each of them solved it.
 * It is a port of the filters in AtCoder Problems' `estimator/main.py`,
 * deliberately faithful rather than merely equivalent — each one changes the
 * answer, and an approximation would be a different estimator wearing its
 * name. `tests/platforms/atcoder/estimator.test.js` pins the fit against
 * values produced by running that Python verbatim.
 *
 * Two things from the source are deliberately not ported. **The time model**
 * predicts how long a solve takes, which nothing here consumes. **`rating.py`'s
 * rating replay** re-derives every user's rating by replaying AtCoder's whole
 * history, and exists only for contests predating the rating system — which
 * would need every contest's standings, exactly the bulk crawl this design
 * avoids. On such a contest `OldRating` is 0 for everyone, the recurring
 * filter empties the dataset, and no estimate is produced.
 */
import { Api } from "../api.js";
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

export const ORIGIN = "https://atcoder.jp";

/** Human-paced; `scraper.js` names the same site, so both clients queue as one. */
const GAP_MS = 1500;

/**
 * Routed through an atcoder.jp tab when one is open: the standings are
 * login-gated, and a cross-site request carries no cookies.
 *
 * **AtCoder refuses by succeeding.** `fetch` follows the 302 transparently,
 * so a signed-out request arrives as a healthy 200 whose body is the sign-in
 * form — which `standings` would then read as "not the shape I know". Caught
 * by checking where we actually landed rather than what the status says.
 */
const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },
  refusal({ response, url }) {
    if (new URL(response.url).pathname === "/login") {
      return Object.assign(
        new Error(
          "AtCoder is not signed in, so the standings can't be read. " +
            "Open atcoder.jp, sign in, and refresh.",
        ),
        { isNotSignedIn: true, url },
      );
    }
    if (response.ok) return null;
    return Object.assign(
      new Error(`AtCoder returned ${response.status} for ${new URL(url).pathname}.`),
      { status: response.status },
    );
  },
});

export class AtCoderApi extends Api {
  constructor() {
    super({ origin: ORIGIN, client });
  }

  /** AtCoder needs no credentials: one instance serves every session. */
  static fromSettings() {
    return api;
  }

  /** Test seam: resets pacing between cases. */
  static reset(spacingMs = 0) {
    api.reset(spacingMs);
  }

  /**
   * The contest's full standings, which is where difficulty comes from.
   *
   * Shape-validated against the schema AtCoder Problems' own
   * `estimator/models.py` declares — a citable spec for a response that cannot
   * be fetched from a shell.
   *
   * @returns {{TaskInfo: object[], StandingsData: object[]}|null} `null` when
   *   the payload does not match, so a shape change refuses instead of
   *   estimating from something it does not understand.
   */
  async standings(contestId) {
    const payload = await this.json(`/contests/${encodeURIComponent(contestId)}/standings/json`);

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

/** AtCoder needs no credentials — only a handle, which is a parameter to the routes. */
export const api = new AtCoderApi();

// ---------------------------------------------------------------------------
// Standings → the datasets the fit runs against. Pure, and the part of the
// port that must not be simplified: each filter changes the answer.
// ---------------------------------------------------------------------------

/**
 * What `estimator.js` takes: one dataset per task, omitting tasks with nobody
 * usable to fit against.
 *
 * @returns {Array<{taskId: string, abilities: Array<{rating: number, weight: number}>,
 *   responses: number[], modelsNonAttempts: boolean}>}
 */
export function field(standings) {
  const rows = buildRows(standings);
  return standings.TaskInfo.map((task) => dataset(rows, task.TaskScreenName)).filter(Boolean);
}

/**
 * Who a task is fitted against, and whether each of them solved it.
 *
 * @returns {object|null} null when nobody usable is left to fit against —
 *   which `canEstimate: true` then turns into a loud refusal rather than a
 *   silent `???`.
 */
export function dataset(rows, taskId) {
  // The best score anyone actually achieved — not a declared maximum from
  // TaskInfo, which is a different number and would change every answer.
  const maxScore = Math.max(...rows.map((row) => row.scores.get(taskId) ?? 0), 0);

  const isAccepted = (row) =>
    (row.accepted.get(taskId) ?? 0) === 1 && (row.scores.get(taskId) ?? 0) === maxScore ? 1 : 0;

  // First-timers have no meaningful rating to fit against.
  const recurring = rows.filter((row) => row.previousContests > 0 && row.rating > 0);

  // `selectDataset` narrows further for ABC's easy pair — to rated entrants
  // only — which an *unrated* contest empties completely. Fall back to the
  // wider set rather than refusing: a noisier fit still beats no answer.
  const narrowed = selectDataset(recurring, taskId);
  const chosen = narrowed.length > 0 ? narrowed : recurring;
  if (chosen.length === 0) return null;

  return {
    taskId,
    abilities: toAbilities(chosen),
    responses: chosen.map(isAccepted),
    // AGC's first problem keeps retreated entrants in the dataset, so its
    // non-attempts have to be modelled rather than read as failures. The
    // estimator picks its model from this fact.
    modelsNonAttempts: isAgcFirstProblem(taskId),
  };
}

/**
 * One row per entrant, carrying every task.
 *
 * **This is the part that must not be simplified.** Every participant appears
 * in every task's dataset, including the ones they never opened — those are
 * the negative samples, and without them the fit sees only people who engaged
 * and reads every problem as far easier than it is. It is also exactly the
 * "model attempts, not ability" change that
 * `tests/platforms/codeforces/estimator-accuracy.test.js` records as measured
 * and wrong for Codeforces: mean error 213 → 374.
 */
export function buildRows(standings) {
  return standings.StandingsData.map((entry) => {
    const scores = new Map();
    const accepted = new Map();

    for (const [taskId, result] of Object.entries(entry.TaskResults ?? {})) {
      const score = result?.Score ?? 0;
      scores.set(taskId, score);
      // Status is consulted only when the score is positive, matching the
      // source: a zero-scoring row is not accepted whatever its status says.
      accepted.set(taskId, score > 0 && result?.Status === 1 ? 1 : 0);
    }

    return {
      rating: entry.OldRating ?? 0,
      previousContests: entry.Competitions ?? 0,
      isRated: Boolean(entry.IsRated),
      // Entered and never submitted. They say nothing about difficulty, so they
      // are excluded everywhere except AGC's first problem.
      retreated: (entry.TotalResult?.Count ?? 0) === 0,
      scores,
      accepted,
    };
  });
}

/**
 * Which entrants a task is fitted against.
 *
 * Two hand-tuned exceptions, carried across from the source because dropping
 * them would silently change the numbers:
 *
 *   - **ABC's A and B, from abc042 on.** Strong contestants often skip them
 *     entirely, so their non-solves are not evidence of difficulty. Restricted
 *     to rated entrants who actually submitted something.
 *   - **AGC's first problem.** Its negative samples are unreliable in the other
 *     direction, so retreated entrants stay in and the non-attempt rate is
 *     fitted explicitly instead.
 *
 * Keyed on the **task id**, never the displayed index: in a daily-training
 * rerun `abc432_c` is listed as problem E, and only the id keeps an easy ABC-A
 * classified as one wherever it reappears.
 *
 * @param recurring entrants with a usable prior rating — see `dataset`.
 */
export function selectDataset(recurring, taskId) {
  if (isVeryEasyProblem(taskId)) {
    return recurring.filter((row) => row.isRated && !row.retreated);
  }
  if (isAgcFirstProblem(taskId)) {
    return recurring;
  }
  return recurring.filter((row) => !row.retreated);
}

/**
 * The abilities the fit runs against — the AtCoder analogue of a Codeforces
 * rating distribution, minus the strata, since a contest's own standings are
 * always read whole and there is nothing to scale up from.
 */
export function toAbilities(chosen) {
  return chosen.map((row) => ({
    rating: inverseAdjustRating(row.rating, row.previousContests),
    weight: 1,
  }));
}

function isVeryEasyProblem(taskId) {
  if (!taskId.startsWith("abc")) return false;
  const last = taskId[taskId.length - 1];
  if (last !== "a" && last !== "b") return false;
  return Number(taskId.slice(3, 6)) >= 42;
}

export function isAgcFirstProblem(taskId) {
  return taskId.startsWith("agc") && taskId.endsWith("_a");
}

/**
 * Recover the rating AtCoder would show a settled account.
 *
 * AtCoder heavily discounts a new competitor's displayed rating — by design, to
 * avoid overstating a small sample. Fitting against the displayed number would
 * measure that discount rather than ability, so it is reversed first. This is
 * the inverse of the adjustment in AtCoder's own rating formula.
 */
export function inverseAdjustRating(rating, previousContests) {
  if (rating <= 0) return NaN;

  let adjusted = rating;
  if (adjusted <= 400) adjusted = 400 * (1 - Math.log(400 / adjusted));

  const correction =
    ((Math.sqrt(1 - Math.pow(0.9, 2 * previousContests)) /
      (1 - Math.pow(0.9, previousContests)) -
      1) /
      (Math.sqrt(19) - 1)) *
    1200;

  return adjusted + correction;
}
