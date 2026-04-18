document.addEventListener("DOMContentLoaded", () => {
  // Grab all our UI elements from the HTML
  const handleInput = document.getElementById("cf-handle");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");
  const folderStatus = document.getElementById("folder-status");
  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  // We temporarily hold the selected folder handle here before saving
  let pendingDirHandle = null;

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  chrome.storage.local.get(
    ["cf_trainer.handle", "cf_trainer.data_dir_handle"],
    (result) => {
      // Populate the handle input if it exists
      if (result["cf_trainer.handle"]) {
        handleInput.value = result["cf_trainer.handle"];
      }

      // Update the folder text if a handle is already saved
      if (result["cf_trainer.data_dir_handle"]) {
        pendingDirHandle = result["cf_trainer.data_dir_handle"];
        folderStatus.textContent = `✓ Selected: ${pendingDirHandle.name}`;
        folderStatus.className = "status-text success";
      }
    },
  );

  // ==========================================
  // JOB 2: HANDLE FOLDER PICKING
  // ==========================================
  chooseFolderBtn.addEventListener("click", async () => {
    try {
      // This single line triggers the secure, native OS file picker popup
      pendingDirHandle = await window.showDirectoryPicker();

      // Update the UI to show the name of the folder they picked
      folderStatus.textContent = `✓ Selected: ${pendingDirHandle.name}`;
      folderStatus.className = "status-text success";
    } catch (error) {
      // This catches if the user hits "Cancel" on the native picker
      console.log("Folder selection was aborted or failed.");
    }
  });

  // ==========================================
  // JOB 3: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", () => {
    const handleValue = handleInput.value.trim();

    // Prepare the dictionary of data we want to lock away
    const dataToSave = {
      "cf_trainer.handle": handleValue,
    };

    // The extension saves only the directory handle in chrome.storage.local[cite: 127].
    if (pendingDirHandle) {
      dataToSave["cf_trainer.data_dir_handle"] = pendingDirHandle;
    }

    // Write it to the Chrome storage database
    chrome.storage.local.set(dataToSave, () => {
      // Temporarily reveal the "Saved successfully!" message
      saveMsg.classList.remove("hidden");
      setTimeout(() => {
        saveMsg.classList.add("hidden");
      }, 2500); // Hide it again after 2.5 seconds
    });
  });
});
