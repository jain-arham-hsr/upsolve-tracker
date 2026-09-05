/**
 * What you have solved on Codeforces.
 *
 * Reads Codeforces' own submission shape (`verdict`, `problem.contestId`),
 * which is why it lives here rather than in a shared module.
 *
 * `contests` is unused: `user.status` returns the whole history in one call, so
 * cost does not grow with the queue. CodeChef answers per contest and does need
 * it; AtCoder will once it reads submissions from the site itself.
 */

/**
 * @returns {Promise<Array<{contest: object, problem: object}>>} pairs the trunk
 *   maps through `descriptor.solvedKey`.
 */
export async function fetchAccepted(session, _contests, onProgress = () => {}) {
  onProgress("Checking your submissions…");
  const submissions = await session.service.getUserStatus(session.handle);

  return submissions
    .filter((submission) => submission.verdict === "OK")
    .map((submission) => ({
      contest: { id: submission.problem.contestId },
      problem: { index: submission.problem.index },
    }));
}
