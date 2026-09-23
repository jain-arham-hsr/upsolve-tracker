import templateHtml from "./contest-list.html?raw";
import { LocalDB } from "../../services/storage.js";
import {
  BACKUP_FILENAME,
  verifyExportPermission,
  backUp,
  AUTO_EXPORT_KEY,
} from "../../services/auto-export.js";
import { byStartTimeDesc } from "../../queue-order.js";
import { describeBackupProblem } from "../../backup-validation.js";
import { escapeHtml } from "../escape-html.js";
import {
  platformOf,
  getPlatform,
  matchesFilter,
  contestKey,
} from "../../platforms/registry.js";
import { collectPendingProblems } from "../../pending-problems.js";
import { getEffectiveRatings } from "../../services/user-ratings.js";
import { toProblemRow, renderProblemRow } from "../problem-row.js";
import { compareQueueItems } from "../../queue-order.js";
import { bindDismiss } from "../dismissable.js";
import { platformIcon } from "../platform-icons.js";
import {
  loadWaiting,
  cancelWaiting,
  waitingKey,
} from "../../waiting-contests.js";
import {
  loadFilter,
  renderFilterControl,
  bindFilterControl,
} from "../platform-filter.js";

/** Which contests are expanded, persisted because the view is rebuilt on
 *  every tab switch — in-memory state would collapse each time you glanced at
 *  the Queue. */
const EXPANDED_KEY = "upsolve_tracker.expanded_contests";

/** Whether the waiting strip is open, persisted for the same reason. */
const WAITING_OPEN_KEY = "upsolve_tracker.waiting_expanded";

/** Matches the shell's banner, so the two states read as one thing. */
const CLOCK_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="8" cy="8" r="6.2"></circle>
  <path d="M8 4.4V8l2.4 1.6"></path>
</svg>`;

/**
 * The strip's only affordance. A contest row needs no chevron — the expansion
 * appearing under it *is* the indicator — but this header collapses to a
 * single bar with nothing beneath it, so there is nothing to see and no reason
 * to guess it opens. Down when closed, up when open — never sideways, which
 * at a row's right edge means "drill in" rather than "expand". It rotates
 * rather than swapping glyphs, so the two states cannot drift apart.
 */
const CHEVRON_ICON = `<svg class="waiting-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 6.2l4 4 4-4"></path>
</svg>`;


export class ContestList extends HTMLElement {
  constructor() {
    super();
    this.filter = [];
    this.expanded = new Set();
    this.waitingOpen = false;
    this.openMenuKey = null;
    this.dismissMenu = null;
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;

    // UI References
    this.container = this.querySelector("#contest-items");
    this.btnExport = this.querySelector("#btn-export");
    this.btnImport = this.querySelector("#btn-import");
    this.fileInput = this.querySelector("#import-file-input");
    this.alertDiv = this.querySelector("#contest-alert");
    this.countLabel = this.querySelector("#contest-count");
    this.modal = this.querySelector("#remove-modal");
    this.modalName = this.querySelector("#remove-modal-name");
    this.modalTitle = this.querySelector("#remove-modal-title");
    this.modalHelp = this.querySelector("#remove-modal-help");
    this.modalConfirm = this.querySelector("#remove-confirm");
    this.modalCancel = this.querySelector("#remove-cancel");
    this.waitingSection = this.querySelector("#waiting-section");

    this.modalCard = this.querySelector(".modal-card");
    this.modalCancel.addEventListener("click", () => this.closeModal());
    this.querySelector("#remove-confirm").addEventListener("click", () =>
      this.confirmRemove(),
    );

    // The view is destroyed on every navigation, so the choice is persisted
    // rather than kept on the instance.
    this.filter = await loadFilter();
    this.filterControl = this.querySelector("#contest-filter");
    this.renderFilter();

    bindFilterControl(
      this.filterControl,
      () => this.filter,
      async (next) => {
        this.filter = next;
        this.renderFilter();
        await this.renderQueue();
      },
    );

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
    // Expansion is persisted for the same reason the filter is: this view is
    // destroyed and rebuilt on every tab switch.
    const stored = await chrome.storage.local.get({
      [EXPANDED_KEY]: [],
      [WAITING_OPEN_KEY]: false,
    });
    this.expanded = new Set(stored[EXPANDED_KEY]);
    this.waitingOpen = stored[WAITING_OPEN_KEY] === true;

    this.container.addEventListener("click", (event) => this.onListClick(event));

    // The same handler, not a second copy: a waiting row carries the same
    // [data-menu-key] / [data-open-url] / [data-remove-key] hooks, and the
    // trailing [data-toggle-key] branch simply never matches one.
    this.waitingSection.addEventListener("click", (event) =>
      this.onListClick(event),
    );

    await this.renderAll();
  }

  /**
   * One delegated handler, because the list is re-rendered wholesale and
   * per-row listeners would have to be rebound every time.
   */
  async onListClick(event) {
    const menuBtn = event.target.closest("[data-menu-key]");
    if (menuBtn) {
      // Must not also toggle the accordion underneath it.
      event.stopPropagation();
      await this.toggleMenu(menuBtn.dataset.menuKey);
      return;
    }

    const openLink = event.target.closest("[data-open-url]");
    if (openLink) {
      window.open(openLink.dataset.openUrl, "_blank", "noopener");
      await this.closeMenu();
      return;
    }

    const removeBtn = event.target.closest("[data-remove-key]");
    if (removeBtn) {
      const key = removeBtn.dataset.removeKey;
      await this.closeMenu();
      this.askToRemove(key);
      return;
    }

    if (event.target.closest("[data-waiting-toggle]")) {
      await this.toggleWaitingOpen();
      return;
    }

    const row = event.target.closest("[data-toggle-key]");
    if (row) await this.toggleExpanded(row.dataset.toggleKey);
  }

  async toggleWaitingOpen() {
    this.waitingOpen = !this.waitingOpen;
    await chrome.storage.local.set({ [WAITING_OPEN_KEY]: this.waitingOpen });
    this.renderWaiting();
  }

  async toggleExpanded(key) {
    if (this.expanded.has(key)) {
      this.expanded.delete(key);
    } else {
      this.expanded.add(key);
    }

    await chrome.storage.local.set({ [EXPANDED_KEY]: [...this.expanded] });
    await this.renderQueue();
  }

  async toggleMenu(key) {
    const next = this.openMenuKey === key ? null : key;
    await this.closeMenu();

    if (!next) return;
    this.openMenuKey = next;
    // Both sections: openMenuKey is shared, and repainting only one would
    // leave a menu open in the list and invisible in the strip, or vice versa.
    await this.renderAll();

    // Scoped to the view, not to #contest-items, so a waiting row is found too.
    // Same dismiss behaviour as the filter dropdown, rather than a second
    // implementation that differs in one of the three cases.
    const item = this.querySelector(`[data-key="${CSS.escape(next)}"]`);
    if (item) this.dismissMenu = bindDismiss(item, () => this.closeMenu());
  }

  async closeMenu() {
    this.dismissMenu?.();
    this.dismissMenu = null;

    if (this.openMenuKey === null) return;
    this.openMenuKey = null;
    await this.renderAll();
  }

  /**
   * Removal asks first. That replaces the 700 ms hold as the thing standing
   * between a stray press and a deleted contest — and it is a better guard,
   * because it says what is about to happen instead of relying on a timer.
   */
  askToRemove(key) {
    const contest = this.contestsByKey?.get(key);
    const entry = contest ? null : this.waitingByKey?.get(key);
    if (!contest && !entry) return;

    // Two things can be confirmed here, and the wording has to match: a
    // waiting contest has no problems in the queue, so "its unsolved problems
    // leave the queue" would describe something that never happened.
    const platform = contest ? platformOf(contest) : getPlatform(entry.platform);
    const name = contest
      ? contest.name?.replace(/\s+/g, " ").trim() || `Contest ${contest.id}`
      : String(entry.contestId);

    this.modalTitle.textContent = contest
      ? "Remove from queue?"
      : "Stop waiting for this contest?";
    this.modalHelp.textContent = contest
      ? "Its unsolved problems leave the queue. Nothing is deleted on the contest site, and you can add it again later."
      : "It won't be retried on the next refresh. You can add it again from its contest page whenever the platform publishes it.";
    this.modalConfirm.textContent = contest ? "Remove" : "Stop waiting";

    // Marked like the row it was opened from, so the dialog visibly names the
    // same contest rather than restating its title in isolation. innerHTML,
    // so the name has to be escaped — it is scraped.
    this.modalName.innerHTML =
      `${platformIcon(platform.id, platform.shortLabel)}<span>${escapeHtml(name)}</span>`;
    this.modal.classList.remove("hidden");
    this.pendingRemoval = { key, contest, entry };

    // Backdrop click and Escape both dismiss. Reusing the popover helper means
    // Escape works wherever focus happens to be, which a listener on this view
    // did not.
    this.dismissModal = bindDismiss(this.modalCard, () => this.closeModal());
    this.modalCancel.focus();
  }

  closeModal() {
    this.dismissModal?.();
    this.dismissModal = null;
    this.modal.classList.add("hidden");
    this.pendingRemoval = null;
  }

  async confirmRemove() {
    const pending = this.pendingRemoval;
    this.closeModal();
    if (!pending) return;

    const { contest, entry } = pending;
    // While the confirm click is fresh: a lapsed folder can only be
    // re-prompted under user activation.
    const dirHandle = await verifyExportPermission();

    if (entry) {
      await cancelWaiting(entry.platform, entry.contestId);
    } else {
      await LocalDB.removeTrackedContest(contest.platform, contest.id);
      this.expanded.delete(pending.key);
      await chrome.storage.local.set({ [EXPANDED_KEY]: [...this.expanded] });
    }

    await this.renderAll();

    // Storage changed, so the backup has to follow it or the exported JSON
    // drifts from what the panel shows.
    await this.backUpAndReport(dirHandle);
  }

  /** Writes the backup and puts the outcome, if any, in the shell's strip. */
  async backUpAndReport(dirHandle) {
    const outcome = await backUp(dirHandle);
    if (outcome) this.reportStatus({ ...outcome, sticky: true });
  }

  /**
   * Called by the shell after a global refresh. The sync can drop fully
   * solved contests and resolve missing dates, both of which change this list.
   */
  async refreshData() {
    await this.renderAll();
  }

  /**
   * Routes a message to the shell's status strip: a string for progress, or
   * `{message, sticky, tone}` for one that has to stay up.
   */
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
        const dirHandle = await verifyExportPermission();
        try {
          // Auto-export belongs to this browser, not the backup: its folder
          // lives in IndexedDB and never travels in the file. Importing the
          // flag would switch auto-export on with no folder behind it.
          const { [AUTO_EXPORT_KEY]: _ignored, ...incomingData } = data;
          await chrome.storage.local.set(incomingData);
          await this.renderAll();
          this.showInlineAlert(`Imported ${incoming} contest(s).`);
          await this.backUpAndReport(dirHandle);
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
    if (this.filterControl) {
      this.filterControl.innerHTML = renderFilterControl(this.filter);
    }
  }

  /**
   * Both sections. The menu key is shared between them, so anything that can
   * open or close a menu has to repaint both or one is left stale.
   */
  async renderAll() {
    // Waiting first: the queue's empty state reads differently when something
    // is on its way in, and it needs the loaded list to know.
    await this.renderWaitingSection();
    await this.renderQueue();
  }

  async renderWaitingSection() {
    this.waiting = await loadWaiting();
    this.renderWaiting();
  }

  /**
   * The waiting strip: contests that failed to add because the platform had
   * not published them yet, and are retried on every refresh.
   *
   * Collapsible and hidden outright when empty. Its rows reuse the contest
   * row's markup so it reads as the same component, with one deliberate
   * difference: **the row is not a button.** There is no accordion, because a
   * waiting contest has no problems to list and an expansion that opened onto
   * nothing would read as a broken row.
   */
  renderWaiting() {
    const entries = this.waiting ?? [];

    if (entries.length === 0) {
      this.waitingSection.classList.add("hidden");
      this.waitingSection.innerHTML = "";
      this.waitingByKey = new Map();
      return;
    }

    this.waitingByKey = new Map(entries.map((entry) => [waitingKey(entry), entry]));

    const rows = this.waitingOpen
      ? `<div class="waiting-items">${entries
          .map((entry) => this.renderWaitingRow(entry))
          .join("")}</div>`
      : "";

    this.waitingSection.innerHTML = `
      <button type="button" class="waiting-head" data-waiting-toggle
              aria-expanded="${this.waitingOpen}">
        <span class="waiting-head-label">
          ${CLOCK_ICON}
          <span>${entries.length} waiting</span>
        </span>
        ${CHEVRON_ICON}
      </button>
      ${rows}`;
    this.waitingSection.classList.remove("hidden");
  }

  renderWaitingRow(entry) {
    const platform = getPlatform(entry.platform);
    const key = waitingKey(entry);
    const safeKey = escapeHtml(key);

    // The last failure, when it was something other than "not published yet" —
    // the only place a genuinely stuck entry is visible. Without it a wait that
    // can never end looks identical to one that is merely young.
    const note = entry.lastError
      ? escapeHtml(entry.lastError)
      : "Retried on every refresh.";

    return `
      <div class="contest-item waiting-item" data-key="${safeKey}">
        <div class="contest-head">
          <div class="contest-row is-static">
            <span class="contest-name">
              ${platformIcon(platform.id, platform.shortLabel)}
              <span>${escapeHtml(String(entry.contestId))}</span>
            </span>
          </div>
          <button type="button" class="contest-menu-btn" data-menu-key="${safeKey}"
                  aria-haspopup="menu" aria-expanded="${this.openMenuKey === key}"
                  title="More">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="3" r="1.6"></circle>
              <circle cx="8" cy="8" r="1.6"></circle>
              <circle cx="8" cy="13" r="1.6"></circle>
            </svg>
          </button>
          ${this.openMenuKey === key ? this.renderWaitingMenu(entry, safeKey) : ""}
        </div>
        <div class="waiting-note">${note}</div>
      </div>`;
  }

  renderWaitingMenu(entry, safeKey) {
    return `
      <div class="row-menu" role="menu">
        <button type="button" class="row-menu-item" role="menuitem"
                data-open-url="${escapeHtml(entry.url)}">
          Open contest ↗
        </button>
        <button type="button" class="row-menu-item is-danger" role="menuitem"
                data-remove-key="${safeKey}">
          Stop waiting
        </button>
      </div>`;
  }

  async renderQueue() {
    const [allContests, userRatings] = await Promise.all([
      LocalDB.getTrackedContests(),
      getEffectiveRatings(),
    ]);

    if (allContests.length === 0) {
      // Waiting entries are not tracked, so they do not count — but saying
      // "no contests" flat while a strip above lists two reads as a bug.
      const waitingCount = this.waiting?.length ?? 0;
      this.countLabel.textContent = "Nothing queued";
      this.container.innerHTML = `<div class="muted">${
        waitingCount > 0
          ? "No contests in queue yet — the ones above are still waiting to be published."
          : "No contests in queue."
      }</div>`;
      return;
    }

    const contests = allContests
      .filter((contest) => matchesFilter(contest, this.filter))
      .sort(byStartTimeDesc);

    // Says "8 of 14" only when a filter is actually hiding something.
    this.countLabel.textContent =
      contests.length === allContests.length
        ? `${allContests.length} contest${allContests.length === 1 ? "" : "s"} tracking`
        : `${contests.length} of ${allContests.length} contests tracking`;

    if (contests.length === 0) {
      this.container.innerHTML = `<div class="muted">Nothing matches that filter.</div>`;
      return;
    }

    // The removal dialog needs the record behind a row, and the row only
    // carries its key.
    this.contestsByKey = new Map(contests.map((c) => [contestKey(c), c]));

    this.container.innerHTML = contests
      .map((contest) => this.renderContest(contest, userRatings))
      .join("");
  }

  renderContest(contest, userRatings) {
    const platform = platformOf(contest);
    const key = contestKey(contest);
    const isOpen = this.expanded.has(key);

    // Scraped names carry stray newlines/indentation from the CF page.
    const rawName = contest.name?.replace(/\s+/g, " ").trim();
    const name = escapeHtml(rawName || `Contest ${contest.id}`);
    const safeKey = escapeHtml(key);

    // The platform mark leads the name rather than sitting in the pill row: it
    // says which site this contest is from, which belongs with its title, not
    // among the id and type pills.
    //
    // No chevron: the expansion itself is the indicator. aria-expanded carries
    // it for anything that can't see the difference.
    return `
      <div class="contest-item" data-key="${safeKey}">
        <div class="contest-head">
          <button type="button" class="contest-row" data-toggle-key="${safeKey}"
                  aria-expanded="${isOpen}">
            <span class="contest-name">
              ${platformIcon(platform.id, platform.shortLabel)}
              <span>${name}</span>
            </span>
            <span class="contest-tags">
              ${platform
                .contestFlags(contest)
                .map((flag) => `<span class="contest-flag">${escapeHtml(flag)}</span>`)
                .join("")}
              <span class="contest-id">${escapeHtml(platform.contestIdLabel(contest))}</span>
            </span>
          </button>
          <button type="button" class="contest-menu-btn" data-menu-key="${safeKey}"
                  aria-haspopup="menu" aria-expanded="${this.openMenuKey === key}"
                  title="More">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="3" r="1.6"></circle>
              <circle cx="8" cy="8" r="1.6"></circle>
              <circle cx="8" cy="13" r="1.6"></circle>
            </svg>
          </button>
          ${this.openMenuKey === key ? this.renderMenu(platform, contest, safeKey) : ""}
        </div>
        ${isOpen ? this.renderProblems(contest, platform, userRatings) : ""}
      </div>`;
  }

  renderMenu(platform, contest, safeKey) {
    return `
      <div class="row-menu" role="menu">
        <button type="button" class="row-menu-item" role="menuitem"
                data-open-url="${escapeHtml(platform.contestUrl(contest))}">
          Open contest ↗
        </button>
        <button type="button" class="row-menu-item is-danger" role="menuitem"
                data-remove-key="${safeKey}">
          Remove from queue
        </button>
      </div>`;
  }

  /**
   * What this contest still owes the queue.
   *
   * Rendered with the queue's own row renderer in its compact form, so the two
   * cannot disagree about ordering or about what a row says. Positions are
   * omitted — the queue's numbering is global and would mislead here — and so
   * are the platform mark and contest code, which the header above already
   * carries.
   *
   * Deliberately scoped to this contest rather than deduplicated against the
   * others: a problem shared with another division really is in both, and
   * hiding it here would make the contest look shorter than it is.
   */
  renderProblems(contest, platform, userRatings) {
    // `includeUnupsolvable`: the queue drops problems that were never mirrored
    // to practice, but this is a contest's own list — omitting them here would
    // make the contest look shorter than it is, and give no clue why.
    const pending = collectPendingProblems([contest], { includeUnupsolvable: true })
      .map((entry) => toProblemRow(entry, userRatings))
      .sort(compareQueueItems);

    // A fully solved contest is dropped from storage by the refresh, so this
    // should not happen — but an empty box would read as a broken expansion.
    if (pending.length === 0) {
      return `<div class="contest-problems">
        <div class="muted contest-problems-empty">Nothing pending here.</div>
      </div>`;
    }

    // Column widths come from CSS: the container is a grid and each row
    // borrows its columns with `subgrid`, so the names line up whatever the
    // codes are. Measuring the widest code here and sizing in `ch` was tried
    // and is too fragile — see the note in style.css.
    return `<div class="contest-problems">${pending
      .map((row) => renderProblemRow(row, { compact: true }))
      .join("")}</div>`;
  }

  disconnectedCallback() {
    // The dismiss listeners are on document, so they outlive this view unless
    // torn down here.
    this.dismissMenu?.();
    this.dismissMenu = null;
    this.dismissModal?.();
    this.dismissModal = null;
  }

}

customElements.define("upsolve-contest-list", ContestList);
