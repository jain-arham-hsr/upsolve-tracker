/**
 * Who you are on Codeforces.
 *
 * Auth is per-platform — AtCoder needs only a handle, CodeChef reads both from
 * the page — so the orchestrator never sees a key or secret.
 *
 * **What this can and cannot establish.** `user.status?handle=X` returns X's
 * submissions no matter whose key signs the request, and Codeforces offers no
 * "who am I" endpoint, so the handle is verified to **exist, not to be yours**.
 * The changed-identity path in `services/platform-identity.js` is what contains
 * that, by clearing this platform's flags rather than merging them.
 *
 * ## Two copies of this file, deliberately
 *
 * `codeforces-official/` and `codeforces-gyms/` are separate platforms with no
 * shared folder between them, and identity is one of the few things they
 * genuinely share: one handle, one key pair, one settings section. So this file
 * is duplicated rather than imported across the boundary, and
 * `tests/module-boundaries.test.js` asserts the two copies stay **byte**
 * identical — so anything that ever ought to differ between them is a sign this
 * file has taken on something that belongs to one platform alone.
 *
 * The duplication reaches further than it looks: `progress-manager.js` loops
 * platforms, so a refresh verifies the handle twice and reads the whole
 * account's `user.status` twice. That is a knowing cost, and the second read is
 * **load-bearing** — each platform namespaces solved keys by its own id, so
 * skipping either fetch stops solves clearing for that platform.
 */
import { CodeforcesService } from "./sources.js";
import { getSettings } from "../../settings/store.js";

/**
 * The slugs this platform reads, named here rather than declared on the
 * descriptor. A platform asks the settings store for what it needs, the way a
 * WordPress theme asks `get_option` — which is what lets both Codeforces
 * platforms read one key pair from one settings section.
 */
const SLUGS = ["upsolve_tracker.handle", "api_key", "api_secret"];

/** @throws when the extension hasn't been configured yet. */
export async function createSession() {
  return createSessionFrom(await getSettings(SLUGS));
}

/**
 * The same session, built from values that have not been saved yet.
 *
 * Settings needs this: it verifies what you have *typed*, not what is stored,
 * so that a wrong key tells you before you rely on it. Without it that page had
 * to construct a CodeforcesService itself — reaching straight past the adapter
 * into a platform's API client, which is the coupling this removes.
 *
 * @param {Record<string, string|null>} values - keyed by settings slug.
 */
export function createSessionFrom(values) {
  const apiKey = values.api_key;
  const apiSecret = values.api_secret;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
    );
  }

  return {
    service: new CodeforcesService(apiKey, apiSecret),
    handle: values["upsolve_tracker.handle"],
  };
}

/**
 * Confirms the stored handle is a real account, and returns it along with the
 * rating — both come from the one `user.info` call, so verifying costs nothing
 * beyond what fetching the rating already did.
 *
 * @throws when no handle is set, or Codeforces does not know it.
 */
export async function verifyIdentity(session) {
  if (!session?.handle) {
    throw new Error("No Codeforces handle set. Add one in Settings.");
  }

  // The API answers a bad handle with a FAILED status, which the service turns
  // into a throw — so an unknown handle never reaches the next line.
  const users = await session.service.getUsersInfo([session.handle]);
  const user = users?.[0];

  if (!user?.handle) {
    throw new Error(`Codeforces doesn't recognise the handle "${session.handle}".`);
  }

  // Take Codeforces' own casing, so "Tourist" and "tourist" don't read as two
  // different accounts on the next comparison.
  return {
    username: user.handle,
    rating: typeof user.rating === "number" ? user.rating : null,
  };
}
