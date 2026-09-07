/**
 * What you have solved on AtCoder.
 *
 * Read per **contest**, unlike Codeforces and CodeChef, because AtCoder has no
 * per-user submission list — every candidate route 404s, and the only way to a
 * submission is through the contest that hosted it. So `contests` is load-bearing
 * here where the other two ignore it, which is what that argument was always for.
 *
 * ## The cost, and the gap
 *
 * One request per tracked contest per refresh, where the previous third-party
 * feed cost one or two regardless of queue size. And because that feed was
 * *user-wide*, it also caught a task solved in a contest you are **not**
 * tracking — 1,906 of AtCoder's 9,383 problems appear in more than one contest,
 * so a task solved in its original round will no longer clear from a tracked
 * rerun of it. There is no way around that: AtCoder does not publish the list
 * that would answer it. The failure is a stale queue row, not a wrong one.
 */
import { fetchAcceptedTaskIds } from "./sources.js";

/**
 * @returns {Promise<Array<{contest: object, problem: object}>>} pairs the trunk
 *   maps through `descriptor.solvedKey`. The contest id is null because an
 *   AtCoder problem is identified by its task id alone.
 */
export async function fetchAccepted(session, contests, onProgress = () => {}) {
  if (!session.handle) return [];

  const accepted = [];
  for (const [i, contest] of contests.entries()) {
    onProgress(`Checking your AtCoder submissions… (${i + 1}/${contests.length})`);

    // Deliberately not caught: signed out, this throws rather than answering
    // with an empty set. An empty answer is indistinguishable from having solved
    // nothing, and `solved` is sticky — so a swallowed failure would look like a
    // healthy sync while quietly stranding the queue. `progress-manager`
    // isolates the throw to this platform.
    for (const problemId of await fetchAcceptedTaskIds(contest.id, session.handle)) {
      accepted.push({ contest: { id: null }, problem: { problemId } });
    }
  }

  return accepted;
}
