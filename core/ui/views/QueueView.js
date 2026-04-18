import { Storage } from "../../services/storage.js";
import templateHtml from "./QueueView.html?raw";

class QueueView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.template = document.createElement("template");
    this.template.innerHTML = templateHtml;
  }

  async connectedCallback() {
    this.shadowRoot.appendChild(this.template.content.cloneNode(true));
    await this.renderQueue();
    this.updateContestButton();
  }

  updateContestButton() {
    const addBtn = this.shadowRoot.getElementById("add-contest-btn");
    const emptyMsg = this.shadowRoot.getElementById("empty-state-msg");
    const btnText = this.shadowRoot.getElementById("add-contest-text");

    // Use the data passed from the router
    if (this.activeContest) {
      addBtn.style.display = "flex";
      emptyMsg.style.display = "none";
      btnText.textContent = `Add ${this.activeContest.type === "gym" ? "Gym" : "Contest"} ${this.activeContest.id}`;

      addBtn.onclick = () => {
        this.navigate("FETCHING", {
          id: this.activeContest.id,
          type: this.activeContest.type,
        });
      };
    } else {
      addBtn.style.display = "none";
      emptyMsg.style.display = "block";
    }
  }

  async renderQueue() {
    const queue = await Storage.getQueue();
    const list = this.shadowRoot.getElementById("queue-list");
    if (queue.length === 0) {
      list.innerHTML = `<p class="empty-state">No problems in queue.</p>`;
      return;
    }
    list.innerHTML = queue
      .map(
        (p) => `
      <a href="${p.url}" target="_blank" class="problem-card">
        <div class="problem-title">${p.id}. ${p.name}</div>
        <div class="problem-rating">Rating: ${p.rating}</div>
      </a>
    `,
      )
      .join("");
  }
}
customElements.define("queue-view", QueueView);
