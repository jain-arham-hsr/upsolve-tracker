import templateHtml from "./contest-list.html?raw";
import { processNewContest } from "../../contest-manager.js";
import { LocalDB } from "../../services/storage.js";
import {
  BACKUP_FILENAME,
  verifyExportPermission,
  writeBackup,
} from "../../services/auto-export.js";
import { byStartTimeDesc } from "../../start-time-service.js";
import { describeBackupProblem } from "../../backup-validation.js";
import { escapeHtml } from "../escape-html.js";
import {
  platformOf,
  matchContestUrl,
  contestKey,
  makeContestKey,
  matchesFilter,
} from "../../platforms/registry.js";
import {
  loadFilter,
  renderFilterChips,
  bindFilterChips,
} from "../platform-filter.js";

/** How long the remove button must be held. Drives the fill animation too. */
const HOLD_MS = 700;


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
    this.filter = "ALL";
    this.hold = null;
    this.boundCancelHold = () => this.cancelHold();
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;

    // UI References
    this.btnAddContest = this.querySelector("#btn-add-contest");
    this.container = this.querySelector("#contest-items");
    this.btnExport = this.querySelector("#btn-export");
    this.btnImport = this.querySelector("#btn-import");
    this.fileInput = this.querySelector("#import-file-input");
    this.alertDiv = this.querySelector("#contest-alert");
    this.countLabel = this.querySelector("#contest-count");

    this.btnAddContest.disabled = true;
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    // The view is destroyed on every navigation, so the choice is persisted
    // rather than kept on the instance.
    this.filter = await loadFilter();
    this.filterChips = this.querySelector("#contest-filter-chips");
    this.renderFilter();

    bindFilterChips(
      this.filterChips,
      () => this.filter,
      async (next) => {
        this.filter = next;
        this.renderFilter();
        await this.renderQueue();
      },
    );

    await this.renderQueue();

    this.btnAddContest.addEventListener("click", async () => {
      if (this.currentValidUrl) {
        // 1. Instantly test/prompt and store the unlocked handle
        const activeDirHandle = await verifyExportPermission();

        this.btnAddContest.textContent = "Fetching...";
        this.btnAddContest.disabled = true;
        this.alertDiv.classList.add("hidden");

        try {
          // 2. Run the slow Codeforces API logic, reporting each stage
          await processNewContest(this.currentValidUrl, (message) =>
            this.reportStatus(message),
          );
          await this.renderQueue();

          // 3. Write using the exact handle we just unlocked
          if (activeDirHandle && !(await writeBackup(activeDirHandle))) {
            this.showInlineAlert(
              "Added to Queue, but Auto-Export failed to write the file.",
            );
          }

          this.btnAddContest.textContent = "✓ Added";
          this.btnAddContest.disabled = true;
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Contest added successfully!",
          );
        } catch (error) {
          this.showInlineAlert(error.message);
          this.btnAddContest.textContent = "+ Add Contest";
          this.btnAddContest.disabled = false;
        } finally {
          this.reportStatus(null);
        }
      }
    });

    // Management Actions
    this.btnExport.addEventListener("click", async () => {
      const allData = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(allData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = BACKUP_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
    });

    this.btnImport.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      // Reset so re-picking the same file fires change again.
      this.fileInput.value = "";
      if (!file) return;

      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        this.showInlineAlert(`${file.name} isn't valid JSON.`);
        return;
      }

      const problem = describeBackupProblem(data);
      if (problem) {
        this.showInlineAlert(problem);
        return;
      }

      this.confirmImport(data);
    });

    // Delegated so the handlers outlive each renderQueue() rewrite.
    this.container.addEventListener("pointerdown", (e) => this.startHold(e));
    // pointerleave doesn't bubble, so catch it on the way down.
    this.container.addEventListener(
      "pointerleave",
      (e) => {
        if (this.hold && e.target === this.hold.button) this.cancelHold();
      },
      true,
    );
    // Releasing anywhere aborts, including outside the panel.
    document.addEventListener("pointerup", this.boundCancelHold);
    document.addEventListener("pointercancel", this.boundCancelHold);

    this.checkActiveTab();
    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdatedHandler);
  }

  /**
   * Deleting is a hold rather than a click, so a stray press does nothing at
   * all — no dialog to dismiss, no state changed.
   */
  startHold(event) {
    if (event.button !== 0) return; // Left button / primary touch only
    const button = event.target.closest(".contest-delete");
    if (!button) return;

    event.preventDefault(); // Suppress focus ring, text selection and drag
    this.cancelHold();

    button.style.animationDuration = `${HOLD_MS}ms`;
    button.classList.add("holding");

    this.hold = {
      button,
      contestId: button.dataset.id,
      platformId: button.dataset.platform,
      timer: setTimeout(() => this.completeHold(), HOLD_MS),
    };
  }

  cancelHold() {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold.button.classList.remove("holding");
    this.hold = null;
  }

  async completeHold() {
    if (!this.hold) return;
    const { contestId, platformId } = this.hold;
    this.cancelHold();

    await LocalDB.removeTrackedContest(platformId, contestId);
    await this.renderQueue();

    // Storage changed, so the backup has to follow. Still inside the
    // activation window opened by the pointerdown that began the hold.
    const dirHandle = await verifyExportPermission();
    if (dirHandle) await writeBackup(dirHandle);

    // Re-enables "+ Add Contest" if the removed contest is the open tab.
    await this.checkActiveTab();
  }

  /**
   * Called by the shell after a global refresh. The sync can drop fully
   * solved contests and resolve missing dates, both of which change this list.
   */
  async refreshData() {
    await this.renderQueue();
  }

  /** Routes a long-operation message to the shell's status strip. */
  reportStatus(message) {
    this.dispatchEvent(
      new CustomEvent("cf-status", { detail: message, bubbles: true }),
    );
  }

  /**
   * Importing overwrites the queue with no undo, so it states what is about
   * to happen and waits rather than acting on the file picker alone.
   */
  confirmImport(data) {
    const incoming = data.trackedContests.length;
    const current = this.container.querySelectorAll(".contest-item").length;

    this.alertDiv.innerHTML = `
      <div>Replace your queue with ${incoming} contest${incoming === 1 ? "" : "s"} from this backup?
      ${current > 0 ? `The ${current} currently listed will be discarded.` : ""}</div>
      <div class="alert-actions">
        <button type="button" class="btn outline" data-import-confirm>Import</button>
        <button type="button" class="btn outline" data-import-cancel>Cancel</button>
      </div>`;
    this.alertDiv.classList.remove("hidden");
    clearTimeout(this.alertTimer);

    this.alertDiv
      .querySelector("[data-import-cancel]")
      .addEventListener("click", () => this.alertDiv.classList.add("hidden"));

    this.alertDiv
      .querySelector("[data-import-confirm]")
      .addEventListener("click", async () => {
        try {
          await chrome.storage.local.set(data);
          await this.renderQueue();
          this.showInlineAlert(`Imported ${incoming} contest(s).`);
        } catch (error) {
          this.showInlineAlert(`Import failed: ${error.message}`);
        }
      });
  }

  showInlineAlert(message) {
    const cleanMessage = message.replace(/^Error:\s*/i, "");
    this.alertDiv.textContent = cleanMessage;
    this.alertDiv.classList.remove("hidden");
    // Tracked so a pending hide can't dismiss a confirmation mid-decision.
    clearTimeout(this.alertTimer);
    this.alertTimer = setTimeout(() => {
      this.alertDiv.classList.add("hidden");
    }, 6000);
  }

  renderFilter() {
    if (this.filterChips) {
      this.filterChips.innerHTML = renderFilterChips(this.filter);
    }
  }

  async renderQueue() {
    const allContests = await LocalDB.getTrackedContests();

    if (allContests.length === 0) {
      this.countLabel.textContent = "Nothing queued";
      this.container.innerHTML = `<div class="muted">No contests in queue.</div>`;
      return;
    }

    const contests = allContests
      .filter((contest) => matchesFilter(contest, this.filter))
      .sort(byStartTimeDesc);

    // Says "8 of 14" only when a filter is actually hiding something.
    this.countLabel.textContent =
      contests.length === allContests.length
        ? `${allContests.length} contest${allContests.length === 1 ? "" : "s"}`
        : `${contests.length} of ${allContests.length} contests`;

    if (contests.length === 0) {
      this.container.innerHTML = `<div class="muted">Nothing matches that filter.</div>`;
      return;
    }

    this.container.innerHTML = contests
      .map((contest) => {
        const platform = platformOf(contest);
        const label = platform.subtypeLabel(contest);
        const typeClass = platform.badgeClass(contest);
        const url = platform.contestUrl(contest);

        // Scraped names carry stray newlines/indentation from the CF page.
        const rawName = contest.name?.replace(/\s+/g, " ").trim();
        const name = escapeHtml(rawName || `Contest ${contest.id}`);

        // The button has to sit outside the anchor: nesting it would make
        // every press navigate to Codeforces.
        return `
        <div class="contest-item">
          <a href="${url}" target="_blank" class="contest-row">
            <span class="contest-name">${name}</span>
            <span class="contest-tags">
              <span class="contest-platform">${escapeHtml(platform.shortLabel)}</span>
              <span class="contest-id">#${escapeHtml(String(contest.id))}</span>
              <span class="contest-type ${typeClass}">${label}</span>
            </span>
          </a>
          <button type="button" class="contest-delete"
                  data-id="${escapeHtml(contest.id)}"
                  data-platform="${escapeHtml(platform.id)}"
                  title="Hold to remove from queue">✕</button>
        </div>
      `;
      })
      .join("");
  }

  disconnectedCallback() {
    this.cancelHold();
    document.removeEventListener("pointerup", this.boundCancelHold);
    document.removeEventListener("pointercancel", this.boundCancelHold);
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
        const match = matchContestUrl(tab.url);

        if (match) {
          this.currentValidUrl = tab.url;

          // Keyed on platform + id: a bare id would call a CodeChef contest
          // "already tracked" because a Codeforces one shares its number.
          const key = makeContestKey(match.platform.id, match.contestId);
          const contests = await LocalDB.getTrackedContests();
          const isAlreadyTracked = contests.some(
            (contest) => contestKey(contest) === key,
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
            "Must be on a supported contest page.",
          );
        }
      } else {
        this.btnAddContest.setAttribute(
          "data-tooltip",
          "Navigate to a contest page first.",
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
