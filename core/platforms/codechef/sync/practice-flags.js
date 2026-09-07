/**
 * Whether a problem can still be submitted at all.
 *
 * A CodeChef contest stops accepting submissions when it ends, so upsolving
 * happens at `/problems/<CODE>` — and some older problems were never mirrored
 * there. Its own file rather than a section of `published-sync.js`, because the
 * two re-checks that `syncMetadata` runs differ in every way that matters:
 * this one runs on **every** refresh, writes in **both** directions, and is
 * bounded by the contests already carrying a flag rather than by a timestamp.
 * Sharing a file invites sharing a gate, and the slower pass would then
 * suppress the faster.
 */

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

/**
 * Re-reads `is_added_to_practice` for contests that might have it wrong.
 *
 * Writes in both directions — a problem CodeChef later mirrors has to come back
 * to the queue, so this cannot be write-once the way `solved` is.
 *
 * Two reasons it runs on every refresh rather than on the weekly stamp. A
 * wrongly-flagged problem would otherwise sit out of the queue for a week; and
 * a contest added *hours* after it ends may
 * plausibly report every problem as unmirrored simply because CodeChef has not
 * got to them yet, which would empty the queue for exactly the contest you most
 * want to upsolve. Per-refresh means that self-corrects on the next one.
 * (Unconfirmed: the freshest contests reachable when this was written —
 * START252D and DSAMONDAY016, four and six days old — already reported every
 * problem mirrored, so the delay could not be reproduced.)
 *
 * The cost is bounded by the selection: a contest is asked about only while it
 * still carries a flagged problem, so a fully-mirrored queue — which is the
 * normal case — costs nothing at all. Reading the **contest** payload rather
 * than the per-problem endpoint is what makes even the flagged case cheap: one
 * request per affected contest, against one per affected *problem*. `sources.contest`
 * is memoised for a minute on top of that.
 *
 * Note this deliberately never re-checks a contest with nothing flagged. The
 * only thing that would find is CodeChef *removing* a problem from practice,
 * which does not happen; paying a request per contest per refresh to look for
 * it would be the sweep this client exists to avoid.
 */
export async function refreshPracticeFlags(session, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) =>
    contest.problems.some((problem) => problem.upsolvable === false),
  );
  if (pending.length === 0) return 0;

  let changed = 0;

  for (const contest of pending) {
    try {
      const payload = await session.sources.contest(contest.id);
      const problems = payload?.problems ?? {};

      for (const problem of contest.problems) {
        const entry = problems[problem.index];
        // A problem missing from the payload tells us nothing — keep what we
        // already knew rather than guessing it back into the queue.
        if (!entry) continue;

        const wasUpsolvable = problem.upsolvable !== false;
        const isUpsolvable = entry.is_added_to_practice !== false;
        if (wasUpsolvable === isUpsolvable) continue;

        // Deleted rather than set true, so the stored shape stays "present only
        // when it means something" — the same rule buildProblem writes under.
        if (isUpsolvable) delete problem.upsolvable;
        else problem.upsolvable = false;

        onProgress(
          isUpsolvable
            ? `${problem.index} is on practice now…`
            : `${problem.index} isn't on practice…`,
        );
        changed++;
      }
    } catch (error) {
      console.warn(
        `[CodeChef] practice re-check of ${contest.id} failed:`,
        error.message,
      );
    }
  }

  return changed;
}
