/**
 * Whether Codeforces has published an official contest yet — the readiness gate,
 * and now the only thing `problemset.problems` is used for.
 *
 * This module also held `syncOfficialProblemData`, the weekly pass that replaced
 * stored estimates with published ratings. That moved to `published-sync.js` and
 * reads `contest.standings` instead: the problemset files a shared Div. 1 /
 * Div. 2 problem under the originating contest, so for roughly a third of Div. 2
 * rounds it could never supply most of the ratings, and those contests were
 * re-fetched weekly forever without resolving.
 *
 * Asking whether a contest is *present* is a different question from asking what
 * its problems are rated, and the problemset answers the first one well: it is
 * one ~2.3 MB request, memoised for 60 s, against ~6.5 MB per contest.
 */

/**
 * Whether Codeforces has published this contest's problems yet.
 *
 * The publication check for an official round, and only that. **Present does not
 * mean rated**, and an earlier version of this comment claimed it did — that
 * "the 39 contests with nothing rated are April Fools and Testing Rounds that
 * were never going to be". Measured since: 41 of 2,007 contests in the
 * problemset have no rated problem at all, and the newest of them are ordinary
 * recent rounds still waiting on Codeforces. Being present and unrated is a
 * normal stage a round passes through, not an oddity.
 *
 * That does not weaken the gate, because it was never asking about ratings. A
 * contest Codeforces has not published has no problem list to store; one it has
 * published but not rated stores with estimates, which `published-sync.js` then
 * settles. So absence really is the only question worth asking here.
 *
 * Gyms are absent from the problemset entirely and must never be asked.
 */
export async function isInProblemset(cfService, contestId) {
  const problemset = await cfService.getProblemsetProblems();
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some(
    (problem) => String(problem.contestId) === wanted,
  );
}
