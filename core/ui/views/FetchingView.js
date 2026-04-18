import html from "./FetchingView.html?raw";

class FetchingView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = html;
  }

  connectedCallback() {
    this.shadowRoot.appendChild(this.template.content.cloneNode(true));
    const textEl = this.shadowRoot.getElementById("fetch-progress-text");

    // 1. Tell background to start the real fetch [cite: 71]
    chrome.runtime.sendMessage({
      action: "START_FETCH",
      contestId: this.data.id,
      contestType: this.data.type,
    });

    // 2. Listen for the 'fetch-progress' CustomEvent dispatched from index.js
    this.progressHandler = (e) => {
      if (textEl) textEl.textContent = e.detail;
    };
    document.addEventListener("fetch-progress", this.progressHandler);
  }

  disconnectedCallback() {
    // Clean up to prevent memory leaks
    document.removeEventListener("fetch-progress", this.progressHandler);
  }
}

customElements.define("fetching-view", FetchingView);
