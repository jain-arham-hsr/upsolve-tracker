import {
  saveDirHandle,
  loadDirHandle,
  clearDirHandle,
  saveCredentials,
  loadCredentials,
} from "../../services/secure-store.js";
import { CodeforcesService } from "../../services/codeforces-service.js";
import * as codechefAdapter from "../../platforms/codechef/adapter.js";
import { platformGlyph } from "../platform-icons.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Section marks come from platform-icons.js rather than being pasted in as
  // markup, so there is one place a mark is defined. They are monochrome and
  // inherit the heading's colour, which is what makes them read as muted here
  // without a second set of hexes to keep in sync.
  for (const slot of document.querySelectorAll("[data-glyph]")) {
    slot.innerHTML = platformGlyph(slot.dataset.glyph);
  }

  const handleInput = document.getElementById("cf-handle");
  const atcoderHandleInput = document.getElementById("atcoder-handle");
  const codechefHandleInput = document.getElementById("codechef-handle");
  const apiKeyInput = document.getElementById("api-key");
  const apiSecretInput = document.getElementById("api-secret");

  const autoExportCheckbox = document.getElementById("auto-export-checkbox");
  const folderInfo = document.getElementById("folder-info");
  const folderStatus = document.getElementById("folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");

  const codechefStatus = document.getElementById("codechef-status");

  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  const testBtn = document.getElementById("test-btn");
  const testMsg = document.getElementById("test-msg");

  let pendingDirHandle = null;

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  const [storageResult, credentials, dirHandle] = await Promise.all([
    chrome.storage.local.get([
      "upsolve_tracker.handle",
      "upsolve_tracker.atcoder_handle",
      "upsolve_tracker.codechef_handle",
      "upsolve_tracker.auto_export",
    ]),
    loadCredentials(),
    loadDirHandle(),
  ]);

  if (storageResult["upsolve_tracker.handle"])
    handleInput.value = storageResult["upsolve_tracker.handle"];
  if (storageResult["upsolve_tracker.atcoder_handle"])
    atcoderHandleInput.value = storageResult["upsolve_tracker.atcoder_handle"];
  if (storageResult["upsolve_tracker.codechef_handle"])
    codechefHandleInput.value = storageResult["upsolve_tracker.codechef_handle"];
  if (credentials.apiKey) apiKeyInput.value = credentials.apiKey;
  if (credentials.apiSecret) apiSecretInput.value = credentials.apiSecret;

  if (storageResult["upsolve_tracker.auto_export"]) {
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
  // JOB 3: VERIFY CREDENTIALS
  // ==========================================
  const showTestResult = (message, ok) => {
    testMsg.textContent = message;
    testMsg.classList.remove("hidden");
    testMsg.classList.toggle("success", ok);
    testMsg.classList.toggle("failure", !ok);
  };

  testBtn.addEventListener("click", async () => {
    const handle = handleInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const apiSecret = apiSecretInput.value.trim();

    if (!handle || !apiKey || !apiSecret) {
      showTestResult("Fill in all three fields first.", false);
      return;
    }

    testBtn.disabled = true;
    showTestResult("Checking…", true);

    try {
      // user.status needs a valid signature AND a real handle, so one call
      // covers every way these three fields can be wrong.
      const service = new CodeforcesService(apiKey, apiSecret);
      const submissions = await service.getUserStatus(handle);
      showTestResult(
        `✓ Connected as ${handle} — ${submissions.length} recent submissions.`,
        true,
      );
    } catch (error) {
      // Codeforces explains the failure well; pass it through rather than
      // guessing which field was wrong.
      showTestResult(`✕ ${error.message}`, false);
    } finally {
      testBtn.disabled = false;
    }
  });

  // ==========================================
  // JOB 4: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", async () => {
    await Promise.all([
      chrome.storage.local.set({
        "upsolve_tracker.handle": handleInput.value.trim(),
        "upsolve_tracker.atcoder_handle": atcoderHandleInput.value.trim(),
        "upsolve_tracker.codechef_handle": codechefHandleInput.value.trim(),
        "upsolve_tracker.auto_export": autoExportCheckbox.checked,
      }),
      saveCredentials(apiKeyInput.value.trim(), apiSecretInput.value.trim()),
    ]);

    saveMsg.classList.remove("hidden");
    setTimeout(() => saveMsg.classList.add("hidden"), 2500);
  });

  // ==========================================
  // JOB 5: WHOSE CODECHEF ACCOUNT IS THIS?
  // ==========================================
  //
  // CodeChef is the one platform whose identity is ambient — it comes from the
  // browser session rather than anything typed here. That makes it the one
  // worth showing plainly: the dangerous state is being signed in as someone
  // else, which otherwise looks exactly like a normal sync.
  await renderCodeChefStatus();
  codechefHandleInput.addEventListener("change", () => renderCodeChefStatus());

  async function renderCodeChefStatus() {
    const setStatus = (text, ok) => {
      codechefStatus.textContent = text;
      codechefStatus.classList.toggle("failure", ok === false);
    };

    const handle = codechefHandleInput.value.trim();
    if (!handle) {
      setStatus("");
      return;
    }

    let session;
    try {
      session = await codechefAdapter.createSession();
    } catch {
      setStatus("Couldn't reach codechef.com to check.", false);
      return;
    }

    if (!session.signedIn) {
      setStatus(`Signed out — sign in as ${handle} at codechef.com to sync.`, false);
      return;
    }

    // The state this check exists for. CodeChef answers for whoever holds the
    // session cookie, so a mismatch means the next sync would read somebody
    // else's solved problems.
    if (session.signedInAs !== handle) {
      setStatus(
        `✕ Signed in as ${session.signedInAs}, not ${handle}. Syncing is paused until they match.`,
        false,
      );
      return;
    }

    const rating = session.rating == null ? "unrated" : `rating ${session.rating}`;
    setStatus(`✓ Signed in as ${handle} — ${rating}.`, true);
  }
});
