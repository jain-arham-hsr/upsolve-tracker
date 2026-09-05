/**
 * Persists sensitive/non-serializable data using IndexedDB.
 * - FileSystemDirectoryHandle (can't be stored in chrome.storage.local)
 * - API credentials (shouldn't appear in exported JSON backups)
 */


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

// --- Secrets, by slug ---
//
// A secret lives here rather than in chrome.storage.local specifically so it
// never lands in an exported backup. What a secret *is* is declared in
// `core/settings/schema.js`; nothing about IndexedDB is platform-specific, and
// only what happened to be stored in it ever was. This file used to export
// saveCredentials/loadCredentials — Codeforces' key pair, under Codeforces'
// names, in the shared storage layer — and then briefly read a descriptor's
// `settingsFields` instead, which moved the coupling without removing it.
//
// Exported, unlike the previous private pair, because the guarantee has moved
// rather than weakened: `settings/store.js` is now the only caller, and it
// routes by the slug's declared `store` so a caller still cannot reach a secret
// without going through the schema that declared it.
export const readSecret = (slug) => get(slug);
export const writeSecret = (slug, value) => put(slug, value);
