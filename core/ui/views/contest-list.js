import templateHtml from "./contest-list.html?raw";
// Import our new manager
import { processNewContest } from "../../contest-manager.js";

export class ContestList extends HTMLElement {
  constructor() {
    super();
    this.boundCheckActiveTab = this.checkActiveTab.bind(this);
    this.boundTabUpdatedHandler = (tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === "complete") {
        this.checkActiveTab();
      }
    };

    // Track the active URL so we can pass it to the manager on click
    this.currentValidUrl = null;
  }

  connectedCallback() {
    this.innerHTML = templateHtml;

    this.btnAddContest = this.querySelector("#btn-add-contest");
    this.btnAddContest.disabled = true;
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    // Add click listener for the Add Contest button
    this.btnAddContest.addEventListener("click", async () => {
      if (this.currentValidUrl) {
        // Optional: Provide visual feedback that it's loading
        const originalText = this.btnAddContest.textContent;
        this.btnAddContest.textContent = "Fetching...";
        this.btnAddContest.disabled = true;

        try {
          // Send the URL to our new manager file!
          await processNewContest(this.currentValidUrl);
        } catch (error) {
          console.error("Error adding contest:", error);
          // Here we would normally show an error toast to the user
        } finally {
          // Reset button state
          this.btnAddContest.textContent = originalText;
          this.btnAddContest.disabled = false;
        }
      }
    });

    this.checkActiveTab();
    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdatedHandler);
  }

  disconnectedCallback() {
    chrome.tabs.onActivated.removeListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.removeListener(this.boundTabUpdatedHandler);
  }

  async checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      if (tab && tab.url) {
        const cfRegex =
          /^https?:\/\/(www\.)?codeforces\.com\/(contest|gym)\/\d+/i;

        if (cfRegex.test(tab.url)) {
          this.currentValidUrl = tab.url; // Save the URL!
          this.btnAddContest.disabled = false;
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Add this contest to the queue",
          );
        } else {
          this.currentValidUrl = null; // Clear it out
          this.btnAddContest.disabled = true;
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Must be on a CF contest or gym page.",
          );
        }
      } else {
        this.currentValidUrl = null;
        this.btnAddContest.disabled = true;
        this.btnAddContest.setAttribute(
          "data-tooltip",
          "Navigate to a CF page first.",
        );
      }
    } catch (error) {
      console.error("Failed to query active tab:", error);
      this.currentValidUrl = null;
      this.btnAddContest.disabled = true;
      this.btnAddContest.setAttribute(
        "data-tooltip",
        "Error checking tab context.",
      );
    }
  }
}

customElements.define("cf-contest-list", ContestList);
