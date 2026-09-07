/**
 * What you have solved on Codeforces.
 *
 * Reads Codeforces' own submission shape (`verdict`, `problem.contestId`),
 * which is why it lives here rather than in a shared module.
 *
 * `contests` is unused: `user.status` returns the whole history in one call, so
 * cost does not grow with the queue. CodeChef answers per contest and does need
 * it; AtCoder will once it reads submissions from the site itself.
 *
 * Duplicated in the sibling platform, and the duplicate fetch is load-bearing
 * rather than merely wasteful: `user.status` returns the whole account's
 * submissions with no gym/official marker, so each platform reads the same
 * stream and stamps its own `solvedKey` prefix on it. `applySolvedStatus` looks
 * up by the prefix of the platform that *owns* the contest, so both reads have
 * to happen or one platform's solves never clear.
 */

/**
 * @returns {Promise<Array<{contest: object, problem: object}>>} pairs the trunk
 *   maps through `descriptor.solvedKey`.
 */
export async function fetchAccepted(session, _contests, onProgress = () => {}) {
  onProgress("Checking your submissions…");
  const submissions = await session.sources.getUserStatus(session.handle);

  return submissions
    .filter((submission) => submission.verdict === "OK")
    .map((submission) => ({
      contest: { id: submission.problem.contestId },
      problem: { index: submission.problem.index },
    }));
}
