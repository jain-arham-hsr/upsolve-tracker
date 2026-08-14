import templateHtml from "./stats-view.html?raw";
import { LocalDB } from "../../services/storage.js";
import { countPendingTags } from "../../tag-service.js";
import { escapeHtml } from "../escape-html.js";

const BUCKET_SIZE = 100;
const RANGE_KEY = "cf_trainer.tag_rating_range";

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
    this.rangeBox = this.querySelector("#tag-range");
    this.rangeMin = this.querySelector("#tag-range-min");
    this.rangeMax = this.querySelector("#tag-range-max");
    this.rangeCaption = this.querySelector("#tag-range-caption");

    // The view is rebuilt on every navigation, so the selection is persisted
    // the same way the contest list's type filter is.
    const stored = await chrome.storage.local.get({ [RANGE_KEY]: null });
    this.range = stored[RANGE_KEY];

    this.rangeMin.addEventListener("change", () => this.onRangeChange("min"));
    this.rangeMax.addEventListener("change", () => this.onRangeChange("max"));

    await this.render();
  }

  /**
   * Called by the shell after a global refresh, which is also what fills in
   * tags for contests still missing them.
   */
  async refreshData() {
    await this.render();
  }

  async render() {
    this.contests = await LocalDB.getTrackedContests();
    const { ratings, unrated } = collectRatings(this.contests);
    this.ratings = ratings;

    this.renderHint(this.contests);
    this.renderHistogram(ratings);
    this.syncRangeControls(ratings);
    this.renderTags();
    this.summary.textContent = buildSummary(ratings, unrated);
  }

  /**
   * Rebuilds the From/To options from the buckets the queue actually spans,
   * and clamps any stored selection into them — the queue changes shape as
   * contests are added and solved, so a saved range can fall out of bounds.
   */
  syncRangeControls(ratings) {
    if (ratings.length === 0) {
      this.bounds = null;
      this.rangeBox.classList.add("hidden");
      return;
    }

    const lowest = bucketOf(Math.min(...ratings));
    const highest = bucketOf(Math.max(...ratings));
    this.bounds = { lowest, highest };

    // A stored range that no longer overlaps the queue at all resets to the
    // full span; clamping it would silently pin the view to one end bucket.
    const stored = this.range;
    const overlaps = stored && stored.min <= highest && stored.max >= lowest;

    let min = overlaps ? clamp(stored.min, lowest, highest) : lowest;
    let max = overlaps ? clamp(stored.max, lowest, highest) : highest;
    if (min > max) [min, max] = [lowest, highest];
    this.range = { min, max };

    const options = [];
    for (let bucket = lowest; bucket <= highest; bucket += BUCKET_SIZE) {
      options.push(`<option value="${bucket}">${bucket}</option>`);
    }

    this.rangeMin.innerHTML = options.join("");
    this.rangeMax.innerHTML = options.join("");
    this.rangeMin.value = String(min);
    this.rangeMax.value = String(max);

    // A single bucket leaves nothing to choose between.
    this.rangeBox.classList.toggle("hidden", options.length < 2);
  }

  async onRangeChange(changed) {
    let min = Number(this.rangeMin.value);
    let max = Number(this.rangeMax.value);

    // Pushing one endpoint past the other drags it along, rather than
    // leaving an inverted range that silently matches nothing.
    if (min > max) {
      if (changed === "min") {
        max = min;
        this.rangeMax.value = String(max);
      } else {
        min = max;
        this.rangeMin.value = String(min);
      }
    }

    this.range = { min, max };
    await chrome.storage.local.set({ [RANGE_KEY]: this.range });
    this.renderTags();
  }

  renderHint(contests) {
    const untagged = contests.filter(
      (contest) =>
        contest.type === "OFFICIAL" &&
        !contest.tagsSyncedAt &&
        !contest.tagsSynced,
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
      const bucket = bucketOf(rating);
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

  renderTags() {
    // Only narrow the count when the selection is actually narrower than the
    // queue; at full span unrated problems still contribute their tags.
    const isFullSpan =
      !this.bounds ||
      (this.range.min === this.bounds.lowest &&
        this.range.max === this.bounds.highest);
    const range = isFullSpan ? null : this.range;

    const tagCounts = countPendingTags(this.contests, range);
    this.renderRangeCaption(range, tagCounts.length);

    if (tagCounts.length === 0) {
      this.tagList.innerHTML = `<div class="stats-empty">${
        range
          ? "No tagged problems in that rating range."
          : "No tags on the pending problems."
      }</div>`;
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

  renderRangeCaption(range, tagCount) {
    if (!this.bounds) {
      this.rangeCaption.textContent = "";
      return;
    }

    const matched = range
      ? this.ratings.filter(
          (rating) => rating >= range.min && rating <= range.max,
        ).length
      : this.ratings.length;

    const scope = range ? `rated ${range.min}–${range.max}` : "across all ratings";
    this.rangeCaption.textContent = `${tagCount} tag${tagCount === 1 ? "" : "s"} across ${matched} problem${matched === 1 ? "" : "s"} ${scope}`;
  }
}

function bucketOf(rating) {
  return Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
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
