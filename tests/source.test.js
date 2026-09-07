/**
 * The shared source base.
 *
 * Worth its own file for the reason `site-client.test.js` gives: four platforms
 * share this, so a mistake here is a mistake on all of them at once. It also
 * replaces five hand-rolled reset seams, and a reset that quietly stopped
 * clearing would leave one test's cached payload answering the next test's
 * question — the kind of failure that shows up as ordering-dependence rather
 * than as a red line.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Source } from "../core/platforms/source.js";

const stubClient = () => {
  const calls = [];
  return {
    calls,
    get: async (url, init) => (calls.push({ how: "get", url, init }), "text"),
    getJson: async (url, init) => (calls.push({ how: "json", url, init }), { ok: true }),
    getDocument: async (url, init) => (calls.push({ how: "doc", url, init }), "doc"),
    reset: (ms) => calls.push({ how: "reset", ms }),
  };
};

test("a relative path joins the origin; an absolute one passes through", () => {
  const source = new Source({ client: stubClient(), origin: "https://atcoder.jp" });

  assert.equal(source.url("/contests/abc1/tasks"), "https://atcoder.jp/contests/abc1/tasks");
  // Codeforces builds full signed URLs itself, so both forms must work.
  assert.equal(source.url("https://codeforces.com/api/x"), "https://codeforces.com/api/x");
});

test("the three accessors reach the client, carrying init through", async () => {
  const client = stubClient();
  const source = new Source({ client, origin: "https://example.com" });

  await source.text("/a");
  await source.json("/b", { headers: { Accept: "application/json" } });
  await source.document("/c");

  assert.deepEqual(
    client.calls.map((c) => [c.how, c.url]),
    [
      ["get", "https://example.com/a"],
      ["json", "https://example.com/b"],
      ["doc", "https://example.com/c"],
    ],
  );
  assert.equal(client.calls[1].init.headers.Accept, "application/json");
});

test("a source refuses to exist without a client", () => {
  // The whole point of the class is to own one. Built without, every accessor
  // would throw somewhere further away, naming the client rather than the
  // source that forgot it.
  assert.throws(() => new Source({ origin: "https://example.com" }), /no client/);
});

test("reset clears the client and every memo the source made", async () => {
  // The seam five platforms hand-rolled. Both halves matter: a reset that
  // cleared the client but not the caches would leave a stale payload
  // answering across tests, which reads as ordering-dependence, not a failure.
  const client = stubClient();
  const source = new Source({ client, origin: "" });

  let loads = 0;
  const read = source.memo(async () => ++loads, { ttlMs: 10_000 });

  assert.equal(await read("k"), 1);
  assert.equal(await read("k"), 1, "should have been cached");

  source.reset(60);

  assert.equal(await read("k"), 2, "reset must clear the memo");
  assert.deepEqual(client.calls.at(-1), { how: "reset", ms: 60 });
});

test("a source with no memos still resets cleanly", () => {
  // Codeforces gyms and AtCoder make none, and `#memos` is only created on
  // first use — so this is the path that would throw on an undefined loop.
  const client = stubClient();
  assert.doesNotThrow(() => new Source({ client }).reset());
});
