/**
 * The settings page.
 *
 * It knows about *fields*, not about platforms. Every platform section comes
 * from `listPlatforms()` and each descriptor's `settingsFields`, and every
 * check runs through `getAdapter()` — so adding a platform touches no file
 * here. It used to import all three adapters plus Codeforces' API client
 * directly, and hand-write three near-identical sections in the HTML.
 *
 * The verdicts are the adapters' own words. This page used to compose its own
 * for CodeChef — re-checking `session.signedIn` and writing a "signed out"
 * message that `verifyIdentity` already produces — so the same condition read
 * differently here and in the queue's status strip. One message, one author.
 */
import { listPlatforms } from "../../platforms/registry.js";
import { getAdapter } from "../../platforms/adapters.js";
import {
  saveDirHandle,
  loadDirHandle,
  clearDirHandle,
  readSettingsValues,
  writeSettingsValues,
} from "../../services/secure-store.js";
import { renderPlatformSettings, describeIdentity } from "./platform-settings.js";

const AUTO_EXPORT_KEY = "upsolve_tracker.auto_export";

document.addEventListener("DOMContentLoaded", async () => {
  const platforms = listPlatforms();
  const mount = document.getElementById("platform-settings");
  mount.innerHTML = renderPlatformSettings(platforms);

  const autoExportCheckbox = document.getElementById("auto-export-checkbox");
  const folderInfo = document.getElementById("folder-info");
  const folderStatus = document.getElementById("folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");
  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  const inputFor = (key) => mount.querySelector(`[data-field="${key}"]`);
  const statusFor = (id) => mount.querySelector(`[data-status="${id}"]`);

  /** What is currently *typed*, which is what a check must be run against. */
  const typedValues = (platform) =>
    Object.fromEntries(
      platform.settingsFields.map((field) => [field.key, inputFor(field.key).value.trim()]),
    );

  let pendingDirHandle = null;

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  const [saved, general, dirHandle] = await Promise.all([
    Promise.all(platforms.map((platform) => readSettingsValues(platform))),
    chrome.storage.local.get([AUTO_EXPORT_KEY]),
    loadDirHandle(),
  ]);

  saved.forEach((values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value) inputFor(key).value = value;
    }
  });

  if (general[AUTO_EXPORT_KEY]) {
    autoExportCheckbox.checked = true;
    folderInfo.classList.remove("hidden");
  }

  pendingDirHandle = dirHandle;
  if (pendingDirHandle) {
    folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
  }

  // ==========================================
  // JOB 2: AUTO-EXPORT & FOLDER PICKER
  // ==========================================
  autoExportCheckbox.addEventListener("change", async () => {
    if (autoExportCheckbox.checked) {
      try {
        pendingDirHandle = await window.showDirectoryPicker();
        await saveDirHandle(pendingDirHandle);
        folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
        folderInfo.classList.remove("hidden");
      } catch {
        autoExportCheckbox.checked = false;
        console.log("Folder selection cancelled.");
      }
    } else {
      folderInfo.classList.add("hidden");
      await clearDirHandle();
      pendingDirHandle = null;
    }
  });

  chooseFolderBtn.addEventListener("click", async () => {
    try {
      pendingDirHandle = await window.showDirectoryPicker();
      await saveDirHandle(pendingDirHandle);
      folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
    } catch {}
  });

  // ==========================================
  // JOB 3: WHOSE ACCOUNT IS THIS?
  // ==========================================
  //
  // One path for every platform, and deliberately **the same `verifyIdentity`
  // the sync calls** — a check that exercises a different call can pass while
  // the real path fails. It runs against the values typed here rather than the
  // saved ones, so a wrong key tells you before you come to rely on it.
  const setStatus = (element, message, ok) => {
    element.textContent = message;
    element.classList.toggle("hidden", message === "");
    element.classList.toggle("success", ok === true);
    element.classList.toggle("failure", ok === false);
  };

  async function verify(platform) {
    const status = statusFor(platform.id);
    const values = typedValues(platform);

    if (Object.values(values).some((value) => !value)) {
      // A section you have not filled in yet is not a failure, so it says
      // nothing — unless it asked you to press something, in which case it owes
      // you an explanation for doing nothing. `ok` stays undefined when there is
      // no message, or an empty line would still be marked red.
      const message = platform.verify.incomplete ?? "";
      setStatus(status, message, message ? false : undefined);
      return;
    }

    setStatus(status, "Checking…");
    const adapter = getAdapter(platform.id);

    try {
      const identity = await adapter.verifyIdentity(await adapter.createSessionFrom(values));
      setStatus(status, `✓ ${describeIdentity(adapter, identity)}`, true);
    } catch (error) {
      // The adapters explain their own failures well — an unknown handle, a
      // bad key, a signed-out session, the wrong account. Passing the message
      // through beats guessing which field was wrong.
      setStatus(status, `✕ ${error.message}`, false);
    }
  }

  for (const platform of platforms) {
    if (platform.verify.trigger === "button") {
      const button = mount.querySelector(`[data-verify="${platform.id}"]`);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await verify(platform);
        } finally {
          button.disabled = false;
        }
      });
      continue;
    }

    // Checked on load as well as on change: the dangerous state on a
    // session-based platform is being signed in as someone else, which
    // otherwise looks exactly like a normal sync.
    const last = platform.settingsFields.at(-1);
    inputFor(last.key).addEventListener("change", () => verify(platform));
    await verify(platform);
  }

  // ==========================================
  // JOB 4: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", async () => {
    await Promise.all([
      ...platforms.map((platform) => writeSettingsValues(platform, typedValues(platform))),
      chrome.storage.local.set({ [AUTO_EXPORT_KEY]: autoExportCheckbox.checked }),
    ]);

    saveMsg.classList.remove("hidden");
    setTimeout(() => saveMsg.classList.add("hidden"), 2500);
  });
});
