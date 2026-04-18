import { Storage } from "../../services/storage.js";
import html from "./PreviewView.html?raw";

class PreviewView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = html;
  }

  connectedCallback() {
    this.shadowRoot.appendChild(this.template.content.cloneNode(true));
    this.renderProblems();

    this.shadowRoot
      .getElementById("confirm-add-btn")
      .addEventListener("click", async () => {
        await Storage.addToQueue(this.problems); // Persist to local storage [cite: 54, 62]
        this.navigate("QUEUE");
      });

    this.shadowRoot
      .getElementById("discard-btn")
      .addEventListener("click", () => {
        this.navigate("QUEUE");
      });
  }

  renderProblems() {
    const list = this.shadowRoot.getElementById("preview-list");
    list.innerHTML = this.problems
      .map(
        (p) => `
      <div class="problem-card">
        <div class="problem-title">${p.id}. ${p.name}</div>
        <div class="problem-rating">Rating: ${p.rating}</div>
      </div>
    `,
      )
      .join("");
  }
}
customElements.define("preview-view", PreviewView);
