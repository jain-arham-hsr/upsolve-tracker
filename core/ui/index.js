import "./views/queue-view.js";
import "./views/contest-list.js";
import "./views/stats-view.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic
import {
  verifyExportPermission,
  writeBackup,
} from "../services/auto-export.js";
import { hasCompleteSetup } from "../settings/store.js";
import { processNewContest } from "../contest-manager.js";
import { LocalDB } from "../services/storage.js";
import { matchContestUrl, findTrackedContest } from "../platforms/registry.js";
import { waitingExplanation } from "./waiting-message.js";
import {
  loadWaiting,
  findWaiting,
  addWaiting,
  retryWaitingContests,
  WAITING_STORAGE_KEY,
} from "../waiting-contests.js";
import { escapeHtml } from "./escape-html.js";
import { platformIcon } from "./platform-icons.js";

// Inline so it inherits the header's colour and hover transition, which a
// colour emoji would ignore. Knobs are filled with the header background so
// they read as sitting on the sliders rather than behind them.
const SETTINGS_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
  <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"></path>
  <circle cx="6" cy="4.5" r="1.9" fill="var(--panel-bg)"></circle>
  <circle cx="10.5" cy="8" r="1.9" fill="var(--panel-bg)"></circle>
  <circle cx="5" cy="11.5" r="1.9" fill="var(--panel-bg)"></circle>
</svg>`;

// Inline for the same reason the gear is: it inherits currentColor and the
// button's disabled opacity, which a colour emoji would ignore, and it does not
// depend on the bundled Inter subsets happening to carry a clock glyph.
const CLOCK_ICON = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="8" cy="8" r="6.2"></circle>
  <path d="M8 4.4V8l2.4 1.6"></path>
</svg>`;

export class UpsolveApp extends HTMLElement {
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
    this.navigate("upsolve-queue-view");
  }

  disconnectedCallback() {
    chrome.tabs.onActivated.removeListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.removeListener(this.boundTabUpdated);
    chrome.storage.onChanged.removeListener(this.boundStorageChanged);
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

    // The banner is *derived* from storage — whether this contest is tracked,
    // and whether it is waiting — but it lives in the shell while both are
    // edited from the Contests view, which cannot reach up to it. Without
    // this, cancelling a wait or removing a contest leaves the banner
    // asserting the opposite until the panel is reopened: it kept offering
    // "Waiting" for a contest that had stopped waiting.
    //
    // Watching storage rather than taking an event from the view covers every
    // writer for free, including Import, which replaces both lists wholesale.
    this.boundStorageChanged = (changes, area) => {
      if (area !== "local") return;
      if (!("trackedContests" in changes) && !(WAITING_STORAGE_KEY in changes)) {
        return;
      }

      this.checkActiveTab();
      // The mounted view is derived from the same two lists, and had the
      // mirror-image bug: adding a contest that turned out to be waiting left
      // the Contests tab showing no sign of it until you navigated away and
      // back. Refreshing here rather than at each call site means a new writer
      // cannot forget — which is exactly how that one was missed, since the
      // path that succeeds outright had always refreshed explicitly.
      this.refreshCurrentView();
    };

    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdated);
    chrome.storage.onChanged.addListener(this.boundStorageChanged);

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

      // Matches the stored id or the one it was added from — a CodeChef
      // parent resolves to a division, so /START252 is stored as START252D
      // and a bare key comparison would offer to add it a second time.
      const tracked = findTrackedContest(
        await LocalDB.getTrackedContests(),
        match.platform.id,
        match.contestId,
      );

      // A contest the platform hasn't published yet is remembered rather than
      // just refused, so the banner has to say so instead of offering an Add
      // that would fail the same way.
      const waiting = findWaiting(
        await loadWaiting(),
        match.platform.id,
        match.contestId,
      );

      this.pendingContest = { url: tab.url, match, tracked, waiting };
      this.renderAddBanner();
    } catch (error) {
      console.error("Tab check failed:", error);
      this.addBanner.classList.add("hidden");
    }
  }

  renderAddBanner(state = {}) {
    const pending = this.pendingContest;
    if (!pending) return;

    const { match, tracked, waiting } = pending;

    // Name the contest actually stored, not the URL: landing on a CodeChef
    // parent should say which division is tracked.
    const shownId = tracked?.id ?? match.contestId;

    // Waiting is an indicator, not a control — like "Added", and disabled for
    // the same reason. Cancelling lives on the Contests tab, in the same menu
    // and behind the same dialog as removing a tracked contest.
    const label =
      state.label ?? (tracked ? "\u2713 Added" : waiting ? "Waiting" : "Add");
    const icon = !state.label && !tracked && waiting ? CLOCK_ICON : "";
    const disabled = state.busy || tracked || waiting ? " disabled" : "";

    const verb = tracked ? "Tracking" : waiting ? "Waiting for" : "Add";

    this.addBanner.innerHTML = `
      <span class="add-banner-text">
        <span class="add-banner-verb">${verb}</span>
        ${platformIcon(match.platform.id, match.platform.shortLabel)}
        <strong>${escapeHtml(String(shownId))}</strong>
      </span>
      <button type="button" id="btn-add-contest" class="btn outline"${disabled}>${icon}${escapeHtml(label)}</button>`;
    this.addBanner.classList.remove("hidden");
  }

  async handleAddContest() {
    const pending = this.pendingContest;
    if (!pending || pending.tracked || pending.waiting) return;

    // Unlock the export handle while the click is still fresh. A lapsed
    // permission can only be re-prompted under user activation, which will not
    // survive the network work below.
    const dirHandle = await verifyExportPermission();

    this.renderAddBanner({ busy: true, label: "Adding\u2026" });

    try {
      // The stored record comes back, which is what lets the banner name the
      // resolved division rather than the parent code the URL carried.
      const contest = await processNewContest(pending.url, (message) =>
        message === null ? this.clearSyncStatus() : this.setSyncStatus(message),
      );

      pending.tracked = contest;
      this.renderAddBanner();

      if (dirHandle && !(await writeBackup(dirHandle))) {
        this.setSyncStatus("Added, but auto-export failed to write the file.", {
          sticky: true,
        });
      }

    } catch (error) {
      // A platform that simply hasn't published the contest yet is not a
      // refusal to act on — it resolves on its own. Remember it and let the
      // refresh keep asking, rather than making the user come back and click
      // Add again at the one moment they most want it queued.
      if (error.isNotPublishedYet) {
        pending.waiting = await addWaiting({
          url: pending.url,
          platformId: pending.match.platform.id,
          contestId: pending.match.contestId,
          lastError: error.message,
        });
        this.renderAddBanner();
        this.setSyncStatus(waitingExplanation(error, pending.match.contestId), {
          sticky: true,
        });
      } else {
        this.setSyncStatus(error.message, { sticky: true });
        this.renderAddBanner({ label: "Add" });
      }
    } finally {
      this.clearSyncStatus();
    }
  }

  /**
   * Tells whichever view is mounted that its data moved under it.
   *
   * Not awaited by the storage listener — Chrome's callback is synchronous and
   * nothing downstream depends on the render having finished.
   */
  refreshCurrentView(removedContests) {
    const currentView = this.routerOutlet.firstElementChild;
    if (typeof currentView?.refreshData === "function") {
      return currentView.refreshData(removedContests);
    }
    return Promise.resolve();
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
      // 3. Retry anything that failed to add because the platform had not
      // published it yet. Before the sync, deliberately: a contest added here
      // then gets its solved status marked and lands in the same backup write,
      // rather than sitting a whole refresh behind.
      const { added: addedWaiting } = await retryWaitingContests((message) =>
        this.setSyncStatus(message),
      );

      // 4. Run the sync logic, reporting each stage as it starts
      const { removed: removedContests, failures } = await updateSolvedStatus(
        (message) => this.setSyncStatus(message),
      );

      // 5. The sync rewrites stored contests, so the backup has to follow it
      // or the file drifts from what the extension shows.
      if (dirHandle) {
        this.setSyncStatus("Writing backup…");
        await writeBackup(dirHandle);
      }

      // 6. If we are currently looking at the queue, tell it to update
      // Explicit here, and not left to the storage listener: the removed list
      // is what the queue announces, and a storage event cannot carry it.
      await this.refreshCurrentView(removedContests);

      // 7. A refresh that quietly grew the backlog is easy to miss, so say what
      // arrived. Reported before failures, which still get the last word.
      if (addedWaiting.length > 0) {
        const names = addedWaiting.map((entry) => entry.id).join(", ");
        this.setSyncStatus(`Added ${names} — it's published now.`, {
          sticky: true,
        });
      }

      // 8. Report a refusal *last*, so nothing overwrites it. A platform
      // declining to sync — someone else signed into CodeChef, say — has to be
      // seen: skipping it silently looks exactly like a successful sync, which
      // was half the problem the identity check exists to fix. Reporting it
      // earlier let "Writing backup…" clear it for precisely the users whose
      // backup is at risk.
      if (failures.length > 0) {
        const [first] = failures;
        const more = failures.length > 1 ? ` (+${failures.length - 1} more)` : "";
        this.setSyncStatus(`${first.message}${more}`, { sticky: true });
      }
    } catch (error) {
      console.error("Refresh failed:", error);
      this.setSyncStatus(`Sync failed: ${error.message}`, { sticky: true });
    } finally {
      // 9. UI Feedback: Stop spinning
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

customElements.define("upsolve-app", UpsolveApp);
