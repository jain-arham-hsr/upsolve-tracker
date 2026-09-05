/**
 * What you have solved on CodeChef.
 *
 * Read per *user*, not per contest. This used to read `problemsstats.solved` on
 * the contest payload, which only ever reflects submissions made **during** the
 * contest — and CodeChef closes a contest to submissions when it ends, so
 * upsolving happens in practice. That read could never see it, leaving every
 * CodeChef problem in the queue forever.
 *
 * Now user-wide, like Codeforces' `user.status`, so `contests` is unused. It is
 * also cheaper: a few paged requests rather than one per tracked contest.
 */
import { getAttemptedProblems, ACCEPTED } from "./api.js";
import { verifyIdentity } from "./identity.js";

/**
 * @returns {Promise<Array<{contest: object, problem: object}>>} pairs the trunk
 *   maps through `descriptor.solvedKey`. The contest is null because a CodeChef
 *   problem is identified by its code alone — which is why one solve clears
 *   every tracked division of the same Starters.
 */
export async function fetchAccepted(session, _contests, onProgress = () => {}) {
  // Signed out — or signed in as somebody else — the listing answers for the
  // wrong account, and an empty answer is indistinguishable from having solved
  // nothing. Refuse, so the caller isolates the failure and leaves flags alone.
  await verifyIdentity(session);

  const rows = await getAttemptedProblems(onProgress);
  const accepted = [];

  for (const row of rows) {
    if (Number(row?.status) !== ACCEPTED) continue;
    if (!row?.code) continue;
    accepted.push({ contest: null, problem: { index: row.code } });
  }

  return accepted;
}
