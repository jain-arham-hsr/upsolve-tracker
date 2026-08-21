/**
 * The one file that still knows the project's former name.
 *
 * Everything else — keys, element names, the backup file, the IndexedDB store —
 * reads as though it was always Upsolve Tracker. That cannot be true here: a
 * migration has to name what it is migrating, and the alternative to naming it
 * is abandoning the data. So the old names are quarantined in this module,
 * which exists solely to carry an existing install forward and can be deleted
 * outright once no install predates the rename.
 *
 * What makes each migration safe is ordering and idempotence rather than care:
 * the new home is written *before* the old one is dropped, so an interruption
 * leaves both copies and never neither, and a second run is indistinguishable
 * from the first.
 *
 * CLAUDE.md pinned these for years because a botched migration silently loses
 * someone's queue. What makes it safe to do now is ordering and idempotence,
 * not care: every step writes the new key before dropping the old one, and
 * running twice is indistinguishable from running once. An interrupted
 * migration leaves both copies, which the next run resolves — it never leaves
 * neither.
 *
 * Note `trackedContests` is deliberately untouched. It carries no prefix, is
 * the one key that holds the actual queue, and renaming it would buy nothing
 * but risk.
 */

const LEGACY_PREFIX = "cf_trainer.";
export const PREFIX = "upsolve_tracker.";

/**
 * Maps a storage snapshot's legacy keys onto their new names.
 *
 * Pure, because it runs on two very different inputs: live storage, and the
 * contents of an imported backup. A backup exported before the rename carries
 * the old keys, so importing one would otherwise reintroduce exactly what the
 * migration just removed — and imports write straight to storage with no undo.
 *
 * **An existing new-prefixed value wins.** If both are present the migration
 * was interrupted midway, and the new key is the one already written from the
 * old; preferring the legacy value would undo whatever happened since.
 *
 * @param {Record<string, unknown>} data
 * @returns {{data: Record<string, unknown>, legacyKeys: string[]}}
 */
export function renameLegacyKeys(data) {
  const out = {};
  const legacyKeys = [];

  for (const [key, value] of Object.entries(data ?? {})) {
    if (!key.startsWith(LEGACY_PREFIX)) {
      out[key] = value;
      continue;
    }
    legacyKeys.push(key);
    const renamed = PREFIX + key.slice(LEGACY_PREFIX.length);
    if (!(renamed in out)) out[renamed] = value;
  }

  // A new-prefixed key seen after its legacy twin must still win.
  for (const [key, value] of Object.entries(data ?? {})) {
    if (key.startsWith(PREFIX)) out[key] = value;
  }

  return { data: out, legacyKeys };
}

/**
 * Migrates live storage in place. Cheap and safe to call on every boot.
 *
 * @returns {Promise<number>} how many legacy keys were retired.
 */
export async function migrateStoredKeys() {
  const all = await chrome.storage.local.get(null);
  const { data, legacyKeys } = renameLegacyKeys(all);
  if (legacyKeys.length === 0) return 0;

  // Write first. If this throws, the old keys are still the only copy and the
  // next boot tries again; removing first would risk holding neither.
  const toWrite = {};
  for (const key of Object.keys(data)) {
    if (key.startsWith(PREFIX)) toWrite[key] = data[key];
  }
  await chrome.storage.local.set(toWrite);
  await chrome.storage.local.remove(legacyKeys);

  console.log(`[Migration] Renamed ${legacyKeys.length} settings key(s)`);
  return legacyKeys.length;
}

// --- The backup file ---------------------------------------------------------

/** What the export file was called before the rename. */
export const LEGACY_BACKUP_FILENAME = "cf_trainer_backup.json";

// --- IndexedDB ---------------------------------------------------------------

const LEGACY_DB_NAME = "cf_trainer_db";
const STORE_NAME = "secure";

function openNamed(name, create) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (create && !db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function readAll(db) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) return resolve([]);
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const keys = store.getAllKeys();
    const values = store.getAll();
    tx.oncomplete = () => resolve(keys.result.map((key, i) => [key, values.result[i]]));
    tx.onerror = (event) => reject(event.target.error);
  });
}

function writeAll(db, entries) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const [key, value] of entries) store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Copies the former IndexedDB store into `dbName`, then deletes the old one.
 *
 * This one is the most dangerous of the migrations, because a
 * FileSystemDirectoryHandle **cannot be re-derived from anything** — lose it
 * and the export folder is gone with no way to reconstruct it, unlike an API
 * key which can be pasted again. Hence: copy, verify the copy landed, and only
 * then delete. A failure at any point leaves the original untouched, and the
 * next boot retries.
 *
 * Handles survive the copy because IndexedDB stores them by structured clone
 * rather than by serialising to text.
 *
 * @returns {Promise<number>} how many records were carried across.
 */
export async function migrateSecureStore(dbName) {
  let legacy;
  try {
    legacy = await openNamed(LEGACY_DB_NAME, false);
  } catch {
    return 0;
  }

  try {
    const entries = await readAll(legacy);
    if (entries.length === 0) {
      legacy.close();
      await deleteDatabase(LEGACY_DB_NAME);
      return 0;
    }

    const target = await openNamed(dbName, true);
    await writeAll(target, entries);

    // Read the copy back before giving up the original.
    const copied = await readAll(target);
    target.close();
    if (copied.length < entries.length) {
      legacy.close();
      console.warn("[Migration] Secure store copy incomplete — keeping the original");
      return 0;
    }

    legacy.close();
    await deleteDatabase(LEGACY_DB_NAME);
    console.log(`[Migration] Moved ${entries.length} secure record(s)`);
    return entries.length;
  } catch (error) {
    try {
      legacy.close();
    } catch {
      /* already closed */
    }
    console.warn("[Migration] Secure store migration failed:", error.message);
    return 0;
  }
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
