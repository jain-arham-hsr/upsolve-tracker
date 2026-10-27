/**
 * Signing in with Google, through Firebase, and what that makes you.
 *
 * Chrome issues the Google token (`chrome.identity`), Firebase turns it into an
 * account, and **`firestore.rules` is the trust boundary** — not this file.
 * Anyone can edit their copy of the extension, so nothing here decides what a
 * user may do. The role this answers is read from `config/owner`, the same
 * document the rules check before any catalog write, so the "Owner" Settings
 * shows and the permission the rules grant cannot disagree; but showing it
 * grants nothing.
 *
 * Every dependency is a parameter defaulting to the real one, resolved at call
 * time: this module must load in plain Node, where `chrome` does not exist.
 */
import { FIREBASE_CONFIG, getFirebase } from "./firebase.js";

function deps(options) {
  const config = options.config ?? FIREBASE_CONFIG;
  return {
    config,
    identity: options.identity ?? globalThis.chrome?.identity,
    manifest: options.manifest ?? (() => globalThis.chrome?.runtime?.getManifest?.()),
    firebase: options.firebase ?? null,
  };
}

/**
 * Whether this build can sign in at all: Firebase needs its web config, and
 * Chrome needs an OAuth client to issue the Google token to. `vite.config.js`
 * leaves the manifest's `oauth2` block out when `.env` does not set one.
 */
export function isAccountConfigured(options = {}) {
  const d = deps(options);
  // Named keys, not `Object.values(...).every`: that is true of an empty
  // object, which would call a build with no config at all configured.
  if (!["apiKey", "authDomain", "projectId", "appId"].every((key) => d.config?.[key])) {
    return false;
  }
  const manifest = typeof d.manifest === "function" ? d.manifest() : d.manifest;
  return Boolean(manifest?.oauth2?.client_id);
}

/** The Firebase interface — injected in tests, loaded lazily otherwise. */
export function firebaseFrom(options = {}) {
  const d = deps(options);
  return d.firebase ? Promise.resolve(d.firebase) : getFirebase(d.config);
}

/** Chrome's answer is `{token}` on current versions and a bare string on old ones. */
async function getToken(identity, interactive) {
  const result = await identity.getAuthToken({ interactive });
  return typeof result === "string" ? result : result?.token ?? null;
}

/**
 * Prompts for a Google account and signs in to Firebase with it.
 * @returns {Promise<{uid: string, email: string|null, role: "owner"|"user"|null}>}
 */
export async function signIn(options = {}) {
  const d = deps(options);
  const firebase = await firebaseFrom(options);

  // Throws when the user closes the prompt; the caller shows that as-is.
  let token = await getToken(d.identity, true);
  try {
    await firebase.signInWithGoogleToken(token);
  } catch {
    // Chrome can hand back a cached token Google has already expired. One
    // fresh token is worth trying; a second refusal is not a stale cache.
    await d.identity.removeCachedAuthToken({ token });
    token = await getToken(d.identity, true);
    try {
      await firebase.signInWithGoogleToken(token);
    } catch (error) {
      throw new Error(`Firebase didn't accept this Google sign-in${codeOf(error)}.`);
    }
  }
  return whoAmI(options);
}

export async function signOut(options = {}) {
  const firebase = await firebaseFrom(options);
  await firebase.signOut();
}

/**
 * Who is signed in, and whether they are the owner.
 *
 * @returns {Promise<{uid: string, email: string|null, role: "owner"|"user"|null}|null>}
 *   null when signed out. `role` is null when `config/owner` could not be read
 *   — offline, or rules not deployed — which is not the same as "user".
 */
export async function whoAmI(options = {}) {
  const firebase = await firebaseFrom(options);
  const user = await firebase.currentUser();
  if (!user) return null;

  let role = null;
  try {
    const owner = await firebase.get("config/owner");
    role = owner?.uid === user.uid ? "owner" : "user";
  } catch (error) {
    console.info("[account] couldn't read config/owner:", error.message);
  }
  return { uid: user.uid, email: user.email ?? null, role };
}

/**
 * Whether someone is signed in. Reads only Firebase's own persisted session,
 * so it costs no request and answers offline.
 */
export async function isSignedIn(options = {}) {
  const firebase = await firebaseFrom(options);
  return (await firebase.currentUser()) !== null;
}

/**
 * Calls back whenever the signed-in account changes, on any extension page —
 * so signing out in Settings closes the side panel without either page
 * telling the other.
 *
 * @returns {Promise<() => void>} unsubscribe
 */
export async function watchSignIn(callback, options = {}) {
  const firebase = await firebaseFrom(options);
  return firebase.onAuthChange(callback);
}

/**
 * Where this install's ratings come from — the one question the add and the
 * refresh ask of the account.
 *
 *   "local"   the build has no Firebase: ratings are fetched and estimated
 *             here, exactly as before the catalog existed
 *   "owner"   the same, and every contest is then published to the catalog
 *   "catalog" everyone else, signed out included: an add reads only the
 *             problem list, and ratings arrive from the catalog
 *
 * An unreadable role throws rather than guessing. Read as "catalog" it would
 * store the owner's own adds unrated and never publish them; read as "owner"
 * it would publish from an account the rules then refuse.
 */
export async function ratingMode(options = {}) {
  if (!isAccountConfigured(options)) return "local";
  const who = await whoAmI(options);
  if (!who) return "catalog";
  if (who.role === null) {
    throw new Error("Couldn't confirm your account. Check your connection and try again.");
  }
  return who.role === "owner" ? "owner" : "catalog";
}

/** Firebase's error code, which is the useful part for whoever set the project up. */
function codeOf(error) {
  return error?.code ? ` (${error.code})` : "";
}
