/**
 * Each adapter's verifyIdentity, which runs before anything user-specific is
 * read. A wrong answer here is what lets another account's history be written
 * onto this queue.
 *
 * The handle you enter in Settings is the authority on every platform.
 * Codeforces and AtCoder are asked *about* that handle, so it is enough to
 * confirm it exists. CodeChef answers for whoever holds the session cookie, so
 * the session has to be checked against the handle as well.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetApiState } from "../core/platforms/codechef/sources.js";
import { getAdapter } from "../core/platforms/platforms.js";

const codechef = getAdapter("codechef");
const codeforces = getAdapter("codeforces-official");

beforeEach(() => resetApiState());

test("every platform refuses when it has no handle", async () => {
  await assert.rejects(() => codeforces.verifyIdentity({}), /No Codeforces handle/);
  await assert.rejects(() => codechef.verifyIdentity({}), /No CodeChef handle/);
  await assert.rejects(() => codechef.verifyIdentity(undefined), /No CodeChef handle/);
});

test("CodeChef refuses when signed out rather than reporting nobody", async () => {
  // Signed out, problemsstats.solved is simply empty — indistinguishable from
  // having solved nothing. Verifying has to fail before a caller reads that.
  await assert.rejects(
    () => codechef.verifyIdentity({ handle: "me", signedIn: false, signedInAs: null }),
    /Not signed in/,
  );
});

test("CodeChef refuses when the wrong account is signed in", async () => {
  // The data-loss case: its API answers for whoever holds the cookie, so this
  // would write their solved problems onto your queue.
  const error = await codechef
    .verifyIdentity({ handle: "me", signedIn: true, signedInAs: "someone_else" })
    .then(() => null, (e) => e);

  assert.ok(error, "should have thrown");
  assert.match(error.message, /Signed in to CodeChef as someone_else/);
  assert.match(error.message, /this queue is for me/);
  assert.equal(error.isIdentityMismatch, true, "callers must tell this from being unconfigured");
});

test("CodeChef accepts a matching session, with no extra request", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200 }; };

  const identity = await codechef.verifyIdentity({
    handle: "tourist", signedIn: true, signedInAs: "tourist", rating: 1394,
  });
  assert.deepEqual(identity, { username: "tourist", rating: 1394 });
  assert.equal(calls, 0, "createSession already fetched the bootstrap");
});

test("Codeforces refuses a handle the API doesn't return", async () => {
  const session = { handle: "nope", sources: { async getUsersInfo() { return []; } } };
  await assert.rejects(() => codeforces.verifyIdentity(session), /doesn't recognise/);
});

test("Codeforces takes the API's own casing, so case isn't read as a new account", async () => {
  // Otherwise typing "Tourist" over "tourist" would look like a handle change
  // and needlessly clear every solved flag.
  const session = {
    handle: "TOURIST",
    sources: { async getUsersInfo() { return [{ handle: "tourist", rating: 3800 }]; } },
  };
  assert.deepEqual(await codeforces.verifyIdentity(session), {
    username: "tourist", rating: 3800,
  });
});

test("an unrated Codeforces account verifies, with a null rating", async () => {
  // No `rating` field at all until you have competed. Null, never zero — a
  // zero would read as a real rating and make every problem look impossible.
  const session = {
    handle: "newcomer",
    sources: { async getUsersInfo() { return [{ handle: "newcomer" }]; } },
  };
  assert.deepEqual(await codeforces.verifyIdentity(session), {
    username: "newcomer", rating: null,
  });
});
