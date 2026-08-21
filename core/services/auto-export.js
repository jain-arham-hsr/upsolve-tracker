/**
 * Mirrors chrome.storage.local into a JSON file in a user-chosen directory.
 *
 * Anything that mutates stored data should write the backup afterwards,
 * otherwise the file silently drifts from what the extension is showing.
 */
import { loadDirHandle } from "./secure-store.js";

// Deliberately unchanged by the rebrand. Writing to a new name would leave
// the existing backup behind as a stale file, and anyone restoring from that
// one later would silently lose everything added since.
export const BACKUP_FILENAME = "cf_trainer_backup.json";

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
  const settings = await chrome.storage.local.get("cf_trainer.auto_export");
  if (!settings["cf_trainer.auto_export"]) return null;

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

    console.log("[Auto-Export] Backup written to", dirHandle.name);
    return true;
  } catch (error) {
    console.warn("[Auto-Export] Failed to write backup:", error.message);
    return false;
  }
}
