/**
 * The signed API, which until recently was paced by nothing at all.
 *
 * Its calls happened to be spaced out in practice, because the throttled
 * standings scrape usually ran between them — so an add never looked bursty
 * even though nothing enforced it. Where no scrape sat in between, the call
 * sites had each grown their own `await delay(2000)`: two in
 * rating-distribution.js, one in start-times.js. Three local patches for one
 * missing rule.
 *
 * Those are gone now, which makes this the only thing standing between an add
 * and a burst of unpaced requests at an API that publishes a rate limit. It is
 * also invisible — nothing about a response says whether a delay was served —
 * so it needs asserting directly or it can be removed without anything noticing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CodeforcesService, resetApiState } from "../core/platforms/codeforces/api.js";

function stubFetch(result = []) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push({ url, at: Date.now() });
    return { async json() { return { status: "OK", result }; } };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("consecutive API calls are paced", async () => {
  // A pinned, small gap: the real one is 2s, which is not worth spending here.
  resetApiState(60);
  const stub = stubFetch();
  const service = new CodeforcesService("key", "secret");

  try {
    await service.getUsersInfo(["tourist"]);
    await service.getContestList();

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `the second call was not paced — fired ${gap}ms after the first`);
  } finally {
    stub.restore();
    resetApiState();
  }
});

test("every service instance shares one budget", async () => {
  // Settings builds a second instance through createSessionFrom to check
  // credentials you have typed but not saved. A per-instance pacer would hand
  // it a fresh allowance and let the two burst against each other.
  resetApiState(60);
  const stub = stubFetch();

  try {
    await new CodeforcesService("a", "b").getContestList();
    await new CodeforcesService("c", "d").getContestList();

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `a second instance skipped the queue — fired ${gap}ms later`);
  } finally {
    stub.restore();
    resetApiState();
  }
});

test("a request is signed, and the secret never appears in the URL", async () => {
  resetApiState();
  const stub = stubFetch();

  try {
    await new CodeforcesService("thekey", "thesecret").getUsersInfo(["tourist"]);
    const { url } = stub.calls[0];

    assert.match(url, /apiKey=thekey/);
    assert.match(url, /apiSig=\d{6}[0-9a-f]{128}/, "apiSig is six random digits then a SHA-512");
    // The secret signs the request; sending it would hand the account away.
    assert.ok(!url.includes("thesecret"), "the API secret leaked into the request URL");
  } finally {
    stub.restore();
  }
});

test("a FAILED response becomes the comment Codeforces gave", async () => {
  resetApiState();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    async json() {
      return { status: "FAILED", comment: "contestId: Standings are not available" };
    },
  });

  try {
    // This exact string is what codeforces/solve-stats.js keys its
    // hidden-standings fallback off, so it has to survive the round trip.
    await assert.rejects(
      () => new CodeforcesService("k", "s").getContestStandings(712373),
      /Standings are not available/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
