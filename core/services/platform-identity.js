/**
 * Which account each platform's data belongs to.
 *
 * Every read of user-specific data — anything that sets `solved`, or a rating
 * the queue orders by — has to be attributable to a verified account. Without
 * that, three things go wrong, and all of them silently:
 *
 *  - **CodeChef takes its identity from the browser session.** Someone else
 *    signing in once, followed by a sync, writes their solves onto this queue.
 *  - **Codeforces and AtCoder read by a stored handle nobody checks.** A typo
 *    yields nothing and looks like a slow sync; a handle that happens to
 *    belong to someone else yields their history.
 *  - **`solved` is sticky — only ever set true.** So it is really a cache of
 *    one account's history, and pointing a platform at a different handle
 *    leaves every old mark in place forever.
 *
 * Every platform has a handle you enter in Settings, and that handle is the
 * authority. Adapters check it before reading anything: Codeforces and AtCoder
 * confirm it exists, CodeChef additionally confirms the browser is signed in as
 * that account, since its API answers for whoever holds the cookie.
 *
 * What is left here is the *other* question — has that handle changed since the
 * solved flags were derived? If so they belong to the previous account and have
 * to go, or the queue keeps hiding problems this account has never solved.
 */
const IDENTITY_KEY = "upsolve_tracker.platform_identity";

/** @returns {Promise<Record<string, string>>} platform id → verified account */
export async function getStoredIdentities() {
  const stored = await chrome.storage.local.get({ [IDENTITY_KEY]: {} });
  return stored[IDENTITY_KEY] ?? {};
}

export async function getStoredIdentity(platformId) {
  return (await getStoredIdentities())[platformId] ?? null;
}

export async function setStoredIdentity(platformId, username) {
  const identities = await getStoredIdentities();

  if (username) {
    identities[platformId] = username;
  } else {
    delete identities[platformId];
  }

  await chrome.storage.local.set({ [IDENTITY_KEY]: identities });
}

/**
 * Compares the handle the solved flags were derived from against the one now
 * configured.
 *
 * Pure, so the decision is testable without storage or a network.
 *
 * @returns {"first-use"|"match"|"changed"}
 */
export function classifyIdentity({ stored, current }) {
  if (!current) throw new Error("classifyIdentity needs a verified account");
  if (!stored) return "first-use";
  return stored === current ? "match" : "changed";
}

/**
 * Clears `solved` on every problem belonging to one platform, so the next sync
 * re-derives it against the new account.
 *
 * Mutates and returns the contests; persisting is the caller's job. Contests
 * already removed for being fully solved cannot come back — those were deleted
 * outright.
 */
export function clearSolvedForPlatform(contests, platformId, defaultPlatformId) {
  let cleared = 0;

  for (const contest of contests ?? []) {
    if ((contest.platform ?? defaultPlatformId) !== platformId) continue;

    for (const problem of contest.problems ?? []) {
      if (problem.solved) {
        problem.solved = false;
        cleared++;
      }
    }
  }

  return cleared;
}

export const IDENTITY_STORAGE_KEY = IDENTITY_KEY;

/**
 * Records the handle the solved flags are now derived from, and reports
 * whether it changed.
 *
 * Does **not** clear solved flags — the caller does that, because the sync
 * already holds the contests in memory while the add path does not, and
 * writing storage twice would be worse than passing the verdict back.
 *
 * @returns {"first-use"|"match"|"changed"} what happened.
 */
export async function settleIdentity(platform, identity) {
  const stored = await getStoredIdentity(platform.id);
  const verdict = classifyIdentity({ stored, current: identity.username });

  if (verdict === "match") return verdict;

  await setStoredIdentity(platform.id, identity.username);
  return verdict;
}
