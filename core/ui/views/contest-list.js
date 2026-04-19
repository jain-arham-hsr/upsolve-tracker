import templateHtml from "./contest-list.html?raw";
import { processNewContest } from "../../contest-manager.js";
import { LocalDB } from "../../services/storage.js";

export class ContestList extends HTMLElement {
  constructor() {
    super();
    this.boundCheckActiveTab = this.checkActiveTab.bind(this);
    this.boundTabUpdatedHandler = (tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === "complete") {
        this.checkActiveTab();
      }
    };
    this.currentValidUrl = null;
  }

  async connectedCallback() {
    this.innerHTML = templateHtml;

    // UI References
    this.btnAddContest = this.querySelector("#btn-add-contest");
    this.container = this.querySelector("#contest-items");
    this.btnExport = this.querySelector("#btn-export");
    this.btnImport = this.querySelector("#btn-import");
    this.fileInput = this.querySelector("#import-file-input");

    // Initial State - DO NOT TOUCH TOOLTIP LOGIC
    this.btnAddContest.disabled = true;
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    // 1. Initial Render
    await this.renderQueue();

    // 2. Add Contest Click - UNTOUCHED ORIGINAL LOGIC
    this.btnAddContest.addEventListener("click", async () => {
      if (this.currentValidUrl) {
        this.btnAddContest.textContent = "Fetching...";
        this.btnAddContest.disabled = true;

        try {
          await processNewContest(this.currentValidUrl);
          await this.renderQueue();

          // Set the final state after adding
          this.btnAddContest.textContent = "✓ Added";
          this.btnAddContest.disabled = true;
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Contest added successfully!",
          );
        } catch (error) {
          console.error("Error adding contest:", error);
          this.btnAddContest.textContent = "+ Add Contest";
          this.btnAddContest.disabled = false;
        }
      }
    });

    // 3. Management Actions
    this.btnExport.addEventListener("click", async () => {
      const allData = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(allData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download(
        {
          url: url,
          filename: "cf_trainer_backup.json",
          saveAs: true,
        },
        () => URL.revokeObjectURL(url),
      );
    });

    this.btnImport.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);
          await chrome.storage.local.set(data);
          await this.renderQueue();
        } catch (err) {
          console.error("Import failed:", err);
        }
      };
      reader.readAsText(file);
    });

    // --- NO MANUAL CLICK LISTENER HERE ---
    // Letting the <a> tags in renderQueue handle navigation natively.

    this.checkActiveTab();
    chrome.tabs.onActivated.addListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.addListener(this.boundTabUpdatedHandler);
  }

  // --- RENDERING ENGINE ---
  async renderQueue() {
    const contests = await LocalDB.getTrackedContests();

    if (contests.length === 0) {
      this.container.innerHTML = `<div class="muted">No contests in queue.</div>`;
      return;
    }

    this.container.innerHTML = contests
      .map((contest) => {
        // 1. Robust Type Check (CF API can return 'OFFICIAL', 'CONTEST', or 'CF')
        const typeStr = (contest.type || "").toUpperCase();
        const isOfficial =
          typeStr === "OFFICIAL" || typeStr === "CONTEST" || typeStr === "CF";

        // 2. Map to CF URL patterns
        const path = isOfficial ? "contest" : "gym";
        const label = isOfficial ? "Official" : "Gym";
        const typeClass = isOfficial ? "type-official" : "type-gym";

        // 3. Construct URL
        const url = `https://codeforces.com/${path}/${contest.id}`;

        return `
        <a href="${url}" target="_blank" class="contest-row">
          <span class="contest-id">Contest ${contest.id}</span>
          <span class="contest-type ${typeClass}">${label}</span>
        </a>
      `;
      })
      .join("");
  }

  disconnectedCallback() {
    chrome.tabs.onActivated.removeListener(this.boundCheckActiveTab);
    chrome.tabs.onUpdated.removeListener(this.boundTabUpdatedHandler);
  }

  async checkActiveTab() {
    // 1. ALWAYS start by resetting the button to the default "Non-Contest" state
    this.currentValidUrl = null;
    this.btnAddContest.disabled = true;
    this.btnAddContest.textContent = "+ Add Contest";
    this.btnAddContest.setAttribute("data-tooltip", "Checking current page...");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      if (tab && tab.url) {
        const cfRegex =
          /^https?:\/\/(www\.)?codeforces\.com\/(contest|gym)\/(\d+)/i;
        const match = tab.url.match(cfRegex);

        if (match) {
          // 2. We ARE on a contest page - Now check if we already have it
          const contestId = match[3];
          this.currentValidUrl = tab.url;

          const contests = await LocalDB.getTrackedContests();
          const isAlreadyTracked = contests.some(
            (c) => c.id.toString() === contestId,
          );

          if (isAlreadyTracked) {
            this.btnAddContest.disabled = true;
            this.btnAddContest.textContent = "✓ Added";
            this.btnAddContest.setAttribute(
              "data-tooltip",
              "Contest is already in your queue.",
            );
          } else {
            // Valid contest and NOT tracked yet
            this.btnAddContest.disabled = false;
            this.btnAddContest.setAttribute(
              "data-tooltip",
              "Add this contest to the queue",
            );
          }
        } else {
          // Valid URL, but NOT a contest/gym page
          this.btnAddContest.setAttribute(
            "data-tooltip",
            "Must be on a CF contest or gym page.",
          );
        }
      } else {
        // No tab or URL (e.g., settings page or restricted browser page)
        this.btnAddContest.setAttribute(
          "data-tooltip",
          "Navigate to a CF page first.",
        );
      }
    } catch (error) {
      console.error("Tab check failed:", error);
      this.btnAddContest.setAttribute(
        "data-tooltip",
        "Error checking tab context.",
      );
    }
  }
}

customElements.define("cf-contest-list", ContestList);
