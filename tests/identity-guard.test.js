/**
 * Nothing reads a user's data before the extension knows whose data it is.
 *
 * This is the guarantee that stops another account's solves being written onto
 * this queue — permanently, since `solved` is only ever set true. Reading the
 * call order in progress-manager is not proof, so each platform is driven
 * end to end here with an identity that fails, and the assertion is that the
 * request carrying solve history was never made.
 *
 * The three platforms are guarded for different reasons, and the difference is
 * the point:
 *
 *  - **CodeChef** answers for whoever holds the session cookie, so the
 *    signed-in account is compared against the configured handle.
 *  - **Codeforces and AtCoder** are asked *about* a handle, so who is signed in
 *    to those sites is irrelevant; what is verified is that the handle resolves
 *    to a real account.
 *
 * There are three independent layers, and each test below was confirmed by
 * removing the layer it covers and watching it fail:
 *
 *   1. `adapter.verifyIdentity` before any read, in progress-manager and
 *      contest-manager alike.
 *   2. `classifyIdentity` throws on a blank username, so an identity that was
 *      swallowed rather than verified still cannot get through.
 *   3. CodeChef's `fetchSolvedKeys` verifies again on its own, because its data
 *      is cookie-scoped — this is what survives when 1 and 2 are both defeated.
 *
 * **What this cannot establish, on Codeforces and AtCoder: that the handle is
 * yours.** `user.status?handle=X` returns X's submissions whoever's key signs
 * the request. AtCoder is now checked against the signed-in account, but only
 * refuses on positive evidence of a mismatch; a signed-out browser authenticates
 * nobody. Neither site offers a "who am I" endpoint to compare against. Enter
 * someone else's handle and you get their solves. The containment is that a
 * *changed* identity clears that platform's flags rather than merging them, so
 * the mistake is recoverable — see platform-identity.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { updateSolvedStatus } from "../core/progress-manager.js";

let requests = [];

/**
 * Codeforces keeps its key pair in IndexedDB, which Node has no implementation
 * of — without this, createSession() refuses first and the handle check never
 * runs, so the test would pass for the wrong reason.
 */
function stubSecureStore(records = { api_key: "k", api_secret: "s" }) {
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close() {},
          createObjectStore() {},
          transaction: () => ({
            objectStore: () => ({
              get(key) {
                const r = { result: records[key] ?? null };
                queueMicrotask(() => r.onsuccess?.({ target: r }));
                return r;
              },
              put() {},
              delete() {},
            }),
            set oncomplete(fn) { queueMicrotask(fn); },
            set onerror(_fn) {},
          }),
        };
        request.onsuccess?.({ target: request });
      });
      return request;
    },
    deleteDatabase() { const r = {}; queueMicrotask(() => r.onsuccess?.()); return r; },
  };
}

function stub({ storage, handler }) {
  requests = [];
  stubSecureStore();
  const store = structuredClone(storage);
  globalThis.chrome = {
    storage: { local: {
      async get(query) {
        if (query == null) return structuredClone(store);
        if (typeof query === "string") return { [query]: store[query] };
        if (Array.isArray(query)) return Object.fromEntries(query.map((k) => [k, store[k]]));
        return Object.fromEntries(
          Object.keys(query).map((k) => [k, k in store ? store[k] : query[k]]),
        );
      },
      async set(items) { Object.assign(store, items); },
      async remove() {},
    } },
  };
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    return handler(String(url), options) ?? { ok: false, status: 404 };
  };
  return store;
}

const json = (body) => ({ ok: true, status: 200, async json() { return body; } });
const text = (body) => ({ ok: true, status: 200, async text() { return body; } });

const contestFor = (platform, id, index) => ({
  id, platform, type: "OFFICIAL",
  problems: [{ index, name: "x", rating: 1000, tags: [], solved: false }],
});

test("Codeforces: an unrecognised handle stops before user.status", async () => {
  stub({
    storage: {
      trackedContests: [contestFor("codeforces-official", "2237", "A")],
      "upsolve_tracker.handle": "not_a_real_handle",
    },
    handler: (url) => {
      // user.info answers FAILED for a handle that does not exist.
      if (url.includes("user.info")) return json({ status: "FAILED", comment: "not found" });
      return json({ status: "OK", result: [] });
    },
  });

  const { failures } = await updateSolvedStatus();

  assert.ok(failures.length > 0, "an unverifiable handle must be reported");
  assert.ok(
    requests.some((u) => u.includes("user.info")),
    "the identity check itself must have run",
  );
  assert.ok(
    !requests.some((u) => u.includes("user.status")),
    `submission history was read anyway: ${requests.join(", ")}`,
  );
});

test("AtCoder: a handle the site does not know stops before the submissions feed", async () => {
  stub({
    storage: {
      trackedContests: [contestFor("atcoder", "abc466", "abc466_a")],
      "upsolve_tracker.atcoder_handle": "not_a_real_handle",
    },
    handler: (url) => {
      if (url.includes("atcoder.jp/users/")) return { ok: false, status: 404 };
      return json([]);
    },
  });

  const { failures } = await updateSolvedStatus();

  assert.ok(failures.length > 0);
  assert.ok(requests.some((u) => u.includes("atcoder.jp/users/")), "identity check must have run");
  assert.ok(
    !requests.some((u) => u.includes("/user/submissions")),
    `submission history was read anyway: ${requests.join(", ")}`,
  );
});

test("CodeChef: the wrong signed-in account stops before the solve history", async () => {
  stub({
    storage: {
      trackedContests: [contestFor("codechef", "START252D", "MODSUB")],
      "upsolve_tracker.codechef_handle": "me",
    },
    handler: (url) => {
      if (url.endsWith("/dashboard")) {
        return text(`<script>window.codeChefUserData = {"user":{"username":"someone_else","rating":"1200"}};</script>`);
      }
      return json({ count: 0, data: [] });
    },
  });

  const { failures } = await updateSolvedStatus();

  assert.ok(
    failures.some((f) => /signed in to codechef as someone_else/i.test(f.message)),
    `expected an identity mismatch, got ${JSON.stringify(failures)}`,
  );
  assert.ok(requests.some((u) => u.endsWith("/dashboard")), "identity check must have run");
  assert.ok(
    !requests.some((u) => u.includes("/api/list/problems")),
    `solve history was read anyway: ${requests.join(", ")}`,
  );
});

test("CodeChef: a missing handle stops before anything is read", async () => {
  // No handle at all is not "unconfigured, carry on" — the listing would answer
  // for whoever happens to be signed in.
  stub({
    storage: { trackedContests: [contestFor("codechef", "START252D", "MODSUB")] },
    handler: (url) =>
      url.endsWith("/dashboard")
        ? text(`<script>window.codeChefUserData = {"user":{"username":"anyone","rating":"1200"}};</script>`)
        : json({ count: 0, data: [] }),
  });

  const { failures } = await updateSolvedStatus();

  assert.ok(failures.length > 0, "a missing handle must refuse, not proceed");
  assert.ok(
    !requests.some((u) => u.includes("/api/list/problems")),
    `solve history was read anyway: ${requests.join(", ")}`,
  );
});

test("CodeChef verifies again itself, even if the caller already did", async () => {
  // The third layer. CodeChef is the only platform whose data is scoped by a
  // cookie rather than by a handle we ask about, so it does not rely on the
  // orchestrator having checked: a caller that skipped the check, or swallowed
  // its failure, must still not be able to read somebody else's solves.
  const { fetchAccepted } = await import("../core/platforms/codechef/submissions.js");
  stub({
    storage: { "upsolve_tracker.codechef_handle": "me" },
    handler: (url) =>
      url.endsWith("/dashboard")
        ? text(`<script>window.codeChefUserData = {"user":{"username":"someone_else","rating":"1200"}};</script>`)
        : json({ count: 0, data: [] }),
  });

  const session = { handle: "me", signedIn: true, signedInAs: "someone_else" };
  await assert.rejects(() => fetchAccepted(session, []), /someone_else/);
  assert.ok(
    !requests.some((u) => u.includes("/api/list/problems")),
    `solve history was read anyway: ${requests.join(", ")}`,
  );
});
