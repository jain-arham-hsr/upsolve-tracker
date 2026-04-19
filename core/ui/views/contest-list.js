import templateHtml from "./contest-list.html?raw";
import { processNewContest } from "../../contest-manager.js";
import { LocalDB } from "../../services/storage.js";
import { loadDirHandle } from "../../services/secure-store.js";

export class ContestList extends HTMLElement {
  constructor() {
    super();
    this.boundCheckActiveTab = this.checkActiveTab.bind(this);
    this.boundTabUpdatedHandler = (tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === "complete") {
        this.checkActiveTab();
      }
    };
    this.currentValidUrl = null;
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;

    // UI References
    this.btnAddContest = this.querySelector("#btn-add-contest");
    this.container = this.querySelector("#contest-items");
    this.btnExport = this.querySelector("#btn-export");
    this.btnImport = this.querySelector("#btn-import");
    this.fileInput = this.querySelector("#import-file-input");
    this.alertDiv = this.querySelector("#contest-alert"); // New reference

    // Initial State - DO NOT TOUCH TOOLTIP LOGIC
    this.btnAddContest.disabled = true;
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    // 1. Initial Render
    await this.renderQueue();

    // 2. Add Contest Click - UPDATED WITH ALERT LOGIC
    this.btnAddContest.addEventListener("click", async () => {
      if (this.currentValidUrl) {
        this.btnAddContest.textContent = "Fetching...";
        this.btnAddContest.disabled = true;
        this.alertDiv.classList.add("hidden"); // Hide any old alerts

        try {
          await processNewContest(this.currentValidUrl);
          await this.renderQueue();
          await this.autoExportIfEnabled();

          this.btnAddContest.textContent = "✓ Added";
          this.btnAddContest.disabled = true;
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Contest added successfully!",
          );
        } catch (error) {
          // Requirement: Show inline alert instead of just console error
          this.showInlineAlert(error.message);

          this.btnAddContest.textContent = "+ Add Contest";
          this.btnAddContest.disabled = false;
        }
      }
    });

    // 3. Management Actions
    this.btnExport.addEventListener("click", async () => {
      const allData = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(allData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cf_trainer_backup.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    this.btnImport.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          await chrome.storage.local.set(data);
          await this.renderQueue();
        } catch (err) {
          console.error("Import failed:", err);
        }
      };
      reader.readAsText(file);
    });

    this.checkActiveTab();
    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdatedHandler);
  }

  /**
   * If auto-export is enabled and a folder handle is stored, writes the full
   * chrome.storage.local contents as JSON to the selected folder.
   */
  async autoExportIfEnabled() {
    const settings = await chrome.storage.local.get("cf_trainer.auto_export");
    if (!settings["cf_trainer.auto_export"]) return;

    const dirHandle = await loadDirHandle();
    if (!dirHandle) return;

    try {
      // Re-verify permission — browser may revoke it between sessions
      let permission = await dirHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        permission = await dirHandle.requestPermission({ mode: "readwrite" });
      }
      if (permission !== "granted") {
        console.warn(
          "[Auto-Export] Permission denied for directory. Skipping.",
        );
        return;
      }

      const allData = await chrome.storage.local.get(null);
      const json = JSON.stringify(allData, null, 2);

      const fileHandle = await dirHandle.getFileHandle(
        "cf_trainer_backup.json",
        { create: true },
      );
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();

      console.log("[Auto-Export] Backup written to", dirHandle.name);
    } catch (error) {
      console.warn("[Auto-Export] Failed to write backup:", error.message);
    }
  }

  /**
   * Helper to display the professional green alert box
   */
  showInlineAlert(message) {
    // Strip the "Error: " prefix if the browser prepends it
    const cleanMessage = message.replace(/^Error:\s*/i, "");

    this.alertDiv.textContent = cleanMessage;
    this.alertDiv.classList.remove("hidden");

    // Auto-hide after 6 seconds so it doesn't clutter the UI
    setTimeout(() => {
      this.alertDiv.classList.add("hidden");
    }, 6000);
  }

  // --- RENDERING ENGINE ---
  async renderQueue() {
    const contests = await LocalDB.getTrackedContests();

    if (contests.length === 0) {
      this.container.innerHTML = `<div class="muted">No contests in queue.</div>`;
      return;
    }

    this.container.innerHTML = contests
      .map((contest) => {
        const isOfficial = contest.type === "OFFICIAL";
        const path = isOfficial ? "contest" : "gym";
        const label = isOfficial ? "Official" : "Gym";
        const typeClass = isOfficial ? "type-official" : "type-gym";
        const url = `https://codeforces.com/${path}/${contest.id}`;

        return `
        <a href="${url}" target="_blank" class="contest-row">
          <span class="contest-id">Contest ${contest.id}</span>
          <span class="contest-type ${typeClass}">${label}</span>
        </a>
      `;
      })
      .join("");
  }

  disconnectedCallback() {
    chrome.tabs.onActivated.removeListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.removeListener(this.boundTabUpdatedHandler);
  }

  async checkActiveTab() {
    this.currentValidUrl = null;
    this.btnAddContest.disabled = true;
    this.btnAddContest.textContent = "+ Add Contest";
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      if (tab && tab.url) {
        const cfRegex =
          /^https?:\/\/(www\.)?codeforces\.com\/(contest|gym)\/(\d+)/i;
        const match = tab.url.match(cfRegex);

        if (match) {
          const contestId = match[3];
          this.currentValidUrl = tab.url;

          const contests = await LocalDB.getTrackedContests();
          const isAlreadyTracked = contests.some(
            (c) => c.id.toString() === contestId,
          );

          if (isAlreadyTracked) {
            this.btnAddContest.disabled = true;
            this.btnAddContest.textContent = "✓ Added";
            this.btnAddContest.setAttribute(
              "data-tooltip",
              "Contest is already in your queue.",
            );
          } else {
            this.btnAddContest.disabled = false;
            this.btnAddContest.setAttribute(
              "data-tooltip",
              "Add this contest to the queue",
            );
          }
        } else {
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Must be on a CF contest or gym page.",
          );
        }
      } else {
        this.btnAddContest.setAttribute(
          "data-tooltip",
          "Navigate to a CF page first.",
        );
      }
    } catch (error) {
      console.error("Tab check failed:", error);
      this.btnAddContest.setAttribute(
        "data-tooltip",
        "Error checking tab context.",
      );
    }
  }
}

customElements.define("cf-contest-list", ContestList);
