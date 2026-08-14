import {
  saveDirHandle,
  loadDirHandle,
  clearDirHandle,
  saveCredentials,
  loadCredentials,
} from "../../services/secure-store";
import { CodeforcesService } from "../../services/codeforces-service.js";

document.addEventListener("DOMContentLoaded", async () => {
  const handleInput = document.getElementById("cf-handle");
  const apiKeyInput = document.getElementById("api-key");
  const apiSecretInput = document.getElementById("api-secret");

  const autoExportCheckbox = document.getElementById("auto-export-checkbox");
  const folderInfo = document.getElementById("folder-info");
  const folderStatus = document.getElementById("folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");

  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  const testBtn = document.getElementById("test-btn");
  const testMsg = document.getElementById("test-msg");

  let pendingDirHandle = null;

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  const [storageResult, credentials, dirHandle] = await Promise.all([
    chrome.storage.local.get(["cf_trainer.handle", "cf_trainer.auto_export"]),
    loadCredentials(),
    loadDirHandle(),
  ]);

  if (storageResult["cf_trainer.handle"])
    handleInput.value = storageResult["cf_trainer.handle"];
  if (credentials.apiKey) apiKeyInput.value = credentials.apiKey;
  if (credentials.apiSecret) apiSecretInput.value = credentials.apiSecret;

  if (storageResult["cf_trainer.auto_export"]) {
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
        "cf_trainer.handle": handleInput.value.trim(),
        "cf_trainer.auto_export": autoExportCheckbox.checked,
      }),
      saveCredentials(apiKeyInput.value.trim(), apiSecretInput.value.trim()),
    ]);

    saveMsg.classList.remove("hidden");
    setTimeout(() => saveMsg.classList.add("hidden"), 2500);
  });
});
