/**
 * Each adapter's verifyIdentity. These run before anything user-specific is
 * read, so a wrong answer here is what lets another account's history be
 * written onto this queue.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetApiState } from "../core/platforms/codechef/api.js";
import * as codechef from "../core/platforms/codechef/adapter.js";
import * as codeforces from "../core/platforms/codeforces/adapter.js";

beforeEach(() => resetApiState());

test("only CodeChef declares an ambient identity", () => {
  // This flag is what decides refuse-versus-adopt on a mismatch, so it must
  // not drift.
  assert.equal(codechef.identityIsAmbient, true);
  assert.equal(codeforces.identityIsAmbient, false);
});

test("CodeChef refuses when signed out rather than reporting nobody", async () => {
  // Signed out, problemsstats.solved is simply empty — indistinguishable from
  // having solved nothing. Verifying has to fail before a caller reads that.
  for (const session of [
    { signedIn: false, username: null },
    { signedIn: true, username: null },
    undefined,
  ]) {
    await assert.rejects(() => codechef.verifyIdentity(session), /Not signed in/);
  }
});

test("CodeChef returns the signed-in account and rating with no extra request", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200 }; };

  const identity = await codechef.verifyIdentity({
    signedIn: true, username: "jain_arham_hsr", rating: 1450,
  });
  assert.deepEqual(identity, { username: "jain_arham_hsr", rating: 1450 });
  assert.equal(calls, 0, "createSession already fetched the bootstrap");
});

test("Codeforces refuses an unset handle", async () => {
  await assert.rejects(() => codeforces.verifyIdentity({}), /No Codeforces handle/);
  await assert.rejects(() => codeforces.verifyIdentity(undefined), /No Codeforces handle/);
});

test("Codeforces refuses a handle the API doesn't return", async () => {
  const session = { handle: "nope", service: { async getUsersInfo() { return []; } } };
  await assert.rejects(() => codeforces.verifyIdentity(session), /doesn't recognise/);
});

test("Codeforces takes the API's own casing, so case isn't read as a new account", async () => {
  // Otherwise typing "Tourist" over "tourist" would look like a handle change
  // and needlessly clear every solved flag.
  const session = {
    handle: "TOURIST",
    service: { async getUsersInfo() { return [{ handle: "tourist", rating: 3800 }]; } },
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
    service: { async getUsersInfo() { return [{ handle: "newcomer" }]; } },
  };
  assert.deepEqual(await codeforces.verifyIdentity(session), {
    username: "newcomer", rating: null,
  });
});
