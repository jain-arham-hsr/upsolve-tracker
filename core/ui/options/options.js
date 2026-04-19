import {
  saveDirHandle,
  loadDirHandle,
  clearDirHandle,
  saveCredentials,
  loadCredentials,
} from "../../services/secure-store";

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
  // JOB 3: SAVE TO STORAGE
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
