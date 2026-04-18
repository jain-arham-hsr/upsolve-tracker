/**
 * Main Router & UI Controller
 * Manages view transitions and global browser events.
 */

import "./views/QueueView.js";
import "./views/FetchingView.js";
import "./views/PreviewView.js";

const appRoot = document.getElementById("app-root");
let currentViewName = null;

/**
 * Detects if the current active tab is a Codeforces contest or gym.
 * @returns {Promise<{type: string, id: string}|null>}
 */
async function getActiveContest() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return null;

    // Regex to match: https://codeforces.com/contest/123 or /gym/456
    const regex = /^https?:\/\/(www\.)?codeforces\.com\/(contest|gym)\/(\d+)/;
    const match = tab.url.match(regex);

    return match ? { type: match[2], id: match[3] } : null;
  } catch (e) {
    console.error("Tab query failed:", e);
    return null;
  }
}

/**
 * Navigates to a specific view by injecting the corresponding Web Component.
 * @param {string} viewName - 'QUEUE', 'FETCHING', or 'PREVIEW'
 * @param {Object} data - Contextual data (contest info or problem lists)
 */
export async function navigate(viewName, data = {}) {
  currentViewName = viewName;
  appRoot.innerHTML = ""; // Clear the current DOM

  let component;

  switch (viewName) {
    case "QUEUE":
      component = document.createElement("queue-view");
      // Pass the detected contest info so the "Add" button shows up correctly
      component.activeContest = await getActiveContest();
      break;

    case "FETCHING":
      component = document.createElement("fetching-view");
      // Pass the contest ID/Type to the fetcher component
      component.data = data;
      break;

    case "PREVIEW":
      component = document.createElement("preview-view");
      // Pass the list of problems retrieved from the background service worker
      component.problems = data.problems;
      break;

    default:
      console.error(`Unknown view: ${viewName}`);
      return;
  }

  // Attach the global navigation function so components can trigger view changes
  component.navigate = navigate;
  appRoot.appendChild(component);
}

/**
 * GLOBAL MESSAGE LISTENER
 * Listens for updates from the background.js service worker.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "FETCH_PROGRESS") {
    /**
     * Because Shadow DOM encapsulates internal elements, we dispatch a
     * CustomEvent on the document. The FetchingView component listens
     * for this to update its progress text.
     */
    document.dispatchEvent(
      new CustomEvent("fetch-progress", {
        detail: message.text,
      }),
    );
  } else if (message.action === "FETCH_COMPLETE") {
    // Transition from the loading state to the results preview
    navigate("PREVIEW", { problems: message.problems });
  }
});

/**
 * TAB SYNCHRONIZATION
 * Refreshes the QueueView whenever the user changes tabs or URLs.
 * This ensures the "Add Contest" button appears/disappears accurately.
 */
chrome.tabs.onActivated.addListener(() => {
  if (currentViewName === "QUEUE") navigate("QUEUE");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only re-navigate when the page has finished loading
  if (
    tab.active &&
    changeInfo.status === "complete" &&
    currentViewName === "QUEUE"
  ) {
    navigate("QUEUE");
  }
});

// INITIALIZE: Boot the app into the main Queue View
navigate("QUEUE");
