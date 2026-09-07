/**
 * What problems an AtCoder contest holds.
 *
 * One public page — `/contests/<id>/tasks` — carries the contest's name, its
 * schedule and every problem with its task id. That single request replaced
 * three AtCoder Problems resources (`contests.json`, `problems.json` and
 * `contest-problem.json`), and reading a contest's own list is also the reason
 * the last of those is no longer needed: a global list records only the contest
 * a problem debuted in, while this page answers for exactly this one.
 *
 * Difficulty is not here. AtCoder publishes none at all, so it is fitted from
 * the contest's standings by `estimator.js` — which is a separate concern with a
 * separate failure mode, and is allowed to fail softly where this is not.
 */
import { fill } from "./estimator.js";
import { notPublishedYet } from "../../contest-status.js";

/** A stuck contest must not cost a standings fetch on every single refresh. */
const MAX_RETRIES_PER_SYNC = 1;

export async function fetchContest({ contestId, session, onProgress = () => {} }) {
  onProgress("Reading the contest's problems…");
  const tasks = await session.sources.contestTasks(contestId);

  // Before a contest ends its task list is not public. That resolves on its own
  // once it finishes, so it waits rather than failing — and it now resolves as
  // soon as the contest is over, rather than whenever a third party got round to
  // indexing it.
  if (tasks === null) {
    return notPublishedYet(
      `AtCoder isn't showing the problems for "${contestId}" yet. A contest that ` +
        `hasn't finished won't list them.`,
    );
  }

  return {
    id: contestId,
    name: tasks.name,
    startTimeSeconds: tasks.startTimeSeconds,
    // Means what it does on the other platforms: when this contest was last
    // asked about. AtCoder publishes no tags, so nothing comes back for those —
    // but `syncMetadata` retries an unrated contest and orders its rotation by
    // this field, so it is stamped here and again on every attempt.
    publishedDataCheckedAt: Date.now(),
    problems: tasks.problems.map((task) => ({
      index: task.index,
      problemId: task.problemId,
      name: task.name,
      // Filled by the estimator, or left null and rendered "???". Never
      // substituted with a number.
      rating: null,
      ratingSource: null,
    })),
  };
}

/**
 * Rate contests that were added without a readable field.
 *
 * Adding a contest while signed out stores every problem unrated, which is
 * recoverable rather than permanent — this picks them up later. Difficulty never
 * changes once a contest has ended, so a contest that *is* rated is never
 * re-read.
 *
 * **Capped at one contest per refresh.** A standings payload is around a
 * megabyte, and a contest that can never be rated — one too old for AtCoder to
 * hold a usable field — would otherwise levy that cost forever.
 *
 * The Codeforces re-check deliberately has **no** such cap, which is worth not
 * copying back. It stops asking about a contest six weeks after the round ran,
 * and a cap on top of a cutoff starves: a contest that keeps losing its turn
 * ages out before it ever converges. AtCoder has no cutoff — a contest stays
 * eligible for as long as it has an unrated problem — so here the cap is what
 * bounds the cost, and rotation is what keeps it fair.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  // **Longest-unasked first**, and that ordering is what makes the cap safe.
  // This used to slice the filtered array in stored order, so `unrated[0]` was
  // retried on every refresh and everything behind it was never tried at all —
  // and the case the cap exists for, a contest too old for AtCoder to hold a
  // usable field, is exactly a contest that sits at index 0 forever.
  const unrated = contests
    .filter((contest) => contest.problems.some((problem) => problem.rating === null))
    .sort((a, b) => (a.publishedDataCheckedAt ?? 0) - (b.publishedDataCheckedAt ?? 0));

  if (unrated.length === 0) return 0;

  let resolved = 0;
  for (const contest of unrated.slice(0, MAX_RETRIES_PER_SYNC)) {
    const before = contest.problems.filter((p) => p.rating !== null).length;
    await fill({ contest, session, onProgress });

    // Stamped on the **attempt**, not on success — `fill` swallows its own
    // failures and returns, so there is no throw to distinguish them by anyway.
    // Stamping only on success would leave a contest that can never be rated
    // holding its original timestamp, first in the sort forever, which is the
    // starvation this ordering fixes.
    //
    // `published-sync.js` does the opposite and stamps only on success. The rule
    // follows from whether the platform rations its attempts: Codeforces has no
    // cap, so an unstamped failure merely retries sooner and costs nothing;
    // here it would monopolise the single slot.
    contest.publishedDataCheckedAt = Date.now();

    resolved += contest.problems.filter((p) => p.rating !== null).length - before;
  }

  if (resolved > 0) {
    console.log(`[AtCoder] ${resolved} problem(s) gained an estimated difficulty.`);
  }
  return resolved;
}
