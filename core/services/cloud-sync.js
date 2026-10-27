/**
 * Your queue, kept in Firestore so losing Chrome's data does not lose it.
 *
 * `chrome.storage.local` stays the working copy — the panel reads it, works
 * offline, and never waits on the network. This mirrors it: every write that
 * changes storage calls `saveToCloud()`, and opening the panel pulls whatever
 * another device pushed since. It replaces the folder auto-export, and keeps
 * that file's contract — `{tone, message}` or null — so every writer reports
 * the outcome in the same words.
 *
 * Layout, under the signed-in account's uid:
 *
 *   users/{uid}                       everything in storage except the queue,
 *                                     plus `updatedAt`, which is what another
 *                                     device compares against to know it is behind
 *   users/{uid}/contests/{platform:id} one document per tracked contest
 *
 * One document per contest rather than one for everything, for two reasons:
 * Firestore caps a document at 1 MiB, which a whole queue would eventually
 * reach; and the free tier allows 20,000 writes a day, so a refresh writes
 * only the contests whose fingerprint changed — a handful, not the queue.
 *
 * **Conflicts are last-write-wins, by design.** Every change is pushed the
 * moment it is made, so a device is only ever behind another, never diverged
 * from it — unless a push failed offline, in which case the newer remote copy
 * wins on the next open. Solved status is re-derived by every refresh, so what
 * that can lose is an add or a removal made offline, not progress.
 *
 * Device-local bookkeeping lives under `upsolve_tracker.cloud.*` and is never
 * pushed, pulled or imported: it describes this install's relationship to the
 * cloud copy, not the queue.
 */
import { contestKey } from "../platforms/registry.js";
import { describeBackupProblem } from "../backup-validation.js";
import { firebaseFrom, isAccountConfigured, whoAmI } from "./account.js";
import { publishCatalog } from "./catalog.js";
import { CLOUD_KEY_PREFIX, decodeDoc, encodeDoc, fingerprint } from "./firebase.js";

/** The remote `updatedAt` this device last matched. */
const SYNCED_AT_KEY = `${CLOUD_KEY_PREFIX}synced_at`;
/** Fingerprints of what was last pushed, by contest key, plus SETTINGS for the rest. */
const PUSHED_KEY = `${CLOUD_KEY_PREFIX}pushed`;
/** Whose cloud copy the two above describe. A different account starts over. */
const UID_KEY = `${CLOUD_KEY_PREFIX}uid`;
const SETTINGS = "__settings";

const userPath = (uid) => `users/${uid}`;
const contestsPath = (uid) => `users/${uid}/contests`;
const contestPath = (uid, key) => `${contestsPath(uid)}/${key}`;

const CLOUD_OFF = {
  tone: "warning",
  message: "Cloud backup is off. Sign in from Settings to turn it on.",
};

const CLOUD_FAILED = {
  tone: "error",
  message: "Couldn't save to the cloud. Your queue is still saved on this device.",
};

const CATALOG_FAILED = {
  tone: "error",
  message: "Couldn't update the shared catalog.",
};

/** Whether a storage key is this device's bookkeeping rather than part of the queue. */
export const isDeviceLocal = (key) => key.startsWith(CLOUD_KEY_PREFIX);

function storageFrom(options) {
  return options.storage ?? globalThis.chrome.storage.local;
}

/** Everything in storage that travels: the queue, and the rest. */
function splitStore(all) {
  const { trackedContests = [], ...rest } = all;
  const settings = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !isDeviceLocal(key)),
  );
  return { trackedContests, settings };
}

/**
 * Forgets this device's relationship to the cloud copy — on sign-out, and
 * whenever a different account signs in, whose cloud copy the stored
 * fingerprints say nothing about. The next sign-in reconciles from scratch.
 */
export async function resetCloudState(options = {}) {
  const storage = storageFrom(options);
  const all = await storage.get(null);
  const keys = Object.keys(all).filter(isDeviceLocal);
  if (keys.length > 0) await storage.remove(keys);
}

async function claimFor(uid, storage) {
  const { [UID_KEY]: stored } = await storage.get(UID_KEY);
  if (stored === uid) return;
  await resetCloudState({ storage });
  await storage.set({ [UID_KEY]: uid });
}

/**
 * Pushes whatever changed since the last push. Silent when the build has no
 * Firebase — there is nothing to turn on, so nothing worth nagging about.
 *
 * @returns {Promise<{tone: string, message: string}|null>} null when saved,
 *   or when nothing needed saving.
 */
async function pushStore(options = {}) {
  if (!isAccountConfigured(options)) return null;
  const storage = storageFrom(options);

  try {
    const firebase = await firebaseFrom(options);
    const user = await firebase.currentUser();
    if (!user) return CLOUD_OFF;
    await claimFor(user.uid, storage);

    const all = await storage.get(null);
    const { trackedContests, settings } = splitStore(all);
    const pushed = all[PUSHED_KEY] ?? {};

    const ops = [];
    const next = {};
    for (const contest of trackedContests) {
      const key = contestKey(contest);
      next[key] = fingerprint(contest);
      if (pushed[key] !== next[key]) {
        ops.push({ set: contestPath(user.uid, key), data: encodeDoc(contest) });
      }
    }
    for (const key of Object.keys(pushed)) {
      if (key !== SETTINGS && !(key in next)) ops.push({ remove: contestPath(user.uid, key) });
    }
    next[SETTINGS] = fingerprint(settings);

    if (ops.length === 0 && pushed[SETTINGS] === next[SETTINGS]) return null;

    // Written whenever anything changed, contests included, because its
    // `updatedAt` is how another device learns it is behind. Last in the
    // batch, so a device that sees it new also sees the contests it covers.
    const now = Date.now();
    ops.push({ set: userPath(user.uid), data: encodeDoc(settings, now) });
    await firebase.commit(ops);

    await storage.set({ [PUSHED_KEY]: next, [SYNCED_AT_KEY]: now });
    return null;
  } catch (error) {
    console.warn("[cloud] push failed:", error.message);
    return CLOUD_FAILED;
  }
}

/**
 * Replaces local storage with the cloud copy, if the cloud copy is newer than
 * what this device last matched.
 *
 * @returns {Promise<boolean>} whether anything was pulled
 */
export async function pullStore(options = {}) {
  if (!isAccountConfigured(options)) return false;
  const storage = storageFrom(options);
  const firebase = await firebaseFrom(options);
  const user = await firebase.currentUser();
  if (!user) return false;
  await claimFor(user.uid, storage);

  const remote = await firebase.get(userPath(user.uid));
  if (!remote) return false;

  const { [SYNCED_AT_KEY]: syncedAt = 0 } = await storage.get(SYNCED_AT_KEY);
  if (remote.updatedAt <= syncedAt) return false;

  await replaceLocal(firebase, user.uid, remote, storage);
  return true;
}

/**
 * Overwrites local storage with the cloud copy. Held to the same check Import
 * is: this writes straight into storage with no undo, and a malformed copy —
 * from a newer build with a platform this one lacks, say — would otherwise
 * throw later while rendering the list.
 */
async function replaceLocal(firebase, uid, remote, storage) {
  const settings = decodeDoc(remote);
  const docs = await firebase.list(contestsPath(uid));
  const trackedContests = docs.map(({ data }) => decodeDoc(data));

  const problem = describeBackupProblem({ trackedContests });
  if (problem) throw new Error(`The cloud copy couldn't be loaded: ${problem}`);

  const current = await storage.get(null);
  const stale = Object.keys(current).filter(
    (key) => !isDeviceLocal(key) && key !== "trackedContests" && !(key in settings),
  );
  if (stale.length > 0) await storage.remove(stale);

  const pushed = { [SETTINGS]: fingerprint(settings) };
  for (const contest of trackedContests) pushed[contestKey(contest)] = fingerprint(contest);

  await storage.set({
    ...settings,
    trackedContests,
    [PUSHED_KEY]: pushed,
    [SYNCED_AT_KEY]: remote.updatedAt,
  });
}

/**
 * The first sign-in on a device, when both sides may hold a queue.
 *
 * Nothing in the cloud: this device's queue is uploaded. Nothing here: the
 * cloud copy is downloaded. Both: `choose` decides, since either answer
 * discards the other side and there is no undo.
 *
 * @param {{choose: (counts: {device: number, cloud: number}) => Promise<"device"|"cloud">}} args
 * @returns {Promise<"uploaded"|"downloaded"|"kept-device"|"kept-cloud"|null>}
 */
export async function reconcileOnSignIn({ choose }, options = {}) {
  if (!isAccountConfigured(options)) return null;
  const storage = storageFrom(options);
  const firebase = await firebaseFrom(options);
  const user = await firebase.currentUser();
  if (!user) return null;
  await claimFor(user.uid, storage);

  const remote = await firebase.get(userPath(user.uid));
  const { trackedContests = [] } = await storage.get({ trackedContests: [] });

  if (!remote) {
    const outcome = await pushStore(options);
    if (outcome) throw new Error(outcome.message);
    return "uploaded";
  }

  const docs = await firebase.list(contestsPath(user.uid));
  if (trackedContests.length === 0) {
    await replaceLocal(firebase, user.uid, remote, storage);
    return "downloaded";
  }

  const kept = await choose({ device: trackedContests.length, cloud: docs.length });
  if (kept === "cloud") {
    await replaceLocal(firebase, user.uid, remote, storage);
    return "kept-cloud";
  }

  // Keep this device's: mark every remote contest as pushed-but-different, so
  // the push overwrites the ones still here and deletes the ones that are not.
  const pushed = Object.fromEntries(docs.map(({ id }) => [id, "replace"]));
  await storage.set({ [PUSHED_KEY]: pushed, [SYNCED_AT_KEY]: remote.updatedAt });
  const outcome = await pushStore(options);
  if (outcome) throw new Error(outcome.message);
  return "kept-device";
}

/**
 * What every writer calls after changing storage — the add, the refresh,
 * removal and import. Pushes the user's own copy and, for the owner,
 * publishes any contest whose shared part changed.
 *
 * @returns {Promise<{tone: string, message: string}|null>}
 */
export async function saveToCloud(options = {}) {
  const outcome = await pushStore(options);
  if (outcome) return outcome;
  if (!isAccountConfigured(options)) return null;

  try {
    const who = await whoAmI(options);
    if (who?.role !== "owner") return null;
    const { trackedContests = [] } = await storageFrom(options).get({ trackedContests: [] });
    await publishCatalog(trackedContests, options);
    return null;
  } catch (error) {
    console.warn("[cloud] publishing to the catalog failed:", error.message);
    return CATALOG_FAILED;
  }
}
