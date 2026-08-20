import "./views/queue-view.js";
import "./views/contest-list.js";
import "./views/stats-view.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic
import {
  verifyExportPermission,
  writeBackup,
} from "../services/auto-export.js";
import { hasCompleteSetup } from "../services/secure-store.js";

// Inline so it inherits the header's colour and hover transition, which a
// colour emoji would ignore. Knobs are filled with the header background so
// they read as sitting on the sliders rather than behind them.
const SETTINGS_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
  <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"></path>
  <circle cx="6" cy="4.5" r="1.9" fill="var(--panel-bg)"></circle>
  <circle cx="10.5" cy="8" r="1.9" fill="var(--panel-bg)"></circle>
  <circle cx="5" cy="11.5" r="1.9" fill="var(--panel-bg)"></circle>
</svg>`;

export class CFApp extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    const template = document.getElementById("tpl-app");
    const content = template.content.cloneNode(true);
    this.appendChild(content);

    this.routerOutlet = this.querySelector("#router-outlet");
    this.btnSettings = this.querySelector("#btn-settings");
    this.btnRefresh = this.querySelector("#btn-refresh");
    this.syncStatus = this.querySelector("#sync-status");
    this.tabBar = this.querySelector("#tab-bar");

    this.btnSettings.innerHTML = SETTINGS_ICON;

    this.setupListeners();
    this.navigate("cf-queue-view");
  }

  setupListeners() {
    this.btnSettings.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    this.tabBar.addEventListener("click", (event) => {
      const tab = event.target.closest(".tab");
      if (tab) this.navigate(tab.dataset.view);
    });

    // Views report long operations through the shell's status strip rather
    // than each growing their own progress UI. null clears it.
    this.routerOutlet.addEventListener("cf-status", (event) => {
      if (event.detail === null) {
        this.clearSyncStatus();
      } else {
        this.setSyncStatus(event.detail);
      }
    });

    // Handle Global Refresh Click
    this.btnRefresh.addEventListener("click", async () => {
      await this.handleGlobalRefresh();
    });
  }

  async handleGlobalRefresh() {
    // Without credentials the sync returns silently, which reads as a dead
    // button. Say so instead.
    if (!(await hasCompleteSetup())) {
      this.setSyncStatus(
        "Add a handle in Settings to sync.",
        { sticky: true },
      );
      this.clearSyncStatus();
      return;
    }

    // 1. UI Feedback: Start spinning
    this.btnRefresh.classList.add("spinning");
    this.btnRefresh.disabled = true;
    this.setSyncStatus("Starting sync…");

    // 2. Unlock the export handle while the click is still fresh. A lapsed
    // permission can only be re-prompted under user activation, which will
    // not survive the sync below.
    const dirHandle = await verifyExportPermission();

    try {
      // 3. Run the sync logic, reporting each stage as it starts
      const removedContests = await updateSolvedStatus((message) =>
        this.setSyncStatus(message),
      );

      // 4. The sync rewrites stored contests, so the backup has to follow it
      // or the file drifts from what the extension shows.
      if (dirHandle) {
        this.setSyncStatus("Writing backup…");
        await writeBackup(dirHandle);
      }

      // 5. If we are currently looking at the queue, tell it to update
      const currentView = this.routerOutlet.firstElementChild;
      if (currentView && typeof currentView.refreshData === "function") {
        await currentView.refreshData(removedContests);
      }
    } catch (error) {
      console.error("Refresh failed:", error);
      this.setSyncStatus(`Sync failed: ${error.message}`, { sticky: true });
    } finally {
      // 6. UI Feedback: Stop spinning
      this.btnRefresh.classList.remove("spinning");
      this.btnRefresh.disabled = false;
      this.clearSyncStatus();
    }
  }

  /**
   * The stages have no measurable total, so this reports what is happening
   * rather than how far along it is.
   */
  setSyncStatus(message, { sticky = false } = {}) {
    clearTimeout(this.syncStatusTimer);
    this.syncStatus.textContent = message;
    this.syncStatus.classList.remove("hidden");
    this.syncStatus.classList.toggle("is-error", sticky);
    this.stickyStatus = sticky;
  }

  clearSyncStatus() {
    // A failure message outlives the spinner; progress text does not.
    const delay = this.stickyStatus ? 6000 : 400;
    this.syncStatusTimer = setTimeout(() => {
      this.syncStatus.classList.add("hidden");
      this.syncStatus.classList.remove("is-error");
      this.stickyStatus = false;
    }, delay);
  }

  navigate(componentTagName) {
    this.routerOutlet.innerHTML = "";
    const newView = document.createElement(componentTagName);
    this.routerOutlet.appendChild(newView);

    this.tabBar.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === componentTagName);
    });
  }
}

customElements.define("cf-app", CFApp);
