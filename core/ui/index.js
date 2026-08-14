import "./views/queue-view.js";
import "./views/contest-list.js";
import "./views/stats-view.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic

// Inline so it inherits the header's colour and hover transition, which a
// colour emoji would ignore.
const STATS_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
  <rect x="1" y="9" width="3.4" height="6" rx="0.7"></rect>
  <rect x="6.3" y="5" width="3.4" height="10" rx="0.7"></rect>
  <rect x="11.6" y="1.5" width="3.4" height="13.5" rx="0.7"></rect>
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
    this.btnViewList = this.querySelector("#btn-view-list");
    this.btnStats = this.querySelector("#btn-stats");
    this.btnRefresh = this.querySelector("#btn-refresh");

    this.setupListeners();
    this.navigate("cf-queue-view");
  }

  setupListeners() {
    this.btnViewList.addEventListener("click", () => {
      this.toggleView("cf-contest-list");
    });

    this.btnStats.addEventListener("click", () => {
      this.toggleView("cf-stats-view");
    });

    // Handle Global Refresh Click
    this.btnRefresh.addEventListener("click", async () => {
      await this.handleGlobalRefresh();
    });
  }

  async handleGlobalRefresh() {
    // 1. UI Feedback: Start spinning
    this.btnRefresh.classList.add("spinning");
    this.btnRefresh.disabled = true;

    try {
      // 2. Run the sync logic
      const removedContests = await updateSolvedStatus();

      // 3. If we are currently looking at the queue, tell it to update
      const currentView = this.routerOutlet.firstElementChild;
      if (currentView && typeof currentView.refreshData === "function") {
        await currentView.refreshData(removedContests);
      }
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      // 4. UI Feedback: Stop spinning
      this.btnRefresh.classList.remove("spinning");
      this.btnRefresh.disabled = false;
    }
  }

  /**
   * Opens a secondary view, or returns to the queue if it's already showing.
   */
  toggleView(componentTagName) {
    const currentView =
      this.routerOutlet.firstElementChild?.tagName.toLowerCase();
    this.navigate(
      currentView === componentTagName ? "cf-queue-view" : componentTagName,
    );
  }

  navigate(componentTagName) {
    this.routerOutlet.innerHTML = "";
    const newView = document.createElement(componentTagName);
    this.routerOutlet.appendChild(newView);

    // Refresh syncs solved status and backfills tags, so it's useful on both
    // data views. Each secondary button turns into a close affordance while
    // its own view is open.
    this.btnRefresh.classList.toggle(
      "hidden",
      componentTagName === "cf-contest-list",
    );
    this.btnViewList.textContent =
      componentTagName === "cf-contest-list" ? "✕" : "☰";
    this.btnStats.innerHTML =
      componentTagName === "cf-stats-view" ? "✕" : STATS_ICON;
  }
}

customElements.define("cf-app", CFApp);
