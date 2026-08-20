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
 */
import { platformOf } from "./platforms/registry.js";

export function collectPendingProblems(contests) {
  const byKey = new Map();

  for (const contest of contests ?? []) {
    const platform = platformOf(contest);

    for (const problem of contest.problems ?? []) {
      if (problem.solved) continue;

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
