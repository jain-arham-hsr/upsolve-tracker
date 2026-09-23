import "./views/queue-view.js";
import "./views/contest-list.js";
import "./views/stats-view.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic
import {
  verifyExportPermission,
  backUp,
} from "../services/auto-export.js";
import { hasCompleteSetup } from "../settings/store.js";
import {
  getEffectiveRatings,
  ratingChangeMessage,
} from "../services/user-ratings.js";
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
import { StatusQueue } from "./status-queue.js";

// Long enough to read a one-line rating note before the backup step
// replaces it — twice the strip's ordinary minimum, since it is a sentence
// to read rather than a stage to glance at.
const RATING_NOTE_HOLD_MS = 3000;

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
    // Owns the strip's timing: every step stays up for its minimum. See
    // status-queue.js for why that is the strip's job and not the callers'.
    this.status = new StatusQueue({
      paint: ({ message, tone }) => {
        this.syncStatus.textContent = message;
        this.syncStatus.classList.remove("hidden");
        this.syncStatus.classList.toggle("is-error", tone === "error");
        this.syncStatus.classList.toggle("is-warning", tone === "warning");
      },
      hide: () => {
        this.syncStatus.classList.add("hidden");
        this.syncStatus.classList.remove("is-error", "is-warning");
      },
    });
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
    // Mid-add, only the add itself may redraw the banner.
    if (this.adding && !state.busy) return;

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

    // The banner stays on "Adding…" until the strip has shown the add's last
    // message: storage changes redraw it mid-add, and "Added" appearing while
    // the strip still narrates the add reads as the two disagreeing.
    this.adding = true;
    this.renderAddBanner({ busy: true, label: "Adding\u2026" });
    let bannerState = {};
    // Empty until read: a failed read then yields no note rather than a stuck
    // banner, since only a read inside the try reaches the finally.
    let ratingsBefore = {};

    try {
      ratingsBefore = await getEffectiveRatings();

      // The stored record comes back, which is what lets the banner name the
      // resolved division rather than the parent code the URL carried.
      // Every stage of one add is one step, so they replace each other freely
      // and only the add as a whole is held to the strip's minimum.
      const contest = await processNewContest(pending.url, (message) =>
        this.setSyncStatus(message, { step: "add" }),
      );

      pending.tracked = contest;

      // One message, not two: the rating note and the backup outcome close
      // the same add, and as separate steps the strip would spend a second
      // minimum on what is one outcome.
      const outcome = await backUp(dirHandle);
      const notes = [
        await ratingChangeMessage(ratingsBefore),
        outcome?.message,
      ].filter(Boolean);
      if (notes.length > 0) {
        this.setSyncStatus(notes.join(" · "), {
          sticky: true,
          tone: outcome?.tone ?? null,
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
        // The waiting entry is stored, and it travels in the backup like
        // everything else in storage — so this branch backs up too.
        const outcome = await backUp(dirHandle);
        // The identity, and with it the rating, was settled before the fetch
        // that found nothing, so a waiting add can still have moved it.
        const notes = [
          waitingExplanation(error, pending.match.contestId),
          await ratingChangeMessage(ratingsBefore),
          outcome?.message,
        ].filter(Boolean);
        this.setSyncStatus(notes.join(" · "), { sticky: true });
      } else {
        this.setSyncStatus(error.message, { sticky: true });
        bannerState = { label: "Add" };
      }
    } finally {
      await this.clearSyncStatus();
      this.adding = false;
      this.renderAddBanner(bannerState);
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
    // A string is progress; an object carries the options a message that has
    // to stay up needs.
    this.routerOutlet.addEventListener("cf-status", (event) => {
      const detail = event.detail;
      if (detail === null) {
        this.clearSyncStatus();
      } else if (typeof detail === "string") {
        this.setSyncStatus(detail);
      } else {
        const { message, ...options } = detail;
        this.setSyncStatus(message, options);
        if (options.sticky) this.clearSyncStatus();
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
      // Inside the try so a failed read cannot leave the button spinning.
      const ratingsBefore = await getEffectiveRatings();

      // 3. Retry anything that failed to add because the platform had not
      // published it yet. Before the sync, deliberately: a contest added here
      // then gets its solved status marked and lands in the same backup write,
      // rather than sitting a whole refresh behind.
      const { added: addedWaiting } = await retryWaitingContests((message) =>
        this.setSyncStatus(message, { step: "retry-waiting" }),
      );

      // 4. Run the sync logic, reporting each stage as it starts. A rating
      // that moved is announced as its "Updating your queue…" step, and
      // `hold` is how long that step then stays up — the length is the
      // panel's call, so progress-manager only asks for it.
      const progress = Object.assign(
        (message, options) => this.setSyncStatus(message, options),
        { hold: () => this.status.extendLatest(RATING_NOTE_HOLD_MS) },
      );
      const { removed: removedContests, failures } = await updateSolvedStatus(
        progress,
        { ratingsBefore },
      );

      // 5. The sync rewrites stored contests, so the backup has to follow it
      // or the file drifts from what the extension shows.
      if (dirHandle) this.setSyncStatus("Writing backup…");
      const outcome = await backUp(dirHandle);

      // 6. If we are currently looking at the queue, tell it to update
      // Explicit here, and not left to the storage listener: the removed list
      // is what the queue announces, and a storage event cannot carry it.
      await this.refreshCurrentView(removedContests);

      // 7. A refresh that quietly grew the backlog is easy to miss, so say
      // what arrived — in one message with the backup outcome, since both
      // close the same refresh and two steps would hold the strip twice.
      const closing = [];
      if (addedWaiting.length > 0) {
        const names = addedWaiting.map((entry) => entry.id).join(", ");
        closing.push(`Added ${names} — it's published now.`);
      }
      if (outcome) closing.push(outcome.message);
      if (closing.length > 0) {
        this.setSyncStatus(closing.join(" · "), {
          sticky: true,
          tone: outcome?.tone ?? null,
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
      // 9. UI Feedback: stop spinning — once the strip has shown the last
      // step, so the button does not say "done" while it is still narrating.
      await this.clearSyncStatus();
      this.btnRefresh.classList.remove("spinning");
      this.btnRefresh.disabled = false;
    }
  }

  /**
   * The stages have no measurable total, so this reports what is happening
   * rather than how far along it is.
   */
  setSyncStatus(message, { sticky = false, tone = sticky ? "error" : null, step = null } = {}) {
    this.status.enqueue(message, { sticky, tone, step });
  }

  /**
   * The operation is over. Resolves once its last message has had its time on
   * screen, which is when a caller may say it is done; a note or a failure
   * then lingers, while progress text goes.
   */
  clearSyncStatus() {
    return this.status.finish();
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
