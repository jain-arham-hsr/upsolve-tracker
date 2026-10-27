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

import { CodeforcesApi } from "../../../core/platforms/codeforces/api.js";

const reset = (ms) => CodeforcesApi.reset(ms);
const GymService = CodeforcesApi;
const resetGymApiState = (ms) => GymService.reset(ms);

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
  reset(60);
  const stub = stubFetch();
  const service = new CodeforcesApi("key", "secret");

  try {
    await service.usersInfo(["tourist"]);
    await service.contestList();

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `the second call was not paced — fired ${gap}ms after the first`);
  } finally {
    stub.restore();
    reset();
  }
});

test("every service instance shares one budget", async () => {
  // Settings builds a second instance through createSessionFrom to check
  // credentials you have typed but not saved. A per-instance pacer would hand
  // it a fresh allowance and let the two burst against each other.
  reset(60);
  const stub = stubFetch();

  try {
    await new CodeforcesApi("a", "b").contestList();
    await new CodeforcesApi("c", "d").contestList();

    const gap = stub.calls[1].at - stub.calls[0].at;
    assert.ok(gap >= 50, `a second instance skipped the queue — fired ${gap}ms later`);
  } finally {
    stub.restore();
    reset();
  }
});

test("a request is signed, and the secret never appears in the URL", async () => {
  reset();
  const stub = stubFetch();

  try {
    await new CodeforcesApi("thekey", "thesecret").usersInfo(["tourist"]);
    const { url } = stub.calls[0];

    assert.match(url, /apiKey=thekey/);
    assert.match(url, /apiSig=\d{6}[0-9a-f]{128}/, "apiSig is six random digits then a SHA-512");
    // The secret signs the request; sending it would hand the account away.
    assert.ok(!url.includes("thesecret"), "the API secret leaked into the request URL");
  } finally {
    stub.restore();
  }
});

test("with no key pair, a request goes out unsigned and still asks the same thing", async () => {
  // The key is optional: everything an account needs answers anonymously, so
  // an install without one must still reach the API rather than refuse.
  reset();
  const stub = stubFetch();

  try {
    const api = CodeforcesApi.fromSettings({});
    assert.equal(api.signs, false);
    await api.usersInfo(["tourist", "Petr"]);
    const { url } = stub.calls[0];

    assert.match(url, /\/api\/user\.info\?handles=tourist%3BPetr$/);
    assert.ok(!/apiKey|apiSig|time=/.test(url), `an unsigned call carried signing parameters: ${url}`);
  } finally {
    stub.restore();
  }
});

test("half a key pair is refused rather than silently sent unsigned", () => {
  // One half filled in is a mistake, not a choice; reading it as "no key"
  // would hide it until a gym failed to rate.
  assert.throws(() => CodeforcesApi.fromSettings({ api_key: "k" }), /both the Codeforces API key and secret/);
  assert.throws(() => CodeforcesApi.fromSettings({ api_secret: "s" }), /both the Codeforces API key and secret/);
  assert.equal(CodeforcesApi.fromSettings({ api_key: "k", api_secret: "s" }).signs, true);
});

test("a FAILED response becomes the comment Codeforces gave", async () => {
  reset();
  const original = globalThis.fetch;
  const failure = JSON.stringify({
    status: "FAILED",
    comment: "contestId: Standings are not available",
  });
  globalThis.fetch = async (url) => ({
    ok: true, status: 200, url, async text() { return failure; },
  });

  try {
    // This exact string is what codeforces/api.js keys its
    // hidden-standings fallback off, so it has to survive the round trip.
    // `contest.standings` is a gym-only endpoint — the official client dropped
    // it in the split — so this is the gym half of the client.
    await assert.rejects(
      () => new GymService("k", "s").contestStandings(712373),
      /Standings are not available/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Both platforms sign through one class, `codeforces/api.js`. These cases
 * drive each subclass through it and pin what is hashed, since signing is not
 * observable from a response — a wrong `apiSig` comes back as an ordinary
 * FAILED — and a subclass could still override its way out.
 */
test("both Codeforces clients sign a request identically", async () => {
  reset(0);
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
    await new CodeforcesApi("thekey", "thesecret").usersInfo(["tourist"]);
    await new GymService("thekey", "thesecret").usersInfo(["tourist"]);
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
  reset(0);
  resetGymApiState(0);

  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, url, async text() { return '{"status":"OK","result":[]}'; } };
  };

  try {
    await new CodeforcesApi("k", "s").contestList();
    await new GymService("k", "s").contestList({ gym: true });
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

  reset(0);
  resetGymApiState(0);
  const stub = stubFetch();

  try {
    await new CodeforcesApi("thekey", "thesecret").usersInfo(["tourist"]);
    await new GymService("thekey", "thesecret").usersInfo(["tourist"]);

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
    reset();
    resetGymApiState();
  }
});

test("the unsigned standings call goes through the same paced client, unsigned", async () => {
  // The one method that must not sign: Codeforces serves a non-gym standings
  // only to an anonymous request with no extra parameters. It is also the one
  // method no adapter test reaches, since they all stub the service — which is
  // how it once shipped calling a pacer that no longer existed.
  reset(0);
  const stub = stubFetch({ contest: { name: "Round" }, problems: [], rows: [] });

  try {
    const result = await new CodeforcesApi("k", "s").publicContestStandings(2197);
    assert.equal(stub.calls.length, 1);
    const url = new URL(stub.calls[0].url);
    assert.equal(url.pathname, "/api/contest.standings");
    assert.deepEqual([...url.searchParams.keys()], ["contestId"], "must carry no extra parameters");
    assert.equal(result.contest.name, "Round");
  } finally {
    stub.restore();
    reset();
  }
});

// ---------------------------------------------------------------------------
// Paging `contest.status`, for a gym rebuilt from submissions.
// ---------------------------------------------------------------------------

/** A real API with the one route stubbed, the way every Codeforces test injects. */
const fetchContestSubmissions = (service, contestId) =>
  Object.assign(new CodeforcesApi("k", "s"), service).contestSubmissions(contestId);

test("pages until a short page, then stops", async () => {
  const asked = [];
  const service = {
    contestStatus: async (contestId, { from, count }) => {
      asked.push({ from, count });
      return asked.length === 1
        ? Array.from({ length: count }, (_, i) => ({ id: i }))
        : [{ id: 999 }];
    },
  };

  const all = await fetchContestSubmissions(service, 1);
  assert.equal(asked.length, 2);
  assert.equal(asked[1].from, asked[0].from + asked[0].count);
  assert.equal(all.length, asked[0].count + 1);
});

test("refuses a contest too large to rebuild rather than truncating", async () => {
  // An understated solve count reads as a harder problem, not as a failure.
  const service = {
    contestStatus: async (contestId, { count }) =>
      Array.from({ length: count }, (_, i) => ({ id: i })),
  };
  await assert.rejects(
    () => fetchContestSubmissions(service, 1),
    /too many to rebuild/,
  );
});

test("accepted words its own step, naming Codeforces", async () => {
  // The base's fetchAccepted only delegates here, so this is the one place
  // the strip learns whose submissions are being read.
  const api = new CodeforcesApi("k", "s");
  api.userStatus = async () => [
    { verdict: "OK", problem: { contestId: 2266, index: "A" } },
    { verdict: "WRONG_ANSWER", problem: { contestId: 2266, index: "B" } },
  ];
  const messages = [];

  const accepted = await api.accepted("me", (message) => messages.push(message));

  assert.deepEqual(messages, ["Checking your Codeforces submissions…"]);
  assert.deepEqual(accepted, [{ contest: { id: 2266 }, problem: { index: "A" } }]);
});
