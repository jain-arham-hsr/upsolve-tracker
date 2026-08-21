/**
 * Renames the `cf_trainer.*` settings keys to `upsolve_tracker.*`.
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
