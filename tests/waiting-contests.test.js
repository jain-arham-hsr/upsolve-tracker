/**
 * Contests remembered because the platform had not published them yet.
 *
 * Every case here is one that fails *silently* if it regresses. The queue
 * looks fine either way — a wait that was quietly dropped and a wait that is
 * still pending are indistinguishable until the contest never turns up, by
 * which time the round is days old and the user has stopped looking.
 *
 * The sharpest one is the outage case. `processNewContest` verifies identity
 * before it fetches anything, so a 503 or an expired session throws something
 * that is *not* a publication delay. Dropping the entry on that would lose the
 * wait to a network blip, which is exactly the failure this whole mechanism
 * exists to prevent.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

let store;
function stubChrome(initial = {}) {
  store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return out;
        },
        async set(patch) { Object.assign(store, structuredClone(patch)); },
      },
    },
  };
}

const {
  loadWaiting,
  addWaiting,
  cancelWaiting,
  findWaiting,
  retryWaitingContests,
  WAITING_STORAGE_KEY,
} = await import("../core/waiting-contests.js");

const ATC = (id) => ({
  url: `https://atcoder.jp/contests/${id}`,
  platformId: "atcoder",
  contestId: id,
});

/** A stub `processNewContest`, recording how it was called. */
function adder(behaviour) {
  const calls = [];
  const fn = async (url, _onProgress, options) => {
    calls.push({ url, revalidate: options?.revalidate });
    return behaviour(url);
  };
  fn.calls = calls;
  return fn;
}

const fails = (message, flags = {}) => {
  const error = new Error(message);
  Object.assign(error, flags);
  throw error;
};

beforeEach(() => stubChrome());

test("a waiting entry is keyed exactly like a tracked contest", async () => {
  // Contest identity is platform:id everywhere else, and a waiting entry that
  // keyed on the bare id would let a CodeChef "1000" and a Codeforces 1000
  // stand for each other.
  await addWaiting(ATC("abc472"));
  const entries = await loadWaiting();

  assert.equal(entries.length, 1);
  assert.ok(findWaiting(entries, "atcoder", "abc472"));
  assert.equal(findWaiting(entries, "codeforces", "abc472"), null);
});

test("adding the same contest twice queues one attempt, keeping the original start", async () => {
  const first = await addWaiting(ATC("abc472"));
  // How long this has been going is the only thing separating a fresh delay
  // from an entry that is never going to resolve.
  const again = await addWaiting({ ...ATC("abc472"), lastError: "still nothing" });

  assert.equal((await loadWaiting()).length, 1);
  assert.equal(again.waitingSince, first.waitingSince);
  assert.equal(again.lastError, "still nothing");
});

test("cancelling removes only that contest", async () => {
  await addWaiting(ATC("abc472"));
  await addWaiting(ATC("abc473"));
  await cancelWaiting("atcoder", "abc472");

  const left = await loadWaiting();
  assert.deepEqual(left.map((entry) => entry.contestId), ["abc473"]);
});

test("a retry that succeeds drops the entry and reports what arrived", async () => {
  await addWaiting(ATC("abc472"));

  const add = adder(() => ({ id: "abc472", platform: "atcoder", problems: [] }));
  const { added, stillWaiting } = await retryWaitingContests(() => {}, {
    addContest: add,
  });

  assert.deepEqual(added.map((entry) => entry.id), ["abc472"]);
  assert.equal(stillWaiting.length, 0);
  assert.deepEqual(await loadWaiting(), []);
});

test("an outage keeps the entry waiting rather than dropping it", async () => {
  // The regression this file exists for. A failure that is not a publication
  // delay still leaves the contest unpublished — losing the wait to it means
  // the user silently never gets the contest they asked for.
  await addWaiting(ATC("abc472"));

  const add = adder(() => fails("AtCoder returned 503 for that profile."));
  const { added, dropped, stillWaiting } = await retryWaitingContests(() => {}, {
    addContest: add,
  });

  assert.deepEqual(added, []);
  assert.deepEqual(dropped, []);
  assert.equal(stillWaiting.length, 1);

  const [kept] = await loadWaiting();
  assert.equal(kept.contestId, "abc472");
  // Recorded, because it is the only place a genuinely stuck entry is visible.
  assert.match(kept.lastError, /503/);
});

test("a still-unpublished contest keeps waiting, which is the whole point", async () => {
  await addWaiting(ATC("abc472"));

  const add = adder(() =>
    fails(`AtCoder Problems doesn't list contest "abc472".`, {
      isNotPublishedYet: true,
    }),
  );
  await retryWaitingContests(() => {}, { addContest: add });

  assert.equal((await loadWaiting()).length, 1);
});

test("a contest with nothing left to solve stops waiting", async () => {
  // The one failure that will never resolve on a later refresh, and the only
  // reason besides success to give up. Flagged on the error rather than
  // matched by sentence, so a copy edit cannot turn it into a forever-retry.
  await addWaiting(ATC("abc472"));

  const add = adder(() =>
    fails("All problems in abc472 are already solved!", { isAlreadySolved: true }),
  );
  const { dropped } = await retryWaitingContests(() => {}, { addContest: add });

  assert.equal(dropped.length, 1);
  assert.deepEqual(await loadWaiting(), []);
});

test("a contest added by hand meanwhile is dropped without a request", async () => {
  await addWaiting(ATC("abc472"));
  store.trackedContests = [
    { id: "abc472", platform: "atcoder", problems: [] },
  ];

  const add = adder(() => fails("should never be called"));
  const { added, dropped } = await retryWaitingContests(() => {}, {
    addContest: add,
  });

  assert.deepEqual(add.calls, [], "it retried a contest it already had");
  assert.deepEqual(added, []);
  assert.deepEqual(dropped, []);
  assert.deepEqual(await loadWaiting(), []);
});

test("one entry failing does not stop the others being retried", async () => {
  // Same isolation rule progress-manager applies per platform. Without it a
  // single stuck contest at the front of the list freezes every other wait
  // indefinitely, and nothing says so.
  await addWaiting(ATC("abc472"));
  await addWaiting(ATC("abc473"));
  await addWaiting(ATC("abc474"));

  const add = adder((url) =>
    url.endsWith("abc473")
      ? fails("network died")
      : { id: url.split("/").pop(), platform: "atcoder", problems: [] },
  );
  const { added, stillWaiting } = await retryWaitingContests(() => {}, {
    addContest: add,
  });

  assert.deepEqual(added.map((entry) => entry.id), ["abc472", "abc474"]);
  assert.deepEqual(stillWaiting.map((entry) => entry.contestId), ["abc473"]);
});

test("bulk data is revalidated once per platform, not once per entry", async () => {
  // Revalidating per entry would fire four conditional requests for four
  // AtCoder contests against a service whose published etiquette rule is one
  // request per second — and the first revalidation already made the rest
  // fresh.
  await addWaiting(ATC("abc472"));
  await addWaiting(ATC("abc473"));
  await addWaiting({
    url: "https://codeforces.com/contest/2193",
    platformId: "codeforces",
    contestId: "2193",
  });

  const add = adder(() => fails("still nothing"));
  await retryWaitingContests(() => {}, { addContest: add });

  assert.deepEqual(
    add.calls.map((call) => call.revalidate),
    [true, false, true],
    "each platform revalidates on its first entry only",
  );
});

test("waiting entries never touch the tracked queue", async () => {
  // They carry no problems array. Filed under trackedContests they would fail
  // backup validation and throw while rendering the list.
  await addWaiting(ATC("abc472"));

  assert.equal(store.trackedContests, undefined);
  assert.ok(Array.isArray(store[WAITING_STORAGE_KEY]));
});
