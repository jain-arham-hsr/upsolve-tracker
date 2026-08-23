/**
 * The unsolved problems across every tracked contest, deduplicated.
 *
 * Deduplication is not cosmetic. The same problem genuinely belongs to several
 * contests on two of the three platforms:
 *
 *  - a CodeChef Starters runs the same problem in all four divisions, so
 *    tracking Div 3 and Div 4 duplicates every shared problem;
 *  - 1,906 of AtCoder's 9,383 problems appear in more than one contest, and
 *    daily-training rounds are mostly reruns of earlier ones.
 *
 * Each platform's `problemKey` decides identity: task id on AtCoder, problem
 * code on CodeChef, contest+index on Codeforces, where a problem really does
 * belong to exactly one contest.
 *
 * When the same problem shows up twice, the occurrence from the **newer**
 * contest wins — that is the one the user most likely just competed in, and so
 * the more useful link.
 *
 * A problem marked `upsolvable: false` is dropped by default. It is not work
 * you can do: CodeChef never mirrored it to practice, so there is nowhere left
 * to submit it (see `platforms/codechef/adapter.js`). Excluding it here rather
 * than in each view is what keeps the queue, the platform ring and both stats
 * histograms agreeing on what "pending" means. The contest expansion is the one
 * caller that opts back in, since hiding the row there would make the contest
 * look shorter than it is.
 */
import { platformOf } from "./platforms/registry.js";

export function collectPendingProblems(contests, { includeUnupsolvable = false } = {}) {
  const byKey = new Map();

  for (const contest of contests ?? []) {
    const platform = platformOf(contest);

    for (const problem of contest.problems ?? []) {
      if (problem.solved) continue;
      // `=== false`, not falsy: the key is absent on every problem that can be
      // upsolved, which is all of them on Codeforces and AtCoder.
      if (!includeUnupsolvable && problem.upsolvable === false) continue;

      const key = platform.problemKey(contest, problem);
      const existing = byKey.get(key);
      if (existing && startedAt(existing.contest) >= startedAt(contest)) continue;

      byKey.set(key, { contest, platform, problem });
    }
  }

  return [...byKey.values()];
}

function startedAt(contest) {
  return contest?.startTimeSeconds ?? -Infinity;
}
