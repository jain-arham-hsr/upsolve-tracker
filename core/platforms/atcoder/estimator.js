/**
 * AtCoder difficulty, fitted locally from a contest's own standings.
 *
 * A port of AtCoder Problems' `estimator/main.py`, deliberately faithful rather
 * than merely equivalent: the filters below are not incidental cleanup, each one
 * changes the answer, and an approximation would be a different estimator
 * wearing its name. `tests/rating-models.test.js` pins the fit against values
 * produced by running that Python verbatim.
 *
 * AtCoder publishes **no difficulty of its own**, anywhere. This is the reason
 * every rating on this platform is stored as `ratingSource: "estimated"`.
 *
 * ## Two things from the source are deliberately not ported
 *
 * **The time model** (`slope`/`intercept`/`variance`) predicts how long a solve
 * takes, which nothing here consumes. Leaving it out is why only six fields are
 * read per row rather than the ten the source touches.
 *
 * **`rating.py`'s rating replay.** It re-derives every user's rating by
 * replaying AtCoder's whole history, and exists only for contests predating the
 * rating system — which would need every contest's standings, exactly the bulk
 * crawl this design avoids. No special case is needed: on such a contest
 * `OldRating` is 0 for everyone, the recurring-entrant filter empties the
 * dataset, the 40-row guard fires, and no estimate is produced. Those are
 * precisely the problems AtCoder Problems itself flags as experimental.
 */
import { sourceUnreachable } from "../../contest-status.js";
import { fitDifficulty } from "../../rating-models/rasch.js";
import { fitWithUpperAsymptote } from "../../rating-models/rasch-upper-asymptote.js";
import { fetchStandings } from "./scraping.js";
import { buildRows, selectDataset, toAbilities, isAgcFirstProblem } from "./field.js";

/** AtCoder's own scale: base 6 over 400, the same constants its ratings use. */
const SCALE = { base: 6, divisor: 400, lo: -10000, hi: 10000 };

/** A fit above this is clamped: past here the scale stops meaning anything. */
const MAX_DIFFICULTY = 6000;

/**
 * The trunk's estimator hand-off.
 *
 * **Failure here is soft, on purpose.** Standings need a session, and a
 * signed-out user must still be able to add a contest — it simply stores
 * `rating: null`, renders `???`, and fills in on a later refresh. That is the
 * existing, documented meaning of an unrated AtCoder problem, so nothing new is
 * introduced. Note the opposite choice is made for *submissions*, which fail
 * loudly: a missing difficulty is visible in the queue, a missing solve is not.
 */
export async function fill({ contest, onProgress = () => {} }) {
  let standings = null;
  try {
    onProgress("Reading the standings…");
    standings = await fetchStandings(contest.id);
  } catch (error) {
    // **Not the same as "this problem has no difficulty".** Signed out, the
    // refusal hook turns AtCoder's `/login` redirect into a throw; a network
    // fault lands here too. Either way we failed to *ask*, so the contest waits
    // and retries rather than storing a queue of `???` that a tab would have
    // filled — which is what `sourceUnreachable` is defined for.
    //
    // This became load-bearing when `canEstimate` went true: without it an
    // unread contest reaches contest-manager's null check and fails the add
    // outright, when the honest answer is "come back with a session".
    return sourceUnreachable(
      `Couldn't read AtCoder's standings for ${contest.id}: ${error.message}. ` +
        `Open atcoder.jp in a tab and refresh — difficulty is worked out from ` +
        `the standings, which need you signed in.`,
    );
  }

  if (standings === null) {
    return sourceUnreachable(
      `AtCoder's standings for ${contest.id} were not in the expected shape, so ` +
        `there is no field to fit against yet.`,
    );
  }

  onProgress("Estimating problem difficulty…");
  const difficulties = estimateContest(standings);

  let rated = 0;
  for (const problem of contest.problems) {
    const difficulty = difficulties.get(problem.problemId);
    if (typeof difficulty !== "number") continue;
    problem.rating = difficulty;
    problem.ratingSource = "estimated";
    rated++;
  }

  console.log(`[AtCoder] Estimated ${rated}/${contest.problems.length} difficulties.`);
}

/**
 * Fit every task in a standings payload.
 *
 * Pure, so the whole algorithm tests without a network stack — the same reason
 * `codeforces/contest-submissions.js` is shaped this way.
 *
 * @returns {Map<string, number>} task id → difficulty, omitting refusals.
 */
export function estimateContest(standings) {
  const rows = buildRows(standings);
  const results = new Map();

  for (const task of standings.TaskInfo) {
    const difficulty = fitTask(rows, task.TaskScreenName);
    if (difficulty !== null) results.set(task.TaskScreenName, difficulty);
  }

  return results;
}

/**
 * Fit one task, and **always answer where there is anyone to answer from**.
 *
 * ## Why this diverges from the source
 *
 * AtCoder Problems refuses in four situations: nobody solved it, everyone solved
 * it, fewer than forty usable rows, or a fit above the ceiling. Ported
 * faithfully, that meant AtCoder problems could render `???` while the identical
 * situation on Codeforces produced a number — `codeforces-official/estimator.js`
 * targets 0.5 expected solves when nobody solved a problem and lets the search
 * run to its ceiling, and floors the result rather than declining.
 *
 * Same maths, opposite policy, and the refusal is the weaker half: a `???` says
 * less than a bound does, cannot be acted on, and is indistinguishable from
 * "we never read the standings". So each refusal becomes the bound Codeforces
 * already gives.
 *
 * **The port guarantee is untouched.** What was ported is the *model* —
 * `rating-models/rasch.js` and `rasch-upper-asymptote.js` — and that is pinned
 * against the Python's own output by `tests/rating-models.test.js`, which must
 * keep passing unchanged. What changes here is the policy wrapped around it,
 * which was always ours.
 *
 * @returns {number|null} null only when the standings contain nobody usable to
 *   fit against at all, which `canEstimate: true` then turns into a loud
 *   refusal rather than a silent `???`.
 */
function fitTask(rows, taskId) {
  // The best score anyone actually achieved — not a declared maximum from
  // TaskInfo, which is a different number and would change every answer.
  const maxScore = Math.max(...rows.map((row) => row.scores.get(taskId) ?? 0), 0);

  const isAccepted = (row) =>
    (row.accepted.get(taskId) ?? 0) === 1 && (row.scores.get(taskId) ?? 0) === maxScore
      ? 1
      : 0;

  // First-timers have no meaningful rating to fit against.
  const recurring = rows.filter((row) => row.previousContests > 0 && row.rating > 0);

  // `selectDataset` narrows further for ABC's easy pair — to rated entrants
  // only — which an *unrated* contest empties completely. Fall back to the
  // wider set rather than refusing: a noisier fit still beats no answer.
  const narrowed = selectDataset(recurring, taskId);
  const dataset = narrowed.length > 0 ? narrowed : recurring;
  if (dataset.length === 0) return null;

  const responses = dataset.map(isAccepted);
  const solved = responses.reduce((sum, y) => sum + y, 0);

  // **Nobody solved it, or everyone did.** The likelihood is then monotonic —
  // no difficulty explains the data better than any other beyond some point —
  // so the honest answer is a bound rather than a value. Aiming half a solve
  // inside the range picks that bound out, which is exactly what Codeforces
  // does for its own zero-solve case.
  const degenerate = solved === 0 || solved === responses.length;
  const target = solved === 0 ? 0.5 : solved === responses.length ? solved - 0.5 : solved;

  const abilities = toAbilities(dataset);

  // The upper-asymptote model fits a non-attempt rate from the spread of
  // responses, so it has nothing to work with when they are all identical.
  const difficulty =
    isAgcFirstProblem(taskId) && !degenerate
      ? fitWithUpperAsymptote({ abilities, responses, ...SCALE }).difficulty
      : fitDifficulty({ abilities, solveCount: target, ...SCALE, integer: true });

  // Clamped, not discarded: a fit above the ceiling still means "harder than
  // anything on this scale", which orders correctly.
  return Math.min(difficulty, MAX_DIFFICULTY);
}
