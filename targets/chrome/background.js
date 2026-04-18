// import { Fetcher } from "../../core/services/fetcher.js";

// Open side panel on icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_FETCH") {
    runDebugFetch(message.contestId, message.contestType);
  }
});

// async function runDebugFetch(contestId, contestType) {
//   try {
//     const standings = await Fetcher.fetchStandings(
//       contestId,
//       contestType,
//       (text) => {
//         chrome.runtime.sendMessage({ action: "FETCH_PROGRESS", text });
//       },
//     );

//     // --- THIS IS THE LOG YOU ARE LOOKING FOR ---
//     console.log(`--- DEBUG: FETCHED ${standings.length} PARTICIPANTS ---`);
//     console.table(standings.slice(0, 20)); // Shows the first 20 people in a nice table
//     console.log("Full Data Object:", standings);
//     // -------------------------------------------

//     chrome.runtime.sendMessage({
//       action: "FETCH_COMPLETE",
//       problems: [
//         { id: "A", name: "Check Standings Log", rating: 1200, url: "#" },
//       ],
//     });
//   } catch (error) {
//     chrome.runtime.sendMessage({
//       action: "FETCH_PROGRESS",
//       text: `Error: ${error.message}`,
//     });
//   }
// }
