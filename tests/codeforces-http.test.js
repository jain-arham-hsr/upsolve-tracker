/**
 * Recognising when Codeforces refuses, and being paced while asking.
 *
 * Neither half had ever been executed. `scraping.test.js` and the adapter tests
 * all stub `CodeforcesHttp.get` wholesale, which is right for what they are
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

import { CodeforcesHttp, resetHttpState } from "../core/platforms/codeforces/http.js";

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
      () => CodeforcesHttp.get("https://codeforces.com/contest/1/standings"),
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
      () => CodeforcesHttp.get("https://codeforces.com/contest/1/standings"),
      /blocking requests/,
    );
  } finally {
    stub.restore();
  }
});

test("an ordinary page comes back as text", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html><table class='standings'></table></html>"));
  try {
    const body = await CodeforcesHttp.get("https://codeforces.com/contest/1/standings");
    assert.match(body, /standings/);
  } finally {
    stub.restore();
  }
});

test("the session cookie is sent, which is what makes a private gym readable", async () => {
  resetHttpState();
  const stub = stubFetch(async () => ok("<html></html>"));
  try {
    await CodeforcesHttp.get("https://codeforces.com/gym/712373/standings");
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
    await CodeforcesHttp.get("https://codeforces.com/contest/1/standings");
    await CodeforcesHttp.get("https://codeforces.com/contest/2/standings");

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `the second request was not paced — fired ${gap}ms after the first`);
  } finally {
    stub.restore();
    resetHttpState();
  }
});
