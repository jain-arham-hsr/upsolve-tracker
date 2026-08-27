/**
 * Persists sensitive/non-serializable data using IndexedDB.
 * - FileSystemDirectoryHandle (can't be stored in chrome.storage.local)
 * - API credentials (shouldn't appear in exported JSON backups)
 */

import { listPlatforms } from "../platforms/registry.js";

const DB_NAME = "upsolve_tracker_db";
const STORE_NAME = "secure";

const KEYS = {
  DIR_HANDLE: "data_dir_handle",
};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function put(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function get(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = (e) => resolve(e.target.result ?? null);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function remove(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// --- Directory Handle ---
export const saveDirHandle = (handle) => put(KEYS.DIR_HANDLE, handle);
export const loadDirHandle = () => get(KEYS.DIR_HANDLE);
export const clearDirHandle = () => remove(KEYS.DIR_HANDLE);

// --- Platform secrets ---
//
// Keyed by whatever a descriptor's `settingsFields` entry names, rather than
// by constants spelled out here. This file used to export saveCredentials and
// loadCredentials — Codeforces' key pair, under Codeforces' names, in the
// shared storage layer. Nothing about IndexedDB is platform-specific; only
// what happened to be stored in it was.
//
// A secret lives here rather than in chrome.storage.local specifically so it
// never lands in an exported backup.

export const putSecret = (key, value) => put(key, value);
export const getSecret = (key) => get(key);

/**
 * Every value a platform declared in `settingsFields`, keyed by field key.
 *
 * The two stores are an implementation detail of *where* a value is safe to
 * keep, not of what it means, so callers get one flat map and never have to
 * know that a Codeforces secret lives somewhere a handle does not.
 */
export async function readSettingsValues(platform) {
  const localKeys = platform.settingsFields
    .filter((field) => field.store === "local")
    .map((field) => field.key);
  const settings = localKeys.length ? await chrome.storage.local.get(localKeys) : {};

  const entries = await Promise.all(
    platform.settingsFields.map(async (field) => [
      field.key,
      field.store === "secret" ? await getSecret(field.key) : (settings[field.key] ?? null),
    ]),
  );

  return Object.fromEntries(entries);
}

/** The write half, routing each field to the store it declared. */
export async function writeSettingsValues(platform, values) {
  const local = {};
  const writes = [];

  for (const field of platform.settingsFields) {
    const value = values[field.key] ?? "";
    if (field.store === "secret") writes.push(putSecret(field.key, value));
    else local[field.key] = value;
  }

  if (Object.keys(local).length) writes.push(chrome.storage.local.set(local));
  await Promise.all(writes);
}

/**
 * Which platforms are configured well enough to read solved history.
 *
 * A platform is ready when every field it declared has a value. This used to
 * hardcode all three ids, their storage keys, and the fact that Codeforces
 * additionally wants a key pair — three things a descriptor is better placed
 * to state, and which silently omitted any platform added afterwards.
 */
async function getPlatformSetup() {
  const entries = await Promise.all(
    listPlatforms().map(async (platform) => [
      platform.id,
      Object.values(await readSettingsValues(platform)).every(Boolean),
    ]),
  );

  return Object.fromEntries(entries);
}

/**
 * True once *any* platform can sync. Previously this demanded Codeforces
 * credentials, so someone using only AtCoder — which needs none — was shown a
 * setup prompt and a refresh button that looked broken.
 */
export async function hasCompleteSetup() {
  const setup = await getPlatformSetup();
  return Object.values(setup).some(Boolean);
}
