/**
 * The pacer absorbed two mechanisms that were not interchangeable, so what is
 * tested here is mostly the *difference* between them.
 *
 * `HttpClient` slept a jittered interval before every request; the pacer waited
 * until a fixed offset from the previous request's *start*. Those agree until a
 * request takes longer than the gap, at which point the second lets the next
 * request go immediately. Codeforces' scrape depends on the first behaviour —
 * its delays are what keeps the extension from being blocked — so a change that
 * quietly re-homed it onto the second would be a real regression that no
 * existing test could see.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createPacer } from "../core/services/request-pacer.js";

/**
 * Records when each request actually fires, and how long each one takes.
 * Timing assertions are given wide tolerance: what matters is which side of a
 * gap a request lands on, not the millisecond.
 */
function stubFetch(durationMs = 0) {
  const firedAt = [];
  const original = globalThis.fetch;

  globalThis.fetch = async () => {
    firedAt.push(Date.now());
    if (durationMs > 0) await new Promise((r) => setTimeout(r, durationMs));
    return { ok: true };
  };

  return {
    firedAt,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ~${expected}ms, got ${Math.round(actual)}ms`,
  );

test('measureFrom "start" lets a slow request eat into the next gap', async () => {
  const fetchStub = stubFetch(150);
  try {
    const paced = createPacer({ gapMs: 60, measureFrom: "start" });
    await paced("https://example.test/1");
    await paced("https://example.test/2");

    const [first, second] = fetchStub.firedAt;
    // The 150ms request already outlasted the 60ms gap, so nothing is owed.
    near(second - (first + 150), 0, 40, "second request should follow immediately");
  } finally {
    fetchStub.restore();
  }
});

test('measureFrom "end" waits the full gap however long the request took', async () => {
  const fetchStub = stubFetch(150);
  try {
    const paced = createPacer({ gapMs: 60, measureFrom: "end" });
    await paced("https://example.test/1");
    await paced("https://example.test/2");

    const [first, second] = fetchStub.firedAt;
    // This is the assertion that stops the Codeforces scrape being sped up.
    near(second - (first + 150), 60, 40, "second request should wait the whole gap");
  } finally {
    fetchStub.restore();
  }
});

test('measureFrom decides whether the *first* request is delayed at all', async () => {
  const fromStart = stubFetch();
  try {
    const started = Date.now();
    await createPacer({ gapMs: 120, measureFrom: "start" })("https://example.test/");
    near(fromStart.firedAt[0] - started, 0, 40, '"start" should not delay the first request');
  } finally {
    fromStart.restore();
  }

  const fromEnd = stubFetch();
  try {
    const started = Date.now();
    await createPacer({ gapMs: 120, measureFrom: "end" })("https://example.test/");
    // HttpClient slept before every request including the first, and that is
    // one fewer unthrottled hit at the start of an add.
    near(fromEnd.firedAt[0] - started, 120, 50, '"end" should delay the first request');
  } finally {
    fromEnd.restore();
  }
});

test("a cooldown replaces the Nth request's gap rather than adding to it", async () => {
  const fetchStub = stubFetch();
  try {
    const paced = createPacer({
      gapMs: 20,
      cooldown: { everyNth: 3, gapMs: 200 },
    });
    for (let i = 0; i < 3; i++) await paced("https://example.test/");

    const [first, second, third] = fetchStub.firedAt;
    near(second - first, 20, 40, "the second request takes the normal gap");
    near(third - second, 200, 60, "the third takes the cooldown, not cooldown + gap");
  } finally {
    fetchStub.restore();
  }
});

test("concurrent callers queue instead of sleeping in parallel and firing together", async () => {
  const fetchStub = stubFetch();
  try {
    const paced = createPacer({ gapMs: 80 });
    // The exact shape HttpClient got wrong: it slept per call with no queue, so
    // two callers slept the same interval simultaneously and then burst.
    await Promise.all([paced("https://example.test/a"), paced("https://example.test/b")]);

    const [first, second] = fetchStub.firedAt;
    assert.ok(
      second - first >= 40,
      `concurrent requests burst: fired ${second - first}ms apart`,
    );
  } finally {
    fetchStub.restore();
  }
});

test("setSpacing pins every gap, cooldowns included", async () => {
  const fetchStub = stubFetch();
  try {
    const paced = createPacer({
      gapMs: [1000, 2500],
      measureFrom: "end",
      cooldown: { everyNth: 2, gapMs: 6000 },
    });
    paced.setSpacing(0);

    const started = Date.now();
    for (let i = 0; i < 3; i++) await paced("https://example.test/");

    // Without the cooldown being pinned too, this suite would spend 6 seconds
    // here observing an etiquette rule it is not exercising.
    near(Date.now() - started, 0, 100, "a pinned pacer should not sleep");
  } finally {
    fetchStub.restore();
  }
});

test("reset clears the cooldown counter as well as the clock", async () => {
  const fetchStub = stubFetch();
  try {
    const paced = createPacer({ gapMs: 10, cooldown: { everyNth: 2, gapMs: 200 } });
    await paced("https://example.test/");
    // Mid-cycle: without resetting the count, the next request after a reset
    // would be treated as the 2nd and pay a cooldown it has not earned.
    paced.reset();

    const started = Date.now();
    await paced("https://example.test/");
    near(Date.now() - started, 10, 60, "the first request after a reset is not a cooldown");
  } finally {
    fetchStub.restore();
  }
});

test("two pacers sharing a budget serve one gap, not two", async () => {
  // Independence is the default and the wrong answer for two clients addressing
  // one host. Codeforces is two platforms with an API client each; two clients
  // each honouring a 2s gap would serve one request per second to
  // codeforces.com — the exact failure per-instance state exists to prevent,
  // reached from the other direction.
  const at = [];
  const stub = async () => {
    at.push(Date.now());
    return new Response("ok");
  };

  const name = `test-budget-${Math.random()}`;
  const one = createPacer({ gapMs: 60, budget: name, fetchImpl: stub });
  const two = createPacer({ gapMs: 60, budget: name, fetchImpl: stub });

  // Interleaved on purpose: alternating clients is what an unshared budget
  // would let through back-to-back.
  await Promise.all([one("/a"), two("/b"), one("/c"), two("/d")]);

  assert.equal(at.length, 4);
  for (let i = 1; i < at.length; i++) {
    assert.ok(
      at[i] - at[i - 1] >= 50,
      `request ${i + 1} came ${at[i] - at[i - 1]}ms after the last; the budget is not shared`,
    );
  }
});

test("a pacer with no budget keeps its own state, as it always has", async () => {
  // The sharing must be opt-in. If it leaked into unnamed pacers, one site's
  // traffic would pace another's — which is what the single static counter in
  // the old HttpClient did.
  const at = [];
  const stub = async () => {
    at.push(Date.now());
    return new Response("ok");
  };

  const one = createPacer({ gapMs: 60, fetchImpl: stub });
  const two = createPacer({ gapMs: 60, fetchImpl: stub });
  await Promise.all([one("/a"), two("/b")]);

  assert.equal(at.length, 2);
  near(at[1] - at[0], 0, 40, "independent pacers must not wait for each other");
});
