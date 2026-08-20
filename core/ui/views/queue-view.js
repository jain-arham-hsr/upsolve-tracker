import templateHtml from "./queue-view.html?raw";
import { LocalDB } from "../../services/storage.js";
import { escapeHtml } from "../escape-html.js";
import { hasCompleteSetup } from "../../services/secure-store.js";
import { platformOf, matchesFilter } from "../../platforms/registry.js";
import {
  loadFilter,
  renderFilterChips,
  bindFilterChips,
} from "../platform-filter.js";
import { getEffectiveRatings } from "../../services/user-ratings.js";
import {
  solveProbability,
  compareQueueItems,
  formatSolveProbability,
} from "../../queue-order.js";

export class QueueView extends HTMLElement {
  constructor() {
    super();
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;
    this.container = this.querySelector("#problem-list");
    this.countLabel = this.querySelector("#pending-count");
    this.alertDiv = this.querySelector("#sync-alert");
    this.setupPrompt = this.querySelector("#setup-prompt");

    this.querySelector("#btn-open-settings").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    // Nothing here works without credentials, so say so up front rather than
    // letting the queue look merely empty.
    this.setupPrompt.classList.toggle("hidden", await hasCompleteSetup());

    // Persisted, not held on the instance: the view is rebuilt on every tab
    // switch. Shared with the Contests tab so the two agree.
    this.filter = await loadFilter();
    this.filterChips = this.querySelector("#queue-filter-chips");
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
  }

  /**
   * Public method called by index.js when global refresh is clicked.
   */
  async refreshData(removedContests) {
    if (removedContests && removedContests.length > 0) {
      this.showInlineAlert(removedContests);
    }
    await this.renderQueue();
  }

  /**
   * Displays the professional green alert box for removed contests.
   */
  showInlineAlert(removedItems) {
    const messages = removedItems.map(
      (item) =>
        `All questions of ${item.type} ${item.id} have been solved. Hence removing from contest-list.`,
    );

    this.alertDiv.innerHTML = messages.join("<br><br>");
    this.alertDiv.classList.remove("hidden");

    setTimeout(() => {
      this.alertDiv.classList.add("hidden");
    }, 6000);
  }

  renderFilter() {
    if (this.filterChips) {
      this.filterChips.innerHTML = renderFilterChips(this.filter ?? []);
    }
  }

  async renderQueue() {
    const [allContests, userRatings] = await Promise.all([
      LocalDB.getTrackedContests(),
      getEffectiveRatings(),
    ]);

    // Shared with the Contests tab, so the two views agree on what's in scope.
    const contests = allContests.filter((contest) =>
      matchesFilter(contest, this.filter ?? []),
    );
    const upsolveList = [];

    // 1. Collect all unsolved problems
    contests.forEach((contest) => {
      const platform = platformOf(contest);

      contest.problems.forEach((prob) => {
        if (!prob.solved) {
          upsolveList.push({
            ...prob,
            contestId: contest.id,
            platform: platform.id,
            platformLabel: platform.shortLabel,
            startTimeSeconds: contest.startTimeSeconds ?? null,
            url: platform.problemUrl(contest, prob),
            sourceLabel: platform.sourceLabel(contest, prob),
            // Ratings from different sites aren't comparable, so the queue
            // orders by how likely you are to solve each one instead. Null
            // whenever either input is unknown — never a stand-in.
            solveProbability: solveProbability(
              prob.rating,
              userRatings[platform.id] ?? null,
            ),
          });
        }
      });
    });

    // 2. Easiest first, by solve probability. See queue-order.js for why the
    //    rows without one split into two bands rather than one.
    upsolveList.sort(compareQueueItems);

    // 3. Update the pending count
    this.countLabel.textContent = upsolveList.length;

    // 4. Handle the Empty State
    if (upsolveList.length === 0) {
      this.container.innerHTML = `
        <div class="muted" style="margin-top: 40px;">
          Upsolve queue is empty.<br>
          <span style="font-size: 0.75rem; opacity: 0.6;">Add a contest to get started.</span>
        </div>`;
      return;
    }

    // 5. Render the sorted list
    this.container.innerHTML = upsolveList
      .map((prob, i) => {
        const displayIndex = (i + 1).toString().padStart(2, "0");

        // `!= null`, not truthiness: AtCoder difficulties reach 0 and go
        // negative, and a truthy test would show a real 0 as unrated.
        const rating = prob.rating != null ? `Rating: ${prob.rating}` : "Rating: ???";
        const chance = formatSolveProbability(prob.solveProbability);

        // Names and problem indices are scraped or API-supplied, and the index
        // also feeds the href and the source label.
        const name = escapeHtml(
          prob.name?.replace(/\s+/g, " ").trim() || "Unknown Problem",
        );
        const url = escapeHtml(prob.url);
        const sourceLabel = escapeHtml(prob.sourceLabel);
        const platformLabel = escapeHtml(prob.platformLabel ?? "");
        const experimental =
          prob.ratingConfidence === "experimental"
            ? ' <span class="rating-flag" title="Low-confidence estimate">~</span>'
            : "";

        return `
        <a href="${url}" target="_blank" class="problem-row">
          <div class="problem-index">${displayIndex}.</div>
          <div class="problem-content">
            <div class="problem-title">${name}</div>
            <div class="problem-meta">
              <span class="meta-line">
                <span class="solve-chance" title="Estimated chance you solve this">${chance}</span>
                <span class="rating">${rating}${experimental}</span>
              </span>
              <span class="meta-line">
                <span class="platform-chip">${platformLabel}</span>
                <span class="source">${sourceLabel}</span>
              </span>
            </div>
          </div>
        </a>
      `;
      })
      .join("");
  }
}

customElements.define("cf-queue-view", QueueView);
