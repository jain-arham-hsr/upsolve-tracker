import templateHtml from "./queue-view.html?raw";
import { LocalDB } from "../../services/storage.js";
import { hasCompleteSetup } from "../../settings/store.js";
import { SECTIONS } from "../../settings/schema.js";
import { matchesFilter } from "../../platforms/registry.js";
import { collectPendingProblems } from "../../pending-problems.js";
import {
  loadFilter,
  renderFilterControl,
  bindFilterControl,
} from "../platform-filter.js";
import { getEffectiveRatings } from "../../services/user-ratings.js";
import { compareQueueItems } from "../../queue-order.js";
import { toProblemRow, renderProblemRow } from "../problem-row.js";

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

    // Written from the settings schema rather than spelled out in the template,
    // which is how it came to offer two platforms out of three: CodeChef was
    // added and this sentence was not.
    //
    // Sections rather than platforms, because a section is what you actually
    // fill in — two Codeforces platforms share one, so naming platforms here
    // would offer "Codeforces Official" and "Codeforces Gyms" as separate
    // things to configure when there is only one.
    this.querySelector("#setup-message").textContent =
      "Add a handle in Settings so Upsolve Tracker can track what you've solved — " +
      `${listNames(SECTIONS.map((section) => section.title))}.`;

    this.querySelector("#btn-open-settings").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    // Nothing here works without credentials, so say so up front rather than
    // letting the queue look merely empty.
    this.setupPrompt.classList.toggle("hidden", await hasCompleteSetup());

    // Persisted, not held on the instance: the view is rebuilt on every tab
    // switch. Shared with the Contests tab so the two agree.
    this.filter = await loadFilter();
    this.filterControl = this.querySelector("#queue-filter");
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
    if (this.filterControl) {
      this.filterControl.innerHTML = renderFilterControl(this.filter ?? []);
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

    // Deduplicated: the same problem belongs to several contests on AtCoder
    // and CodeChef, so a flat walk would list it more than once.
    const upsolveList = collectPendingProblems(contests)
      .map((pending) => toProblemRow(pending, userRatings))
      // Easiest first, by solve probability. See queue-order.js for why the
      // rows without one split into two bands rather than one.
      .sort(compareQueueItems);

    this.countLabel.textContent = upsolveList.length;

    if (upsolveList.length === 0) {
      this.container.innerHTML = `
        <div class="muted" style="margin-top: 40px;">
          Upsolve queue is empty.<br>
          <span style="font-size: 0.75rem; opacity: 0.6;">Add a contest to get started.</span>
        </div>`;
      return;
    }

    this.container.innerHTML = upsolveList
      .map((row, i) => renderProblemRow(row, { position: i + 1 }))
      .join("");
  }
}

customElements.define("upsolve-queue-view", QueueView);

/** "A, B or C" — prose, so no Oxford comma and no trailing "and". */
function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}
