import templateHtml from "./stats-view.html?raw";
import { LocalDB } from "../../services/storage.js";
import { countPendingTags } from "../../tag-service.js";
import { escapeHtml } from "../escape-html.js";

const BUCKET_SIZE = 100;

/**
 * Codeforces rank bands, so a bar's colour carries the same meaning it does
 * on the site itself. Tints are lightened for legibility on the dark panel.
 */
const RANK_BANDS = [
  { min: 2400, class: "band-red" },
  { min: 2100, class: "band-orange" },
  { min: 1900, class: "band-violet" },
  { min: 1600, class: "band-blue" },
  { min: 1400, class: "band-cyan" },
  { min: 1200, class: "band-green" },
  { min: 0, class: "band-gray" },
];

function bandClass(rating) {
  return RANK_BANDS.find((band) => rating >= band.min).class;
}

export class StatsView extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = templateHtml;
    this.histogram = this.querySelector("#stats-histogram");
    this.tagList = this.querySelector("#stats-tags");
    this.summary = this.querySelector("#stats-summary");
    this.hint = this.querySelector("#stats-hint");

    await this.render();
  }

  /**
   * Called by the shell after a global refresh, which is also what backfills
   * tags for contests queued before they were captured.
   */
  async refreshData() {
    await this.render();
  }

  async render() {
    const contests = await LocalDB.getTrackedContests();
    const { ratings, unrated } = collectRatings(contests);

    this.renderHint(contests);
    this.renderHistogram(ratings);
    this.renderTags(countPendingTags(contests));
    this.summary.textContent = buildSummary(ratings, unrated);
  }

  renderHint(contests) {
    const untagged = contests.filter(
      (contest) => contest.type === "OFFICIAL" && !contest.tagsSynced,
    ).length;

    if (untagged === 0) {
      this.hint.classList.add("hidden");
      return;
    }

    this.hint.textContent = `${untagged} contest${untagged === 1 ? "" : "s"} queued before tags were tracked. Hit ↻ to fetch them.`;
    this.hint.classList.remove("hidden");
  }

  renderHistogram(ratings) {
    if (ratings.length === 0) {
      this.histogram.innerHTML = `<div class="stats-empty">No rated problems pending.</div>`;
      return;
    }

    const counts = new Map();
    ratings.forEach((rating) => {
      const bucket = Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    });

    // Walk every bucket in range, not just the occupied ones, so gaps in the
    // queue stay visible as gaps.
    const lowest = Math.min(...counts.keys());
    const highest = Math.max(...counts.keys());
    const tallest = Math.max(...counts.values());

    const rows = [];
    for (let bucket = lowest; bucket <= highest; bucket += BUCKET_SIZE) {
      const count = counts.get(bucket) ?? 0;
      const width = (count / tallest) * 100;

      rows.push(`
        <div class="hist-row">
          <span class="hist-label">${bucket}</span>
          <div class="hist-track">
            ${count > 0 ? `<div class="hist-bar ${bandClass(bucket)}" style="width: ${width}%"></div>` : ""}
          </div>
          <span class="hist-count ${count > 0 ? "" : "is-zero"}">${count}</span>
        </div>`);
    }

    this.histogram.innerHTML = rows.join("");
  }

  renderTags(tagCounts) {
    if (tagCounts.length === 0) {
      this.tagList.innerHTML = `<div class="stats-empty">No tags on the pending problems.</div>`;
      return;
    }

    const tallest = tagCounts[0].count;

    this.tagList.innerHTML = tagCounts
      .map(
        ({ tag, count }) => `
        <div class="tag-row">
          <div class="tag-head">
            <span class="tag-name">${escapeHtml(tag)}</span>
            <span class="tag-count">${count}</span>
          </div>
          <div class="tag-track">
            <div class="tag-bar" style="width: ${(count / tallest) * 100}%"></div>
          </div>
        </div>`,
      )
      .join("");
  }
}

/**
 * Ratings of every pending problem across tracked contests. Mirrors the queue
 * view: solved problems are excluded.
 */
function collectRatings(contests) {
  const ratings = [];
  let unrated = 0;

  contests.forEach((contest) => {
    contest.problems.forEach((prob) => {
      if (prob.solved) return;
      if (typeof prob.rating === "number") {
        ratings.push(prob.rating);
      } else {
        unrated++;
      }
    });
  });

  return { ratings, unrated };
}

function buildSummary(ratings, unrated) {
  if (ratings.length === 0) return "";

  const sorted = [...ratings].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

  const parts = [`${ratings.length} pending`, `median ${median}`];
  if (unrated > 0) parts.push(`${unrated} unrated`);
  return parts.join(" · ");
}

customElements.define("cf-stats-view", StatsView);
