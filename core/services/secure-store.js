/**
 * Persists sensitive/non-serializable data using IndexedDB.
 * - FileSystemDirectoryHandle (can't be stored in chrome.storage.local)
 * - API credentials (shouldn't appear in exported JSON backups)
 */

const DB_NAME = "cf_trainer_db";
const STORE_NAME = "secure";

const KEYS = {
  DIR_HANDLE: "data_dir_handle",
  API_KEY: "api_key",
  API_SECRET: "api_secret",
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

// --- API Credentials ---
export const saveCredentials = (apiKey, apiSecret) =>
  Promise.all([put(KEYS.API_KEY, apiKey), put(KEYS.API_SECRET, apiSecret)]);

export const loadCredentials = async () => ({
  apiKey: await get(KEYS.API_KEY),
  apiSecret: await get(KEYS.API_SECRET),
});

/**
 * Whether the extension has everything it needs to talk to Codeforces.
 * Credentials live in IndexedDB and the handle in chrome.storage, so this is
 * the one place that knows to check both.
 */
/**
 * Which platforms are configured well enough to read solved history.
 *
 * Every platform needs a handle, and that handle is what its contests are
 * added against. Codeforces additionally needs a signed key pair. CodeChef's
 * handle is also what the browser session gets checked against, since its API
 * answers for whoever is signed in rather than for a handle we ask about.
 */
export async function getPlatformSetup() {
  const [settings, { apiKey, apiSecret }] = await Promise.all([
    chrome.storage.local.get([
      "cf_trainer.handle",
      "cf_trainer.atcoder_handle",
      "cf_trainer.codechef_handle",
    ]),
    loadCredentials(),
  ]);

  return {
    codeforces: Boolean(settings["cf_trainer.handle"] && apiKey && apiSecret),
    atcoder: Boolean(settings["cf_trainer.atcoder_handle"]),
    codechef: Boolean(settings["cf_trainer.codechef_handle"]),
  };
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
