/**
 * Who you are on CodeChef — and the one platform where that is a real question.
 *
 * CodeChef answers for whoever holds the session cookie, so unlike Codeforces
 * and AtCoder the configured handle is additionally compared against the
 * signed-in account. A mismatch throws with `isIdentityMismatch` and callers
 * must always stop: `solved` is only ever set true, fully-solved contests are
 * deleted outright, and `writeBackup()` runs after the sync, so one sync under
 * another account permanently corrupts the queue *and* overwrites the backup.
 */
import { getDashboardHtml } from "./api.js";
import { extractSession } from "./dom-parsers/page-globals.js";
import { getSettings } from "../../settings/store.js";

const HANDLE_KEY = "upsolve_tracker.codechef_handle";

/**
 * The handle you declared, plus whoever the browser is actually signed in as.
 *
 * Both, because they can differ — and that difference is the whole point: the
 * configured handle says who this queue belongs to, and the session says whose
 * solved status the API is about to hand back.
 */
export async function createSession() {
  return createSessionFrom(await getSettings([HANDLE_KEY]));
}

/** The same session from unsaved values, so Settings can verify what you typed. */
export async function createSessionFrom(values) {
  const html = await getDashboardHtml();

  // extractSession returns null both when signed out and when the page shape
  // has changed. Either way the caller must not read an empty solved list as
  // "nothing solved".
  const page = extractSession(html);

  return {
    handle: values[HANDLE_KEY],
    signedInAs: page?.username ?? null,
    rating: page?.rating ?? null,
    signedIn: Boolean(page?.username),
  };
}

/**
 * CodeChef is the one platform where the browser session *is* the identity —
 * the other two are asked *about* a handle, whoever is signed in. Settings says
 * so in the verb, and that distinction is the adapter's to make rather than the
 * page's, or it turns back into a branch on the platform.
 */
export function describeIdentity(identity) {
  return `Signed in as ${identity.username}.`;
}

/**
 * Checks the browser is signed in as the account this queue is for.
 *
 * Unlike the other two, CodeChef's data comes back for whoever holds the
 * session cookie rather than for a handle we ask about. So the configured
 * handle is the authority, and the session is checked against it.
 *
 * @throws when no handle is configured, when signed out, or — the dangerous
 *   one — when signed in as somebody else. Signing out is indistinguishable
 *   from having solved nothing, since `problemsstats.solved` is simply empty,
 *   so none of these may fall through to a caller.
 */
export async function verifyIdentity(session) {
  if (!session?.handle) {
    throw new Error("No CodeChef handle set. Add one in Settings.");
  }

  if (!session.signedIn) {
    throw new Error(
      `Not signed in to CodeChef. Sign in as ${session.handle} at codechef.com.`,
    );
  }

  if (session.signedInAs !== session.handle) {
    const error = new Error(
      `Signed in to CodeChef as ${session.signedInAs}, but this queue is for ` +
        `${session.handle}. Sign in as ${session.handle}, or change the handle in Settings.`,
    );
    // Flagged so callers can tell "the wrong account is signed in" — which
    // must always stop the operation — from "this platform isn't set up".
    error.isIdentityMismatch = true;
    throw error;
  }

  return {
    username: session.handle,
    rating: typeof session.rating === "number" ? session.rating : null,
  };
}
