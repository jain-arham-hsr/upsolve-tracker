/**
 * Keeping the queue in Firestore: what is pushed, how little, what is pulled,
 * and how the first sign-in on a device settles two queues.
 *
 * The write counts are asserted, not just the end state. A sync that rewrote
 * every contest on every refresh would leave identical documents behind and
 * pass any test that only looked at them — while spending the free tier's
 * 20,000 daily writes in a few hundred refreshes across all users.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isDeviceLocal,
  pullStore,
  reconcileOnSignIn,
  resetCloudState,
  saveToCloud,
} from "../core/services/cloud-sync.js";
import { CONFIGURED, fakeFirebase, fakeStorage } from "./helpers/fake-firebase.js";

const contest = (id, rating = 800) => ({
  id,
  platform: "codeforces-official",
  name: `Round ${id}`,
  problems: [{ index: "A", name: "A", rating, ratingSource: "official", tags: [], solved: false }],
});

const world = ({ local = {}, docs = {}, user, owner } = {}) => {
  const firebase = fakeFirebase({ docs, user, owner });
  const storage = fakeStorage(local);
  return { firebase, storage, options: { ...CONFIGURED, firebase, storage } };
};

test("an unconfigured build says nothing: there is no cloud to turn on", async () => {
  const { firebase, storage } = world({ local: { trackedContests: [contest("1")] } });
  assert.equal(await saveToCloud({ firebase, storage, config: {} }), null);
  assert.deepEqual(firebase.writes, []);
});

test("signed out, every save says cloud backup is off", async () => {
  const w = world({ user: null, local: { trackedContests: [contest("1")] } });
  const outcome = await saveToCloud(w.options);
  assert.equal(outcome.tone, "warning");
  assert.match(outcome.message, /Cloud backup is off/);
});

test("the first push writes each contest and the settings document, and nothing device-local", async () => {
  const w = world({
    local: {
      trackedContests: [contest("1"), contest("2")],
      "upsolve_tracker.handle": "tourist",
    },
  });
  assert.equal(await saveToCloud(w.options), null);
  assert.deepEqual(w.firebase.writes.sort(), [
    "set users/u1",
    "set users/u1/contests/codeforces-official:1",
    "set users/u1/contests/codeforces-official:2",
  ]);
  const settings = JSON.parse(w.firebase.store.get("users/u1").json);
  assert.deepEqual(Object.keys(settings), ["upsolve_tracker.handle"]);
  assert.ok(Object.keys(w.storage.data).some(isDeviceLocal), "bookkeeping is kept locally");
});

test("a later push writes only what changed, and deletes what was removed", async () => {
  const w = world({ local: { trackedContests: [contest("1"), contest("2")] } });
  await saveToCloud(w.options);
  w.firebase.writes.length = 0;

  assert.equal(await saveToCloud(w.options), null);
  assert.deepEqual(w.firebase.writes, [], "an unchanged queue cost writes");

  w.storage.data.trackedContests = [contest("1", 900)];
  await saveToCloud(w.options);
  assert.deepEqual(w.firebase.writes.sort(), [
    "remove users/u1/contests/codeforces-official:2",
    "set users/u1",
    "set users/u1/contests/codeforces-official:1",
  ]);
});

test("a failed push is an error that says the queue is still safe here", async () => {
  const w = world({ local: { trackedContests: [contest("1")] } });
  w.firebase.fail(new Error("unavailable"));
  const outcome = await saveToCloud(w.options);
  assert.equal(outcome.tone, "error");
  assert.match(outcome.message, /still saved on this device/);
});

test("another device's newer push is pulled; an older or equal one is not", async () => {
  const a = world({ local: { trackedContests: [contest("1")], "upsolve_tracker.handle": "x" } });
  await saveToCloud(a.options);

  // A second device, sharing the cloud, with nothing local yet.
  const b = { ...a, storage: fakeStorage(), options: { ...a.options, storage: fakeStorage() } };
  assert.equal(await pullStore(b.options), true);
  const pulled = await b.options.storage.get(null);
  assert.deepEqual(pulled.trackedContests.map((c) => c.id), ["1"]);
  assert.equal(pulled["upsolve_tracker.handle"], "x");

  assert.equal(await pullStore(b.options), false, "pulled the same copy twice");
  // And having pulled, it is in step: pushing again writes nothing.
  a.firebase.writes.length = 0;
  await saveToCloud(b.options);
  assert.deepEqual(a.firebase.writes, []);
});

test("a pulled copy drops local keys the cloud no longer has, but keeps bookkeeping", async () => {
  const a = world({ local: { trackedContests: [contest("1")] } });
  await saveToCloud(a.options);
  const storage = fakeStorage({ "upsolve_tracker.platform_filter": ["x"], trackedContests: [] });
  await pullStore({ ...a.options, storage });
  assert.ok(!("upsolve_tracker.platform_filter" in storage.data));
  assert.ok(Object.keys(storage.data).some(isDeviceLocal));
});

test("first sign-in: an empty cloud is filled from this device", async () => {
  const w = world({ local: { trackedContests: [contest("1")] } });
  assert.equal(await reconcileOnSignIn({ choose: () => assert.fail("nothing to choose") }, w.options), "uploaded");
  assert.ok(w.firebase.store.has("users/u1/contests/codeforces-official:1"));
});

test("first sign-in: an empty device takes the cloud's queue", async () => {
  const a = world({ local: { trackedContests: [contest("1")] } });
  await saveToCloud(a.options);
  const storage = fakeStorage();
  const result = await reconcileOnSignIn({ choose: () => assert.fail("nothing to choose") }, { ...a.options, storage });
  assert.equal(result, "downloaded");
  assert.deepEqual(storage.data.trackedContests.map((c) => c.id), ["1"]);
});

test("first sign-in with two queues asks, and keeping this device's replaces the cloud's", async () => {
  const a = world({ local: { trackedContests: [contest("1"), contest("2")] } });
  await saveToCloud(a.options);

  const storage = fakeStorage({ trackedContests: [contest("3")] });
  let asked;
  const result = await reconcileOnSignIn(
    { choose: async (counts) => ((asked = counts), "device") },
    { ...a.options, storage },
  );
  assert.equal(result, "kept-device");
  assert.deepEqual(asked, { device: 1, cloud: 2 });
  const remaining = [...a.firebase.store.keys()].filter((k) => k.startsWith("users/u1/contests/"));
  assert.deepEqual(remaining, ["users/u1/contests/codeforces-official:3"]);
});

test("a different account signing in starts over rather than trusting the old fingerprints", async () => {
  const w = world({ local: { trackedContests: [contest("1")] } });
  await saveToCloud(w.options);
  w.firebase.signInAs({ uid: "u2", email: null });
  w.firebase.writes.length = 0;

  await saveToCloud(w.options);
  assert.ok(w.firebase.writes.includes("set users/u2/contests/codeforces-official:1"),
    "the second account's cloud copy was never written");
});

test("signing out forgets this device's sync state", async () => {
  const w = world({ local: { trackedContests: [contest("1")] } });
  await saveToCloud(w.options);
  await resetCloudState(w.options);
  assert.ok(!Object.keys(w.storage.data).some(isDeviceLocal));
  assert.deepEqual(w.storage.data.trackedContests.map((c) => c.id), ["1"], "the queue itself stays");
});

test("the owner's save also publishes; anyone else's does not", async () => {
  const owner = world({ owner: "u1", local: { trackedContests: [contest("1")] } });
  await saveToCloud(owner.options);
  assert.ok(owner.firebase.writes.includes("set catalog/codeforces-official:1"));

  const user = world({ owner: "someone-else", local: { trackedContests: [contest("1")] } });
  await saveToCloud(user.options);
  assert.ok(!user.firebase.writes.some((w) => w.startsWith("set catalog/")));
});
