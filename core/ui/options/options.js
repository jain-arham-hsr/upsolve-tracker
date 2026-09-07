/**
 * The settings page.
 *
 * It knows about *sections and fields*, never about platforms. Sections come
 * from `core/settings/schema.js`, and the only platform id involved is
 * `section.verify.adapter` — a string handed straight to `getPlatform()` and
 * never read here. So this file stays agnostic even though the schema it
 * renders is hand-written.
 *
 * A section is a **credential set** rather than a platform, which is what lets
 * two Codeforces platforms share one key pair and one "Test connection" button
 * instead of rendering the same three fields twice.
 *
 * The verdicts are the adapters' own words. This page used to compose its own
 * for CodeChef — re-checking `session.signedIn` and writing a "signed out"
 * message that `verifyIdentity` already produces — so the same condition read
 * differently here and in the queue's status strip. One message, one author.
 */
import { getPlatform } from "../../platforms/registry.js";
import { saveDirHandle, loadDirHandle, clearDirHandle } from "../../services/secure-store.js";
import { SECTIONS } from "../../settings/schema.js";
import { readSection, writeSettings } from "../../settings/store.js";
import { renderSettingsSections, describeIdentity } from "./sections.js";

const AUTO_EXPORT_KEY = "upsolve_tracker.auto_export";

document.addEventListener("DOMContentLoaded", async () => {
  const mount = document.getElementById("settings-sections");
  mount.innerHTML = renderSettingsSections(SECTIONS);

  const autoExportCheckbox = document.getElementById("auto-export-checkbox");
  const folderInfo = document.getElementById("folder-info");
  const folderStatus = document.getElementById("folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");
  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  const inputFor = (slug) => mount.querySelector(`[data-field="${slug}"]`);
  const statusFor = (slug) => mount.querySelector(`[data-status="${slug}"]`);

  /** What is currently *typed*, which is what a check must be run against. */
  const typedValues = (section) =>
    Object.fromEntries(
      section.fields.map((field) => [field.slug, inputFor(field.slug).value.trim()]),
    );

  let pendingDirHandle = null;

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  const [saved, general, dirHandle] = await Promise.all([
    Promise.all(SECTIONS.map((section) => readSection(section))),
    chrome.storage.local.get([AUTO_EXPORT_KEY]),
    loadDirHandle(),
  ]);

  saved.forEach((values) => {
    for (const [slug, value] of Object.entries(values)) {
      if (value) inputFor(slug).value = value;
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

  async function verify(section) {
    const status = statusFor(section.slug);
    const values = typedValues(section);

    if (Object.values(values).some((value) => !value)) {
      // A section you have not filled in yet is not a failure, so it says
      // nothing — unless it asked you to press something, in which case it owes
      // you an explanation for doing nothing. `ok` stays undefined when there is
      // no message, or an empty line would still be marked red.
      const message = section.verify.incomplete ?? "";
      setStatus(status, message, message ? false : undefined);
      return;
    }

    setStatus(status, "Checking…");
    const adapter = getPlatform(section.verify.adapter);

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

  for (const section of SECTIONS) {
    if (section.verify.trigger === "button") {
      const button = mount.querySelector(`[data-verify="${section.slug}"]`);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await verify(section);
        } finally {
          button.disabled = false;
        }
      });
      continue;
    }

    // Checked on load as well as on change: the dangerous state on a
    // session-based platform is being signed in as someone else, which
    // otherwise looks exactly like a normal sync.
    const last = section.fields.at(-1);
    inputFor(last.slug).addEventListener("change", () => verify(section));
    await verify(section);
  }

  // ==========================================
  // JOB 4: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", async () => {
    await Promise.all([
      ...SECTIONS.map((section) => writeSettings(typedValues(section))),
      chrome.storage.local.set({ [AUTO_EXPORT_KEY]: autoExportCheckbox.checked }),
    ]);

    saveMsg.classList.remove("hidden");
    setTimeout(() => saveMsg.classList.add("hidden"), 2500);
  });
});
