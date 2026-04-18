import templateHtml from "./queue-view.html?raw";

export class QueueView extends HTMLElement {
  connectedCallback() {
    this.innerHTML = templateHtml;
  }
}

customElements.define("cf-queue-view", QueueView);
