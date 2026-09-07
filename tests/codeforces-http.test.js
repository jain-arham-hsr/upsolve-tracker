/**
 * Recognising when Codeforces refuses, and being paced while asking.
 *
 * Neither half had ever been executed. `scraping.test.js` and the adapter tests
 * all stub `CodeforcesHttp.getDocument` wholesale, which is right for what they are
 * testing but means the challenge detection below them never ran — and the one
 * test that mentions "blocking requests" hand-*constructs* that error to check
 * a caller rethrows it, so it asserts nothing about how the error is produced.
 *
 * That matters because this is the code that turns a Cloudflare wall into a
 * sentence a user can act on. If it stopped firing, a blocked scrape would
 * instead hand the interstitial's HTML to the standings parser, which would
 * find no table and report something entirely unrelated.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

// The client parses before it answers, so these need a DOM the way the browser
// gives production one.
globalThis.DOMParser = DOMParser;

import { GymSources } from "../core/platforms/codeforces-gyms/sources.js";

const CodeforcesHttp = new GymSources("k", "s");
const resetHttpState = (ms) => GymSources.reset(ms);

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, at: Date.now() });
    return handler(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const ok = (body) => ({ status: 200, async text() { return body; } });

test("a 403 becomes a sentence about visiting codeforces.com", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ({ status: 403, async text() { return ""; } }));
  try {
    await assert.rejects(
      () => CodeforcesHttp.getDocument("https://codeforces.com/contest/1/standings"),
      /blocking requests.*visit codeforces\.com/s,
    );
  } finally {
    stub.restore();
  }
});

test("a 200 carrying Cloudflare's interstitial is caught too", async () => {
  // The nastier of the two: the status says success, so nothing downstream
  // would notice — the standings parser would just find no table and blame the
  // markup.
  resetHttpState();
  const stub = stubFetch(async () => ok("<html><body>Just a moment...</body></html>"));
  try {
    await assert.rejects(
      () => CodeforcesHttp.getDocument("https://codeforces.com/contest/1/standings"),
      /blocking requests/,
    );
  } finally {
    stub.restore();
  }
});

test("an ordinary page comes back parsed, ready for the scrapers", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html><table class='problems'></table></html>"));
  try {
    const doc = await CodeforcesHttp.getDocument("https://codeforces.com/gym/1");
    // A Document rather than the string: everything in `scrapers/` takes one,
    // and the parse happening in the client is what keeps `DOMParser` out of
    // platform code entirely.
    assert.ok(doc.querySelector("table.problems"), "the page should arrive queryable");
  } finally {
    stub.restore();
  }
});

test("the session cookie is sent, which is what makes a private gym readable", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html></html>"));
  try {
    await CodeforcesHttp.getDocument("https://codeforces.com/gym/712373/standings");
    assert.equal(
      stub.calls[0].init.credentials,
      "include",
      "without the cookie a private gym's standings are invisible and the add fails for the wrong reason",
    );
  } finally {
    stub.restore();
  }
});

test("requests actually go through the pacer", async () => {
  // The scrape's throttling is what keeps the extension from being blocked, and
  // it is invisible: nothing about a response says whether a delay was served.
  // A pinned, small gap is observable where the real 1–2.5s one is not.
  resetHttpState(60);
  const stub = stubFetch(async () => ok("<html></html>"));
  try {
    await CodeforcesHttp.getDocument("https://codeforces.com/contest/1/standings");
    await CodeforcesHttp.getDocument("https://codeforces.com/contest/2/standings");

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `the second request was not paced — fired ${gap}ms after the first`);
  } finally {
    stub.restore();
    resetHttpState();
  }
});

test("a block is flagged, so it can wait instead of failing the add", async () => {
  // Before this flag existed the block threw bare, and nothing turned it into a
  // status — so `contest-manager.js` never set `isNotPublishedYet`, `ui/index.js`
  // never made a waiting entry, and a Cloudflare challenge failed the add
  // outright. The user had to notice and press Add again. `contest-status.js`
  // had always defined `sourceUnreachable` for exactly this; only the wiring
  // was missing.
  //
  // A flag, not a message match: a copy edit to that sentence must not silently
  // change which failures retry.
  for (const response of [
    { status: 403, async text() { return ""; } },
    { status: 200, async text() { return "<html>Just a moment</html>"; } },
  ]) {
    resetHttpState();
    globalThis.fetch = async () => response;

    const error = await CodeforcesHttp.getDocument("https://codeforces.com/contest/1/standings").then(
      () => null,
      (e) => e,
    );
    assert.ok(error, "a block must throw");
    assert.equal(error.isSourceUnreachable, true, `status ${response.status} was not flagged`);
  }
});

test("an ordinary failure is not flagged, so it still fails loudly", async () => {
  // Only the challenge waits. A layout change or a genuine fault must not be
  // quietly retried forever under the same flag.
  resetHttpState();
  globalThis.fetch = async () => ({ status: 200, async text() { return "<html><p>fine</p></html>"; } });
  const doc = await CodeforcesHttp.getDocument("https://codeforces.com/x");
  assert.match(doc.querySelector("p").textContent, /fine/);
});
