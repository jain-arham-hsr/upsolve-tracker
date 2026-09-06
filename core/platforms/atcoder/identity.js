/**
 * Who you are on AtCoder.
 *
 * AtCoder needs no key or secret — only a handle, and only to read solved
 * history. Everything else it publishes is public.
 *
 * **What this can and cannot establish.** AtCoder offers no "who am I"
 * endpoint, and the submission history is read *about* a handle rather than
 * for a session, so the handle is verified to **exist, not to be yours**. Enter
 * someone else's and you will sync their solves. What contains that is the
 * changed-identity path in `services/platform-identity.js`, which clears this
 * platform's flags rather than merging them, so the mistake is recoverable.
 */
import { getSettings } from "../../settings/store.js";
import { extractRating } from "./dom-parsers/profile.js";
import { extractSignedInUser } from "./dom-parsers/page-globals.js";
import { getPage } from "./http.js";

const HANDLE_KEY = "upsolve_tracker.atcoder_handle";

export async function createSession() {
  return createSessionFrom(await getSettings([HANDLE_KEY]));
}

/** The same session from unsaved values, so Settings can verify what you typed. */
export function createSessionFrom(values) {
  return { handle: values[HANDLE_KEY] };
}

/**
 * Confirms the handle exists, reads its rating, and — new — checks it is yours.
 *
 * ## What this can now establish, and what it still cannot
 *
 * CLAUDE.md used to say of AtCoder that "the handle is verified to exist, not to
 * be yours", because its history came from a third party that authenticates
 * nobody. Reading submissions from AtCoder with the user's own session changed
 * that: every page AtCoder serves carries `var userScreenName`, so the account
 * the browser is signed in as is knowable.
 *
 * That is *not* the CodeChef situation, and the difference decides the policy.
 * On CodeChef the session **is** the identity — the API answers for whoever
 * holds the cookie — so a mismatch means the data itself is the wrong person's
 * and must never be written. Here submissions are filtered by `f.User=`, so the
 * data is always the configured handle's whoever is signed in. A mismatch does
 * not corrupt anything; it means the handle in Settings is not the one you
 * compete under, which is almost always a typo.
 *
 * So it throws only on **positive evidence** of a mismatch:
 *
 *   - signed in, and the names differ → throw. We know this is not your handle.
 *   - signed in, names match → confirmed, and AtCoder's own casing is returned.
 *   - `""` — signed out → proceed. Nothing to compare against; the handle is
 *     verified to exist, exactly as before.
 *   - `null` — the marker is gone → proceed. A page-shape change is not evidence
 *     about who you are, and refusing on it would make the extension unusable
 *     for a reason it cannot state.
 *
 * The last two are the important ones: adding a contest must keep working
 * signed out, since difficulty falls back to "???" rather than failing.
 *
 * @throws when no handle is set, AtCoder has no such user, or the signed-in
 *   account contradicts the configured one.
 */
export async function verifyIdentity(session) {
  if (!session?.handle) {
    throw new Error("No AtCoder handle set. Add one in Settings.");
  }

  let html;
  try {
    html = await getPage(`https://atcoder.jp/users/${encodeURIComponent(session.handle)}`);
  } catch (error) {
    if (error?.status === 404) {
      throw new Error(`AtCoder has no user "${session.handle}".`);
    }
    throw error;
  }

  const signedInAs = extractSignedInUser(html);

  if (signedInAs && signedInAs.toLowerCase() !== session.handle.toLowerCase()) {
    // Flagged, not matched on the sentence — the same idiom as CodeChef's, so a
    // copy edit here cannot change which failures callers treat as fatal.
    const error = new Error(
      `Settings has the AtCoder handle "${session.handle}", but this browser is ` +
        `signed in as "${signedInAs}". Fix the handle, or the queue will track ` +
        `somebody else's progress.`,
    );
    error.isIdentityMismatch = true;
    throw error;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  // extractRating returns null rather than a default when the page shape
  // changes — a substituted rating would mis-sort every AtCoder problem.
  return {
    // AtCoder's own casing where we have it, so "Tourist" and "tourist" do not
    // read as two different accounts on the next comparison.
    username: signedInAs || session.handle,
    rating: extractRating(doc),
  };
}
