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
import { sources, ACCEPTED } from "./sources.js";
import { verifyIdentity } from "./identity.js";

/**
 * @returns {Promise<Array<{contest: object, problem: object}>>} pairs the trunk
 *   maps through `descriptor.solvedKey`.
 *
 *   **The contest carries `{ id: null }`, not `null`.** A CodeChef problem is
 *   identified by its code alone — which is why one solve clears every tracked
 *   division of the same Starters — so there is genuinely no contest to name.
 *   But `solvedKey` receives this object, and the three platforms used to
 *   express the same absence three ways (`{id}`, `{id: null}`, bare `null`).
 *   That only worked because neither this descriptor nor AtCoder's reads
 *   `contest`; the day one started to, a bare null would throw here and not
 *   there. One shape, so the difference cannot be discovered that way.
 */
export async function fetchAccepted(session, _contests, onProgress = () => {}) {
  // Signed out — or signed in as somebody else — the listing answers for the
  // wrong account, and an empty answer is indistinguishable from having solved
  // nothing. Refuse, so the caller isolates the failure and leaves flags alone.
  //
  // **Yes, this is the second verification this refresh.** `progress-manager.js`
  // already called `adapter.verifyIdentity` before reaching here, and no other
  // platform checks twice — so this reads like an oversight and is not one. It
  // is the third of the three independent layers `tests/identity-guard.test.js`
  // pins, and the only one that survives when the first two are both defeated:
  // it makes reading another account's solves impossible from *this* function
  // rather than merely unlikely from its callers. CodeChef is where that
  // matters, because there the browser session is the identity, so a mismatch
  // means the rows belong to someone else. It costs nothing extra — the check
  // reads the session object the add already built.
  await verifyIdentity(session);

  const rows = await sources.attemptedProblems(onProgress);
  const accepted = [];

  for (const row of rows) {
    if (Number(row?.status) !== ACCEPTED) continue;
    if (!row?.code) continue;
    accepted.push({ contest: { id: null }, problem: { index: row.code } });
  }

  return accepted;
}
