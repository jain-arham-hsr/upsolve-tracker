import "./views/queue-view.js";
import "./views/contest-list.js";

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
    this.btnRefresh = this.querySelector("#btn-refresh"); // Grab the refresh button

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
  }

  navigate(componentTagName) {
    this.routerOutlet.innerHTML = "";
    const newView = document.createElement(componentTagName);
    this.routerOutlet.appendChild(newView);

    // Contextually toggle icons and buttons
    if (componentTagName === "cf-queue-view") {
      this.btnRefresh.classList.remove("hidden");
      this.btnViewList.textContent = "☰"; // Menu icon
    } else {
      this.btnRefresh.classList.add("hidden");
      this.btnViewList.textContent = "✕"; // Close icon
    }
  }
}

customElements.define("cf-app", CFApp);
