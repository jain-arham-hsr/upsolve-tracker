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
 * A mismatch means different things depending on where the identity comes
 * from, which is why adapters declare `identityIsAmbient`:
 *
 *  - **Ambient** (CodeChef): the user did not ask for this. Refuse.
 *  - **Configured** (Codeforces, AtCoder): the user edited the handle
 *    deliberately. Adopt it, and drop that platform's stale solved flags.
 */
const IDENTITY_KEY = "cf_trainer.platform_identity";

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
 * Compares a freshly verified account against the one this queue belongs to.
 *
 * Pure, so the decision is testable without storage or a network: the whole
 * failure mode is taking the wrong branch here.
 *
 * @returns {"first-use"|"match"|"changed"|"intruder"}
 */
export function classifyIdentity({ stored, current, isAmbient }) {
  if (!current) throw new Error("classifyIdentity needs a verified account");
  if (!stored) return "first-use";
  if (stored === current) return "match";
  return isAmbient ? "intruder" : "changed";
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
 * Reconciles a freshly verified account against the one this queue belongs to,
 * and records the new one.
 *
 * Does **not** clear solved flags — the caller does that, because the sync
 * already holds the contests in memory while the add path does not, and
 * writing storage twice would be worse than passing the verdict back.
 *
 * @returns {"first-use"|"match"|"changed"} what happened.
 * @throws on an ambient mismatch — someone else is signed in, and their solves
 *   must not be written here.
 */
export async function settleIdentity(platform, adapter, identity) {
  const stored = await getStoredIdentity(platform.id);
  const verdict = classifyIdentity({
    stored,
    current: identity.username,
    isAmbient: adapter.identityIsAmbient,
  });

  if (verdict === "match") return verdict;

  if (verdict === "intruder") {
    const error = new Error(
      `Signed in to ${platform.label} as ${identity.username}, but this queue belongs to ` +
        `${stored}. Sign back in as ${stored}, or switch the account in Settings.`,
    );
    // Flagged so callers can tell "someone else is signed in" — which must
    // always stop the operation — from "this platform isn't set up", which
    // merely means solved status can't be read.
    error.isIdentityMismatch = true;
    throw error;
  }

  await setStoredIdentity(platform.id, identity.username);
  return verdict;
}
