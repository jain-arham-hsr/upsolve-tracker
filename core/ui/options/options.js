document.addEventListener("DOMContentLoaded", () => {
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
  chrome.storage.local.get(
    [
      "cf_trainer.handle",
      "cf_trainer.api_key",
      "cf_trainer.api_secret",
      "cf_trainer.auto_export",
      "cf_trainer.data_dir_handle",
    ],
    (result) => {
      if (result["cf_trainer.handle"])
        handleInput.value = result["cf_trainer.handle"];
      if (result["cf_trainer.api_key"])
        apiKeyInput.value = result["cf_trainer.api_key"];
      if (result["cf_trainer.api_secret"])
        apiSecretInput.value = result["cf_trainer.api_secret"];

      if (result["cf_trainer.auto_export"]) {
        autoExportCheckbox.checked = true;
        folderInfo.classList.remove("hidden");
      }

      if (result["cf_trainer.data_dir_handle"]) {
        pendingDirHandle = result["cf_trainer.data_dir_handle"];
        folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
      }
    },
  );

  // ==========================================
  // JOB 2: AUTO-EXPORT & FOLDER PICKER
  // ==========================================
  autoExportCheckbox.addEventListener("change", async () => {
    if (autoExportCheckbox.checked) {
      try {
        // Trigger picker immediately when checked
        pendingDirHandle = await window.showDirectoryPicker();
        folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
        folderInfo.classList.remove("hidden");
      } catch (error) {
        // Revert if user cancels
        autoExportCheckbox.checked = false;
        console.log("Folder selection cancelled.");
      }
    } else {
      folderInfo.classList.add("hidden");
    }
  });

  chooseFolderBtn.addEventListener("click", async () => {
    try {
      pendingDirHandle = await window.showDirectoryPicker();
      folderStatus.textContent = `✓ Folder: ${pendingDirHandle.name}`;
    } catch (error) {}
  });

  // ==========================================
  // JOB 3: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", () => {
    const dataToSave = {
      "cf_trainer.handle": handleInput.value.trim(),
      "cf_trainer.api_key": apiKeyInput.value.trim(),
      "cf_trainer.api_secret": apiSecretInput.value.trim(),
      "cf_trainer.auto_export": autoExportCheckbox.checked,
    };

    if (pendingDirHandle) {
      dataToSave["cf_trainer.data_dir_handle"] = pendingDirHandle;
    }

    chrome.storage.local.set(dataToSave, () => {
      saveMsg.classList.remove("hidden");
      setTimeout(() => saveMsg.classList.add("hidden"), 2500);
    });
  });
});
