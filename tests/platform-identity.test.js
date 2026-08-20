/**
 * Whose data the queue is reading.
 *
 * Every failure guarded here is silent. Writing another account's solves looks
 * like a normal sync; refusing without saying so looks like a normal sync;
 * keeping the old account's flags after a handle change looks like a queue
 * that is simply shorter than you remembered. None of them announce
 * themselves, so none of them can be left to manual checking.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

let store;
function stubChrome(initial = {}) {
  store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return out;
        },
        async set(patch) { Object.assign(store, structuredClone(patch)); },
      },
    },
  };
}

const {
  classifyIdentity,
  clearSolvedForPlatform,
  settleIdentity,
  getStoredIdentity,
  IDENTITY_STORAGE_KEY,
} = await import("../core/services/platform-identity.js");

const configured = { identityIsAmbient: false };
const ambient = { identityIsAmbient: true };
const platform = (id, label) => ({ id, label });

beforeEach(() => stubChrome());

test("a first run adopts whatever account verified", () => {
  assert.equal(classifyIdentity({ stored: null, current: "me", isAmbient: false }), "first-use");
  assert.equal(classifyIdentity({ stored: null, current: "me", isAmbient: true }), "first-use");
});

test("the same account is a match regardless of where identity comes from", () => {
  assert.equal(classifyIdentity({ stored: "me", current: "me", isAmbient: true }), "match");
  assert.equal(classifyIdentity({ stored: "me", current: "me", isAmbient: false }), "match");
});

test("a mismatch means different things depending on where identity comes from", () => {
  // Ambient: nobody asked for this — someone else is signed into the browser.
  assert.equal(classifyIdentity({ stored: "me", current: "them", isAmbient: true }), "intruder");
  // Configured: the user edited the handle in Settings, deliberately.
  assert.equal(classifyIdentity({ stored: "me", current: "them", isAmbient: false }), "changed");
});

test("classifying without a verified account is a programming error, not a default", () => {
  assert.throws(() => classifyIdentity({ stored: "me", current: null, isAmbient: true }));
});

test("an intruder is refused, and the pin is left alone", async () => {
  // The whole data-loss bug: their solves must not be written here, and the
  // queue must still belong to the original account afterwards.
  stubChrome({ [IDENTITY_STORAGE_KEY]: { codechef: "me" } });

  await assert.rejects(
    () => settleIdentity(platform("codechef", "CodeChef"), ambient, { username: "them" }),
    /belongs to me/,
  );
  assert.equal(await getStoredIdentity("codechef"), "me");
});

test("a deliberately changed handle is adopted", async () => {
  stubChrome({ [IDENTITY_STORAGE_KEY]: { codeforces: "old" } });

  const verdict = await settleIdentity(
    platform("codeforces", "Codeforces"), configured, { username: "new" },
  );
  assert.equal(verdict, "changed");
  assert.equal(await getStoredIdentity("codeforces"), "new");
});

test("first use records the account", async () => {
  const verdict = await settleIdentity(
    platform("atcoder", "AtCoder"), configured, { username: "me" },
  );
  assert.equal(verdict, "first-use");
  assert.equal(await getStoredIdentity("atcoder"), "me");
});

const queue = () => [
  { platform: "codeforces", problems: [{ solved: true }, { solved: false }] },
  { platform: "atcoder", problems: [{ solved: true }] },
  { id: "legacy", problems: [{ solved: true }] },
];

test("clearing solved flags touches only the platform that changed", () => {
  const contests = queue();
  const cleared = clearSolvedForPlatform(contests, "codeforces", "codeforces");

  assert.equal(cleared, 2, "the legacy record counts as Codeforces");
  assert.equal(contests[0].problems[0].solved, false);
  assert.equal(contests[1].problems[0].solved, true, "AtCoder was cleared too");
  assert.equal(contests[2].problems[0].solved, false);
});

test("clearing a platform with nothing solved changes nothing", () => {
  const contests = queue();
  assert.equal(clearSolvedForPlatform(contests, "codechef", "codeforces"), 0);
  assert.equal(contests[1].problems[0].solved, true);
});

test("clearing survives missing arrays rather than throwing mid-sync", () => {
  assert.equal(clearSolvedForPlatform(undefined, "codeforces", "codeforces"), 0);
  assert.equal(clearSolvedForPlatform([{ platform: "codeforces" }], "codeforces", "codeforces"), 0);
});
