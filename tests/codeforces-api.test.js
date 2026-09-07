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

import { CodeforcesService, resetApiState } from "../core/platforms/codeforces-official/sources.js";
import {
  CodeforcesService as GymService,
  resetApiState as resetGymApiState,
} from "../core/platforms/codeforces-gyms/sources.js";

/**
 * The signed client goes through `services/site-client.js` like every other
 * platform, so the stub answers `text()` — the client reads the body once and
 * parses it, because a refusal is as often in the body as in the status. It
 * used to answer `json()` only, back when this path talked to a bare pacer.
 */
function stubFetch(result = []) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push({ url, at: Date.now() });
    const body = JSON.stringify({ status: "OK", result });
    return { ok: true, status: 200, url, async text() { return body; } };
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
  const failure = JSON.stringify({
    status: "FAILED",
    comment: "contestId: Standings are not available",
  });
  globalThis.fetch = async (url) => ({
    ok: true, status: 200, url, async text() { return failure; },
  });

  try {
    // This exact string is what codeforces-gyms/sources.js keys its
    // hidden-standings fallback off, so it has to survive the round trip.
    // `contest.standings` is a gym-only endpoint — the official client dropped
    // it in the split — so this is the gym half of the client.
    await assert.rejects(
      () => new GymService("k", "s").getContestStandings(712373),
      /Standings are not available/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * The two clients are separate files in separate platforms with no shared
 * folder between them, so `_callMethod` and its SHA-512 signing exist twice.
 * That is the one duplication in the Codeforces split with a real failure mode:
 * a fix, or a Codeforces protocol change, applied to one file only.
 *
 * Signing is not observable from a response — a wrong `apiSig` comes back as an
 * ordinary FAILED — so nothing else here would notice the two drifting apart.
 */
test("both Codeforces clients sign a request identically", async () => {
  resetApiState(0);
  resetGymApiState(0);

  const seen = [];
  const original = globalThis.fetch;
  // `apiSig` opens with six random characters by design, so the signature
  // itself cannot be compared directly. Everything else in the URL can, and the
  // *shape* of the signature can: same length, same hex alphabet.
  globalThis.fetch = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, url, async text() { return '{"status":"OK","result":[]}'; } };
  };

  try {
    await new CodeforcesService("thekey", "thesecret").getUsersInfo(["tourist"]);
    await new GymService("thekey", "thesecret").getUsersInfo(["tourist"]);
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(seen.length, 2);
  const [official, gym] = seen.map((url) => new URL(url));

  assert.equal(official.origin + official.pathname, gym.origin + gym.pathname);
  assert.equal(official.searchParams.get("handles"), gym.searchParams.get("handles"));
  assert.equal(official.searchParams.get("apiKey"), gym.searchParams.get("apiKey"));

  const sigs = [official, gym].map((u) => u.searchParams.get("apiSig"));
  for (const sig of sigs) {
    assert.match(sig, /^[0-9a-z]{6}[0-9a-f]{128}$/, `apiSig is not rand + SHA-512: ${sig}`);
  }
  assert.equal(sigs[0].length, sigs[1].length);
});

test("both clients agree on which parameters they append", async () => {
  // The signature covers the sorted parameter list, so a client that appended a
  // different set would sign a different string and be refused — silently, as a
  // FAILED response indistinguishable from a bad key.
  resetApiState(0);
  resetGymApiState(0);

  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, url, async text() { return '{"status":"OK","result":[]}'; } };
  };

  try {
    await new CodeforcesService("k", "s").getContestList();
    await new GymService("k", "s").getContestList();
  } finally {
    globalThis.fetch = original;
  }

  const names = seen.map((url) =>
    [...new URL(url).searchParams.keys()].filter((k) => k !== "gym").sort(),
  );
  assert.deepEqual(names[0], names[1], "the two clients append different parameters");
  // And the one difference that *should* exist: gyms are a separate list.
  assert.ok(!seen[0].includes("gym=true"), "official must not ask for the gym list");
  assert.ok(seen[1].includes("gym=true"), "gyms must ask for the gym list");
});

test("both clients hash the same string, not merely the same shape", async () => {
  // The gap this closes. The two tests above compare the *shape* of a
  // signature — six random characters plus 128 hex, and matching parameter
  // names — which a client that had stopped appending `#${this.apiSecret}` to
  // `textToHash` would still satisfy exactly. It would sign every request with
  // a hash of the public half only, Codeforces would answer FAILED, and the
  // add would fail with "Codeforces API Error" while both assertions passed.
  //
  // So read what actually reaches the hash. `crypto.subtle.digest` receives the
  // encoded `textToHash`, which is the one place the secret, the sort order and
  // the separators are all observable at once.
  const hashed = [];
  const realDigest = crypto.subtle.digest.bind(crypto.subtle);
  const realRandom = Math.random;
  const realNow = Date.now;

  crypto.subtle.digest = async (algorithm, bytes) => {
    hashed.push({ algorithm, text: new TextDecoder().decode(bytes) });
    return realDigest(algorithm, bytes);
  };
  // `rand` and `time` are deliberately unpredictable, so pin both — otherwise
  // the two strings differ for a reason that is not drift.
  Math.random = () => 0.5;
  Date.now = () => 1_700_000_000_000;

  resetApiState(0);
  resetGymApiState(0);
  const stub = stubFetch();

  try {
    await new CodeforcesService("thekey", "thesecret").getUsersInfo(["tourist"]);
    await new GymService("thekey", "thesecret").getUsersInfo(["tourist"]);

    assert.equal(hashed.length, 2, "both clients should have signed once");
    assert.equal(hashed[0].algorithm, "SHA-512");
    assert.equal(hashed[1].algorithm, "SHA-512");

    assert.equal(
      hashed[0].text,
      hashed[1].text,
      "the two Codeforces clients no longer build the signed string the same way",
    );

    // And that the string is the documented one, so both drifting together in
    // the same wrong direction still fails.
    assert.match(
      hashed[0].text,
      /^\d{6}\/user\.info\?apiKey=thekey&handles=tourist&time=1700000000#thesecret$/,
      `signed string is not rand/method?sortedParams#secret: ${hashed[0].text}`,
    );
  } finally {
    crypto.subtle.digest = realDigest;
    Math.random = realRandom;
    Date.now = realNow;
    stub.restore();
    resetApiState();
    resetGymApiState();
  }
});
