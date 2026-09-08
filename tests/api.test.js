/**
 * The shared `Api` base.
 *
 * Worth its own file for the reason `site-client.test.js` gives: three sites
 * share this, so a mistake here is a mistake on all of them at once. A reset
 * that quietly stopped clearing would leave one test's cached payload
 * answering the next test's question — the kind of failure that shows up as
 * ordering-dependence rather than as a red line.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Api } from "../core/platforms/api.js";

const stubClient = () => {
  const calls = [];
  return {
    calls,
    getJson: async (url, init) => (calls.push({ how: "json", url, init }), { ok: true }),
    reset: (ms) => calls.push({ how: "reset", ms }),
  };
};

test("a relative path joins the origin; an absolute one passes through", () => {
  const api = new Api({ client: stubClient(), origin: "https://atcoder.jp" });

  assert.equal(api.url("/contests/abc1/standings/json"), "https://atcoder.jp/contests/abc1/standings/json");
  // Codeforces builds full signed URLs itself, so both forms must work.
  assert.equal(api.url("https://codeforces.com/api/x"), "https://codeforces.com/api/x");
});

test("json reaches the client, carrying init through", async () => {
  const client = stubClient();
  const api = new Api({ client, origin: "https://example.com" });

  await api.json("/b", { headers: { Accept: "application/json" } });

  assert.deepEqual(client.calls.map((c) => [c.how, c.url]), [["json", "https://example.com/b"]]);
  assert.equal(client.calls[0].init.headers.Accept, "application/json");
});

test("an API refuses to exist without a client", () => {
  // The whole point of the class is to own one. Built without, `json` would
  // throw somewhere further away, naming the client rather than the API that
  // forgot it.
  assert.throws(() => new Api({ origin: "https://example.com" }), /no client/);
});

test("the two statics are a contract, not a default", () => {
  // A subclass that forgot either would answer the base's throw at the first
  // session built, naming itself, rather than silently sharing nothing.
  class Forgetful extends Api {}
  assert.throws(() => Forgetful.fromSettings({}), /Forgetful must implement static fromSettings/);
  assert.throws(() => Forgetful.reset(), /Forgetful must implement static reset/);
});

test("reset clears the client and every memo the API made", async () => {
  // Both halves matter: a reset that cleared the client but not the caches
  // would leave a stale payload answering across tests.
  const client = stubClient();
  const api = new Api({ client, origin: "" });

  let loads = 0;
  const read = api.memo(async () => ++loads, { ttlMs: 10_000 });

  assert.equal(await read("k"), 1);
  assert.equal(await read("k"), 1, "should have been cached");

  api.reset(60);

  assert.equal(await read("k"), 2, "reset must clear the memo");
  assert.deepEqual(client.calls.at(-1), { how: "reset", ms: 60 });
});

test("an API with no memos still resets cleanly", () => {
  // AtCoder's makes none, and `#memos` is only created on first use — so
  // this is the path that would throw on an undefined loop.
  assert.doesNotThrow(() => new Api({ client: stubClient() }).reset());
});
