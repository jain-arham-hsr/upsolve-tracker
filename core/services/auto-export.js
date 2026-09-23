/**
 * Mirrors chrome.storage.local into a JSON file in a user-chosen directory.
 *
 * Anything that mutates stored data should write the backup afterwards,
 * otherwise the file silently drifts from what the extension is showing.
 */
import { loadDirHandle } from "./secure-store.js";

export const BACKUP_FILENAME = "upsolve_tracker_backup.json";

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
  if (!(await isAutoExportOn())) return null;

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

export const AUTO_EXPORT_KEY = "upsolve_tracker.auto_export";

/**
 * Whether auto-export is switched on. Settings writes this flag in the same
 * moment as the folder, so "on" always has a folder chosen; a null handle
 * with the flag on therefore means Chrome refused access, not that none was
 * ever picked.
 */
async function isAutoExportOn() {
  const settings = await chrome.storage.local.get(AUTO_EXPORT_KEY);
  return Boolean(settings[AUTO_EXPORT_KEY]);
}

/**
 * Writes the backup after a storage change and says how it went, so every
 * writer — refresh, add, remove, import — words the outcome identically.
 *
 * Takes the handle rather than resolving it, because `verifyExportPermission`
 * has to run while the click is still fresh, before the caller's slow work.
 *
 * @returns {Promise<{tone: "warning"|"error", message: string}|null>} null
 *   when the file was written.
 */
export async function backUp(dirHandle) {
  if (dirHandle) {
    return (await writeBackup(dirHandle)) ? null : BACKUP_FAILED;
  }
  // No handle: either auto-export is off, which is a choice worth a nudge, or
  // it is on and Chrome refused the folder, which is a failure.
  return (await isAutoExportOn()) ? BACKUP_FAILED : AUTO_EXPORT_OFF;
}

const AUTO_EXPORT_OFF = {
  tone: "warning",
  message: "Automatic backups are off. You can enable them in Settings.",
};

const BACKUP_FAILED = {
  tone: "error",
  message: "Backup couldn't be written to the export folder.",
};

/**
 * Writes the current storage snapshot using a pre-authorized handle.
 * @returns {Promise<boolean>} Whether the file was written.
 */
async function writeBackup(dirHandle) {
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

