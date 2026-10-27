/**
 * The extension's half of sign-in: when it counts as signed out, that a stale
 * Chrome token is retried once, and that the owner comes from the one document
 * the security rules also read. Firebase is faked behind the small interface
 * `account.js` uses, so the SDK is never loaded here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isAccountConfigured,
  ratingMode,
  signIn,
  signOut,
  whoAmI,
} from "../core/services/account.js";

const USER = { uid: "u1", email: "a@b.c" };

function world({ user = null, tokens = ["t1"], refuse = [], owner = "someone-else" } = {}) {
  let current = user;
  let issued = 0;
  const dropped = [];
  const tried = [];
  return {
    dropped,
    tried,
    options: {
      identity: {
        getAuthToken: async () => {
          const token = tokens[Math.min(issued++, tokens.length - 1)];
          if (token instanceof Error) throw token;
          return { token };
        },
        removeCachedAuthToken: async ({ token }) => dropped.push(token),
      },
      firebase: {
        currentUser: async () => current,
        signInWithGoogleToken: async (token) => {
          tried.push(token);
          if (refuse.includes(token)) {
            throw Object.assign(new Error("bad"), { code: "auth/invalid-credential" });
          }
          current = USER;
        },
        signOut: async () => {
          current = null;
        },
        get: async (path) => {
          assert.equal(path, "config/owner");
          if (owner instanceof Error) throw owner;
          return owner == null ? null : { uid: owner };
        },
      },
    },
  };
}

test("signed out is null, not an error", async () => {
  assert.equal(await whoAmI(world().options), null);
});

test("a signed-in user who is not the owner is a user", async () => {
  assert.deepEqual(await whoAmI(world({ user: USER }).options), { ...USER, role: "user" });
});

test("the owner is whoever config/owner names", async () => {
  const who = await whoAmI(world({ user: USER, owner: "u1" }).options);
  assert.equal(who.role, "owner");
});

test("an unreadable config/owner leaves the role unknown rather than 'user'", async () => {
  const who = await whoAmI(world({ user: USER, owner: new Error("offline") }).options);
  assert.equal(who.role, null);
});

test("signing in hands Chrome's token to Firebase", async () => {
  const w = world();
  assert.deepEqual(await signIn(w.options), { ...USER, role: "user" });
  assert.deepEqual(w.tried, ["t1"]);
  assert.deepEqual(w.dropped, []);
});

test("a stale Chrome token is dropped and retried once", async () => {
  const w = world({ tokens: ["old", "new"], refuse: ["old"] });
  assert.deepEqual(await signIn(w.options), { ...USER, role: "user" });
  assert.deepEqual(w.dropped, ["old"]);
  assert.deepEqual(w.tried, ["old", "new"]);
});

test("a second refusal is reported with Firebase's code", async () => {
  const w = world({ tokens: ["a", "b"], refuse: ["a", "b"] });
  await assert.rejects(signIn(w.options), /didn't accept.*auth\/invalid-credential/);
  assert.equal(w.tried.length, 2);
});

test("closing Google's prompt is reported as-is and touches nothing", async () => {
  const w = world({ tokens: [new Error("The user did not approve access.")] });
  await assert.rejects(signIn(w.options), /did not approve/);
  assert.deepEqual(w.tried, []);
});

test("signing out leaves nobody signed in", async () => {
  const w = world({ user: USER });
  await signOut(w.options);
  assert.equal(await whoAmI(w.options), null);
});

test("a build missing the Firebase config or the OAuth client cannot sign in", () => {
  const config = { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" };
  const manifest = { oauth2: { client_id: "c" } };
  assert.equal(isAccountConfigured({ config, manifest }), true);
  assert.equal(isAccountConfigured({ config: { ...config, appId: undefined }, manifest }), false);
  assert.equal(isAccountConfigured({ config, manifest: {} }), false);
});

test("no config/owner document means nobody is the owner", async () => {
  const who = await whoAmI(world({ user: USER, owner: null }).options);
  assert.equal(who.role, "user");
});

const CONFIG = { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" };
const MANIFEST = { oauth2: { client_id: "c" } };
const configured = (w) => ({ ...w.options, config: CONFIG, manifest: MANIFEST });

test("the rating mode: local without Firebase, owner for the owner, catalog for everyone else", async () => {
  assert.equal(await ratingMode({ config: {}, manifest: MANIFEST }), "local");
  assert.equal(await ratingMode(configured(world({ user: USER, owner: "u1" }))), "owner");
  assert.equal(await ratingMode(configured(world({ user: USER }))), "catalog");
  // Signed out is catalog mode too: the owner's adds are the only local ones.
  assert.equal(await ratingMode(configured(world())), "catalog");
});

test("an unreadable role refuses rather than guessing a mode", async () => {
  await assert.rejects(
    ratingMode(configured(world({ user: USER, owner: new Error("offline") }))),
    /Couldn't confirm your account/,
  );
});
