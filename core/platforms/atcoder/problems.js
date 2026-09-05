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
import { fetchContestTasks } from "./scraping.js";
import { fill } from "./estimator.js";
import { notPublishedYet } from "../../contest-status.js";

/** A stuck contest must not cost a standings fetch on every single refresh. */
const MAX_RETRIES_PER_SYNC = 1;

export async function fetchContest({ contestId, onProgress = () => {} }) {
  onProgress("Reading the contest's problems…");
  const tasks = await fetchContestTasks(contestId);

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
    // AtCoder publishes no tags at all, so there is nothing to come back for.
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
 * hold a usable field — would otherwise levy that cost forever. The same
 * reasoning caps the Codeforces tag sync at one request per sync.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  const unrated = contests.filter((contest) =>
    contest.problems.some((problem) => problem.rating === null),
  );
  if (unrated.length === 0) return 0;

  let resolved = 0;
  for (const contest of unrated.slice(0, MAX_RETRIES_PER_SYNC)) {
    const before = contest.problems.filter((p) => p.rating !== null).length;
    await fill({ contest, session, onProgress });
    resolved += contest.problems.filter((p) => p.rating !== null).length - before;
  }

  if (resolved > 0) {
    console.log(`[AtCoder] ${resolved} problem(s) gained an estimated difficulty.`);
  }
  return resolved;
}
