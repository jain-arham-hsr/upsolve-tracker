import templateHtml from "./queue-view.html?raw";
import { LocalDB } from "../../services/storage.js";

export class QueueView extends HTMLElement {
  constructor() {
    super();
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;
    this.container = this.querySelector("#problem-list");
    this.countLabel = this.querySelector("#pending-count");
    this.alertDiv = this.querySelector("#sync-alert");

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

  async renderQueue() {
    const contests = await LocalDB.getTrackedContests();
    const upsolveList = [];

    // 1. Collect all unsolved problems
    contests.forEach((contest) => {
      const isOfficial =
        contest.type && contest.type.toUpperCase() === "OFFICIAL";
      const path = isOfficial ? "contest" : "gym";

      contest.problems.forEach((prob) => {
        if (!prob.solved) {
          upsolveList.push({
            ...prob,
            contestId: contest.id,
            url: `https://codeforces.com/${path}/${contest.id}/problem/${prob.index}`,
            sourceLabel: `${isOfficial ? "Contest" : "Gym"} ${contest.id}${prob.index}`,
          });
        }
      });
    });

    // 2. Sort by rating (Ascending: easiest to hardest)
    // Problems with null ratings are treated as 9999 to appear at the end.
    upsolveList.sort((a, b) => (a.rating ?? 9999) - (b.rating ?? 9999));

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
        const rating = prob.rating ? `Rating: ${prob.rating}` : "Rating: ???";

        return `
        <a href="${prob.url}" target="_blank" class="problem-row">
          <div class="problem-index">${displayIndex}.</div>
          <div class="problem-content">
            <div class="problem-title">${prob.name}</div>
            <div class="problem-meta">
              <span class="rating">${rating}</span>
              <span class="source">${prob.sourceLabel}</span>
            </div>
          </div>
        </a>
      `;
      })
      .join("");
  }
}

customElements.define("cf-queue-view", QueueView);
