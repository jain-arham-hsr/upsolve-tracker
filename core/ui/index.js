import "./views/queue-view.js";
import "./views/contest-list.js";
import { updateSolvedStatus } from "../progress-manager.js"; // Import the logic

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
    this.btnRefresh = this.querySelector("#btn-refresh");

    this.setupListeners();
    this.navigate("cf-queue-view");
  }

  setupListeners() {
    this.btnViewList.addEventListener("click", () => {
      const currentView =
        this.routerOutlet.firstElementChild?.tagName.toLowerCase();
      if (currentView === "cf-contest-list") {
        this.navigate("cf-queue-view");
      } else {
        this.navigate("cf-contest-list");
      }
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

  navigate(componentTagName) {
    this.routerOutlet.innerHTML = "";
    const newView = document.createElement(componentTagName);
    this.routerOutlet.appendChild(newView);

    if (componentTagName === "cf-queue-view") {
      this.btnRefresh.classList.remove("hidden");
      this.btnViewList.textContent = "☰";
    } else {
      this.btnRefresh.classList.add("hidden");
      this.btnViewList.textContent = "✕";
    }
  }
}

customElements.define("cf-app", CFApp);
