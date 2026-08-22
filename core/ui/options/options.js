import {
  saveDirHandle,
  loadDirHandle,
  clearDirHandle,
  saveCredentials,
  loadCredentials,
} from "../../services/secure-store.js";
import { CodeforcesService } from "../../services/codeforces-service.js";
import * as codechefAdapter from "../../platforms/codechef/adapter.js";
import * as codeforcesAdapter from "../../platforms/codeforces/adapter.js";
import * as atcoderAdapter from "../../platforms/atcoder/adapter.js";

document.addEventListener("DOMContentLoaded", async () => {
  const handleInput = document.getElementById("cf-handle");
  const atcoderHandleInput = document.getElementById("atcoder-handle");
  const codechefHandleInput = document.getElementById("codechef-handle");
  const apiKeyInput = document.getElementById("api-key");
  const apiSecretInput = document.getElementById("api-secret");

  const autoExportCheckbox = document.getElementById("auto-export-checkbox");
  const folderInfo = document.getElementById("folder-info");
  const folderStatus = document.getElementById("folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");

  const atcoderStatus = document.getElementById("atcoder-status");
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
  /**
   * All three answer the same question — which account this queue syncs
   * against — so all three say it the same way. "Connected as" where the
   * handle is looked up, "Signed in as" on CodeChef where the browser session
   * really is the identity. Nothing else: the rating and the submission count
   * were incidental to what the check establishes.
   */
  const setStatus = (element, message, ok) => {
    element.textContent = message;
    element.classList.remove("hidden");
    element.classList.toggle("success", ok === true);
    element.classList.toggle("failure", ok === false);
  };

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
      // Deliberately the same call the sync makes, on the values typed here
      // rather than the saved ones: a check that exercises a different path
      // can pass while the real one fails. It is signed, so a bad key, a bad
      // secret and an unknown handle all surface here.
      const identity = await codeforcesAdapter.verifyIdentity({
        handle,
        service: new CodeforcesService(apiKey, apiSecret),
      });
      showTestResult(`✓ Connected as ${identity.username}.`, true);
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
    const handle = codechefHandleInput.value.trim();
    if (!handle) {
      setStatus(codechefStatus, "");
      return;
    }

    let session;
    try {
      session = await codechefAdapter.createSession();
    } catch {
      setStatus(codechefStatus, "Couldn't reach codechef.com to check.", false);
      return;
    }

    if (!session.signedIn) {
      setStatus(
        codechefStatus,
        `Signed out — sign in as ${handle} at codechef.com to sync.`,
        false,
      );
      return;
    }

    // The state this check exists for. CodeChef answers for whoever holds the
    // session cookie, so a mismatch means the next sync would read somebody
    // else's solved problems.
    if (session.signedInAs !== handle) {
      setStatus(
        codechefStatus,
        `✕ Signed in as ${session.signedInAs}, not ${handle}. Syncing is paused until they match.`,
        false,
      );
      return;
    }

    setStatus(codechefStatus, `✓ Signed in as ${handle}.`, true);
  }

  // ==========================================
  // JOB 6: WHICH ATCODER ACCOUNT IS THIS?
  // ==========================================
  //
  // AtCoder had no confirmation at all: you typed a handle, saved, and were
  // told nothing. Its history is read *about* a handle rather than from a
  // session, so the extension cannot tell whose handle it is — which makes
  // showing the account it resolved to the only thing standing between a typo
  // and a queue quietly synced against a stranger.
  await renderAtCoderStatus();
  atcoderHandleInput.addEventListener("change", () => renderAtCoderStatus());

  async function renderAtCoderStatus() {
    const handle = atcoderHandleInput.value.trim();
    if (!handle) {
      setStatus(atcoderStatus, "");
      return;
    }

    setStatus(atcoderStatus, "Checking…");
    try {
      // No new request: verifyIdentity is what the sync already calls, and it
      // returns the rating along with the account.
      const identity = await atcoderAdapter.verifyIdentity({ handle });
      setStatus(atcoderStatus, `✓ Connected as ${identity.username}.`, true);
    } catch (error) {
      setStatus(atcoderStatus, `✕ ${error.message}`, false);
    }
  }
});
