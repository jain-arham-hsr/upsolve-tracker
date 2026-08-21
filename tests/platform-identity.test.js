/**
 * Whose data the queue is reading.
 *
 * The handle in Settings is the authority; adapters check it before reading
 * anything (see adapter-identity.test.js). What is tested here is the other
 * half: whether that handle has *changed* since the solved flags were derived,
 * because flags from a previous account keep hiding problems this one has
 * never solved — and a queue that is quietly shorter than you remember
 * announces nothing.
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

const platform = (id, label) => ({ id, label });

beforeEach(() => stubChrome());

test("a first run adopts whatever handle verified", () => {
  assert.equal(classifyIdentity({ stored: null, current: "me" }), "first-use");
});

test("the same handle is a match", () => {
  assert.equal(classifyIdentity({ stored: "me", current: "me" }), "match");
});

test("a different handle means the flags belong to the old account", () => {
  assert.equal(classifyIdentity({ stored: "me", current: "them" }), "changed");
});

test("classifying without a verified account is a programming error, not a default", () => {
  assert.throws(() => classifyIdentity({ stored: "me", current: null }));
});

test("a deliberately changed handle is adopted", async () => {
  stubChrome({ [IDENTITY_STORAGE_KEY]: { codeforces: "old" } });

  const verdict = await settleIdentity(platform("codeforces", "Codeforces"), { username: "new" });
  assert.equal(verdict, "changed");
  assert.equal(await getStoredIdentity("codeforces"), "new");
});

test("first use records the account", async () => {
  const verdict = await settleIdentity(platform("atcoder", "AtCoder"), { username: "me" });
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
