/**
 * Mirrors chrome.storage.local into a JSON file in a user-chosen directory.
 *
 * Anything that mutates stored data should write the backup afterwards,
 * otherwise the file silently drifts from what the extension is showing.
 */
import { loadDirHandle } from "./secure-store.js";

export const BACKUP_FILENAME = "upsolve_tracker_backup.json";

// The name this wrote to before the rebrand. Renaming alone would leave that
// file sitting in the export directory, frozen at the moment of the rename and
// looking like a perfectly good backup — restoring from it later would silently
// lose everything added since. So the first successful write under the new name
// deletes it. That ordering matters: the old file is only given up once its
// replacement is on disk.
const LEGACY_BACKUP_FILENAME = "cf_trainer_backup.json";

/**
 * Tests the directory handle immediately. If Chrome locked it after a restart,
 * it catches the error and forces a prompt while the user click is still fresh.
 *
 * Call this BEFORE the slow work in a click handler — re-requesting permission
 * needs user activation, which does not survive a long network round trip.
 *
 * @returns {Promise<FileSystemDirectoryHandle|null>} The unlocked handle, or null.
 */
export async function verifyExportPermission() {
  const settings = await chrome.storage.local.get("upsolve_tracker.auto_export");
  if (!settings["upsolve_tracker.auto_export"]) return null;

  const dirHandle = await loadDirHandle();
  if (!dirHandle) return null;

  try {
    // 1. TEST THE HANDLE: Try to access the file instantly.
    // If Chrome is secretly blocking it, this throws a NotAllowedError.
    await dirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    return dirHandle;
  } catch (error) {
    // 2. CATCH & PROMPT: If blocked, force the prompt while the click is fresh!
    if (error.name === "NotAllowedError") {
      try {
        const permission = await dirHandle.requestPermission({
          mode: "readwrite",
        });
        if (permission === "granted") {
          return dirHandle;
        }
      } catch (reqError) {
        console.warn("[Auto-Export] Prompt rejected:", reqError.message);
      }
    }
    return null;
  }
}

/**
 * Writes the current storage snapshot using a pre-authorized handle.
 * @returns {Promise<boolean>} Whether the file was written.
 */
export async function writeBackup(dirHandle) {
  try {
    const allData = await chrome.storage.local.get(null);
    const json = JSON.stringify(allData, null, 2);

    const fileHandle = await dirHandle.getFileHandle(BACKUP_FILENAME, {
      create: true,
    });

    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();

    await retireLegacyBackup(dirHandle);

    console.log("[Auto-Export] Backup written to", dirHandle.name);
    return true;
  } catch (error) {
    console.warn("[Auto-Export] Failed to write backup:", error.message);
    return false;
  }
}

/**
 * Removes the pre-rebrand backup, once a current one exists beside it.
 *
 * Absence is the normal case — anyone who set up auto-export after the rename
 * never had one — so NotFoundError is not worth reporting. Any other failure is
 * logged and swallowed: a leftover file is untidy, but the backup itself
 * succeeded and that is what the caller is waiting on.
 */
async function retireLegacyBackup(dirHandle) {
  try {
    await dirHandle.removeEntry(LEGACY_BACKUP_FILENAME);
    console.log("[Auto-Export] Removed the pre-rebrand backup");
  } catch (error) {
    if (error.name !== "NotFoundError") {
      console.warn("[Auto-Export] Could not remove the old backup:", error.message);
    }
  }
}
