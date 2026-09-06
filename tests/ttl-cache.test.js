/**
 * The shared short-lived cache.
 *
 * Worth its own file for the reason `site-client.test.js` gives: two platforms
 * now share this, so a mistake here is a mistake on both at once. It also had
 * no coverage at all in either of the hand-rolled copies it replaced — the
 * caching was exercised incidentally by adapter tests that would still pass if
 * it stopped caching entirely, since a cache that never hits is invisible in
 * the result and only visible in the request count.
 *
 * Both callers care about the *expiry* as much as the hit: Codeforces' is a
 * publication check, where holding a stale "not published yet" strands a
 * contest for the length of the window.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { withTtlCache } from "../core/services/ttl-cache.js";

/** Time has to be driven, not waited on. */
function atTime(start = 1_000_000) {
  const real = Date.now;
  let now = start;
  Date.now = () => now;
  return {
    advance: (ms) => { now += ms; },
    restore: () => { Date.now = real; },
  };
}

test("a second read inside the window does not call through", async () => {
  const clock = atTime();
  let calls = 0;
  const read = withTtlCache(async () => ++calls, { ttlMs: 100 });

  try {
    assert.equal(await read(), 1);
    clock.advance(99);
    assert.equal(await read(), 1, "the cached value should have been reused");
    assert.equal(calls, 1);
  } finally {
    clock.restore();
  }
});

test("the value expires, rather than being held for the session", async () => {
  const clock = atTime();
  let calls = 0;
  const read = withTtlCache(async () => ++calls, { ttlMs: 100 });

  try {
    await read();
    clock.advance(100);
    assert.equal(await read(), 2, "a stale answer must not outlive its window");
  } finally {
    clock.restore();
  }
});

test("entries are keyed, so one contest does not answer for another", async () => {
  // CodeChef's case: several contests read within one refresh.
  const read = withTtlCache(async (code) => `body:${code}`, { ttlMs: 10_000 });

  assert.equal(await read("START252D"), "body:START252D");
  assert.equal(await read("START251A"), "body:START251A");
  assert.equal(await read("START252D"), "body:START252D");
});

test("clear() forces a genuinely fresh read", async () => {
  // The seam a retry uses: the whole point of re-adding a waiting contest is to
  // ask again, so a cached "not published yet" would make the retry a no-op.
  let calls = 0;
  const read = withTtlCache(async () => ++calls, { ttlMs: 10_000 });

  await read();
  read.clear();
  assert.equal(await read(), 2);
});

test("arguments after the key are forwarded but do not key the entry", async () => {
  // How Codeforces caches one problemset across every service instance while
  // still letting the instance that asked sign the call. If these keyed the
  // entry, Settings building a second service to check typed credentials would
  // re-fetch ~2 MB.
  const seen = [];
  const read = withTtlCache(
    async (_key, service) => { seen.push(service); return "problemset"; },
    { ttlMs: 10_000 },
  );

  await read("", "first-service");
  await read("", "second-service");

  assert.deepEqual(seen, ["first-service"], "the second read should have hit the cache");
});
