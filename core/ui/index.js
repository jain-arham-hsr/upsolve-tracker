import "./views/queue-view.js";
import "./views/contest-list.js";
import "./views/stats-view.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic
import {
  verifyExportPermission,
  writeBackup,
} from "../services/auto-export.js";
import { hasCompleteSetup } from "../services/secure-store.js";
import { processNewContest } from "../contest-manager.js";
import { LocalDB } from "../services/storage.js";
import {
  matchContestUrl,
  contestKey,
  makeContestKey,
} from "../platforms/registry.js";
import { escapeHtml } from "./escape-html.js";

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
    this.addBanner = this.querySelector("#add-banner");

    this.btnSettings.innerHTML = SETTINGS_ICON;

    this.setupListeners();
    this.watchActiveTab();
    this.navigate("cf-queue-view");
  }

  disconnectedCallback() {
    chrome.tabs.onActivated.removeListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.removeListener(this.boundTabUpdated);
  }

  /**
   * Adding a contest is a *contextual* action, not a navigational one — it is
   * only ever possible when the active browser tab is on a contest page. So
   * the offer lives in the shell, where it is visible from any view, rather
   * than behind the Contests tab where it spent most of its life greyed out.
   */
  watchActiveTab() {
    this.boundCheckActiveTab = () => this.checkActiveTab();
    this.boundTabUpdated = (_tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.status === "complete") this.checkActiveTab();
    };

    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdated);

    this.addBanner.addEventListener("click", (event) => {
      if (event.target.closest("#btn-add-contest")) this.handleAddContest();
    });

    this.checkActiveTab();
  }

  async checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      const match = tab?.url ? matchContestUrl(tab.url) : null;
      if (!match) {
        this.pendingContest = null;
        this.addBanner.classList.add("hidden");
        return;
      }

      // Keyed on platform + id: a bare id would call a CodeChef contest
      // "already tracked" because a Codeforces one shares its number.
      const key = makeContestKey(match.platform.id, match.contestId);
      const tracked = (await LocalDB.getTrackedContests()).some(
        (contest) => contestKey(contest) === key,
      );

      this.pendingContest = { url: tab.url, match, tracked };
      this.renderAddBanner();
    } catch (error) {
      console.error("Tab check failed:", error);
      this.addBanner.classList.add("hidden");
    }
  }

  renderAddBanner(state = {}) {
    const pending = this.pendingContest;
    if (!pending) return;

    const { match, tracked } = pending;
    const name = escapeHtml(`${match.platform.shortLabel} ${match.contestId}`);
    const label = state.label ?? (tracked ? "\u2713 Added" : "Add");
    const disabled = state.busy || tracked ? " disabled" : "";

    this.addBanner.innerHTML = `
      <span class="add-banner-text">${tracked ? "Tracking" : "Add"} <strong>${name}</strong></span>
      <button type="button" id="btn-add-contest" class="btn outline"${disabled}>${escapeHtml(label)}</button>`;
    this.addBanner.classList.remove("hidden");
  }

  async handleAddContest() {
    const pending = this.pendingContest;
    if (!pending || pending.tracked) return;

    // Unlock the export handle while the click is still fresh. A lapsed
    // permission can only be re-prompted under user activation, which will not
    // survive the network work below.
    const dirHandle = await verifyExportPermission();

    this.renderAddBanner({ busy: true, label: "Adding\u2026" });

    try {
      await processNewContest(pending.url, (message) =>
        message === null ? this.clearSyncStatus() : this.setSyncStatus(message),
      );

      pending.tracked = true;
      this.renderAddBanner();

      if (dirHandle && !(await writeBackup(dirHandle))) {
        this.setSyncStatus("Added, but auto-export failed to write the file.", {
          sticky: true,
        });
      }

      const currentView = this.routerOutlet.firstElementChild;
      if (typeof currentView?.refreshData === "function") {
        await currentView.refreshData();
      }
    } catch (error) {
      this.setSyncStatus(error.message, { sticky: true });
      this.renderAddBanner({ label: "Add" });
    } finally {
      this.clearSyncStatus();
    }
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
      const { removed: removedContests, failures } = await updateSolvedStatus(
        (message) => this.setSyncStatus(message),
      );

      // A platform refusing — someone else signed into CodeChef, say — has to
      // be seen. Silently skipping it looks exactly like a successful sync.
      if (failures.length > 0) {
        this.setSyncStatus(failures[0].message, { sticky: true });
      }

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
