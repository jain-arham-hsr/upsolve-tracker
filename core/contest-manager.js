import { HttpClient } from "./services/http-client.js";
import { estimateProblemRating } from "./rating-estimator.js";

export async function processNewContest(url) {
  try {
    const match = url.match(/(contest|gym)\/(\d+)/i);
    if (!match) throw new Error("Invalid Codeforces URL");

    const type = match[1].toLowerCase();
    const contestId = match[2];

    // 1. Fetch standings with official participants only
    const fetchUrl = `https://codeforces.com/${type}/${contestId}/standings?showUnofficial=false`;

    console.log(
      `[Contest Manager] Scraping official standings for ${type.toUpperCase()} ${contestId}...`,
    );

    const rawHtml = await HttpClient.get(fetchUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    const standingsTable = doc.querySelector("table.standings");
    if (!standingsTable) {
      throw new Error("Could not find the standings table.");
    }

    const problems = [];

    // 2. Parse Header to get Problem metadata
    const headerRow = standingsTable.querySelector("tr");
    const problemLinks = headerRow.querySelectorAll('a[href*="/problem/"]');

    problemLinks.forEach((a) => {
      const problemIndex = a.textContent.trim();
      const problemUrl = `https://codeforces.com${a.getAttribute("href")}`;

      let name = a.getAttribute("title") || "Unknown Problem";
      if (name.includes(" - ")) {
        name = name.split(" - ").slice(1).join(" - ");
      }

      problems.push({
        index: problemIndex,
        name: name,
        url: problemUrl,
        rating: null,
        officialSolves: 0,
      });
    });

    // 3. Find the Totals Row
    const allRows = Array.from(standingsTable.querySelectorAll("tr"));
    const totalsRow = allRows.find((row) => row.innerText.includes("Accepted"));

    if (totalsRow) {
      const allCells = Array.from(totalsRow.querySelectorAll("td"));
      const solveCells = allCells.slice(-problems.length);

      problems.forEach((problem, i) => {
        const cell = solveCells[i];
        if (cell) {
          /**
           * SURGICAL EXTRACTION (Your working version):
           * Instead of taking the whole text, we find the first child that is a TEXT node.
           */
          const firstTextNode = Array.from(cell.childNodes).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== "",
          );

          let acceptedText = "";
          if (firstTextNode) {
            acceptedText = firstTextNode.nodeValue.trim();
          } else {
            // Fallback: If CF wrapped the number in a span, grab the first element's text
            acceptedText = cell.firstElementChild
              ? cell.firstElementChild.innerText
              : cell.innerText;
            // Split by newline or space just in case
            acceptedText = acceptedText.split(/[\n\s]/)[0];
          }

          // Clean up only the first number found
          const cleanCount = acceptedText.replace(/\D/g, "");
          problem.officialSolves = parseInt(cleanCount, 10) || 0;
        }
      });
    }

    // 4. Fetch Participant Ratings
    let participantRatings = [];
    if (type === "contest") {
      // Use the official API for rated contests
      participantRatings = await fetchParticipantRatings(contestId);
    } else if (type === "gym") {
      // Crawl gym registrant pages to build the rating pool
      participantRatings = await fetchGymRegistrantRatings(contestId);
    }

    // 5. Estimate Difficulty
    if (participantRatings.length > 0) {
      console.log(
        `[Contest Manager] Running rating estimation using ${participantRatings.length} users...`,
      );
      problems.forEach((problem) => {
        if (problem.rating === null) {
          // Find the 50% success threshold
          problem.rating = estimateProblemRating(
            participantRatings,
            problem.officialSolves,
          );
        }
      });
    }

    console.log(`[Contest Manager] Final Results:`);
    console.table(problems);

    return { contestId, type, problems };
  } catch (error) {
    console.error("[Contest Manager] Failed:", error);
    throw error;
  }
}

/**
 * Crawls through the gymRegistrants pages to build the participant rating pool.
 */
async function fetchGymRegistrantRatings(gymId) {
  const ratings = [];
  let page = 1;

  console.log(`[Contest Manager] Starting Gym Registrant crawl...`);

  while (true) {
    const url = `https://codeforces.com/gymRegistrants/${gymId}/page/${page}`;
    const rawHtml = await HttpClient.get(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    const table = doc.querySelector(".datatable table");
    if (!table) break;

    const rows = table.querySelectorAll("tr:not(.first-row)");
    if (rows.length === 0) break;

    rows.forEach((row) => {
      // Ratings are consistently in the 3rd column of the registrant table
      const ratingCell = row.querySelector("td:nth-child(3)");
      if (ratingCell) {
        const r = parseInt(ratingCell.textContent.trim(), 10);
        if (!isNaN(r) && r > 0) {
          ratings.push(r);
        }
      }
    });

    // Check for the "→" (Next) link in the pagination block to continue flipping
    const nextLink = Array.from(doc.querySelectorAll(".pagination a")).find(
      (a) => a.innerText.includes("→"),
    );

    if (!nextLink) break;
    page++;
  }

  return ratings;
}

async function fetchParticipantRatings(contestId) {
  try {
    const apiUrl = `https://codeforces.com/api/contest.ratingChanges?contestId=${contestId}`;
    const rawText = await HttpClient.get(apiUrl);
    const response = JSON.parse(rawText);
    if (response && response.status === "OK") {
      // Maps the pre-contest rating for all official entrants
      return response.result.map((user) => user.oldRating);
    }
    return [];
  } catch (error) {
    console.warn(`[Contest Manager] Rating fetch failed:`, error.message);
    return [];
  }
}
