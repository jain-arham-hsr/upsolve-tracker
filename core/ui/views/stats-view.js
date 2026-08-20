import templateHtml from "./stats-view.html?raw";
import { LocalDB } from "../../services/storage.js";
import { countPendingTags } from "../../tag-service.js";
import { escapeHtml } from "../escape-html.js";
import { listPlatforms, platformOf, getPlatform } from "../../platforms/registry.js";
import { getEffectiveRatings } from "../../services/user-ratings.js";
import { solveProbability } from "../../queue-order.js";
import { renderPlatformRing } from "../platform-ring.js";
import { platformIcon } from "../platform-icons.js";
import { collectPendingProblems } from "../../pending-problems.js";

const BUCKET_SIZE = 100;
const SCOPE_KEY = "cf_trainer.stats_scope";

/** Per-platform: a 1600–1900 span means nothing on AtCoder, where a third of
 *  rated problems sit below 800. */
const rangeKeyFor = (scope) => `cf_trainer.tag_rating_range.${scope || "all"}`;

/**
 * Overview bins by solve probability rather than rating, because rating buckets
 * are not comparable across platforms — the one claim this whole design avoids
 * making.
 *
 * A **sequential** ramp, one hue light-to-dark: this is ordered magnitude, with
 * no meaningful midpoint to diverge around. The rank colours were used here
 * first, which put most of a normal queue in a red band and made the chart read
 * as a verdict on the reader rather than as a count of hard problems.
 */
const CHANCE_BANDS = [
  { min: 0.9, label: "90%+", class: "chance-1" },
  { min: 0.75, label: "75–90%", class: "chance-2" },
  { min: 0.5, label: "50–75%", class: "chance-3" },
  { min: 0.25, label: "25–50%", class: "chance-4" },
  { min: 0.1, label: "10–25%", class: "chance-5" },
  { min: 0, label: "<10%", class: "chance-6" },
];

export class StatsView extends HTMLElement {
  async connectedCallback() {
    this.innerHTML = templateHtml;
    this.histogram = this.querySelector("#stats-histogram");
    this.tagList = this.querySelector("#stats-tags");
    this.summary = this.querySelector("#stats-summary");
    this.hint = this.querySelector("#stats-hint");
    this.coverage = this.querySelector("#tag-coverage");
    this.ring = this.querySelector("#stats-ring");
    this.ringSection = this.querySelector("#ring-section");
    this.tagsSection = this.querySelector("#tags-section");
    this.scopeChips = this.querySelector("#stats-scope-chips");
    this.spreadTitle = this.querySelector("#spread-title");
    this.rangeBox = this.querySelector("#tag-range");
    this.rangeMin = this.querySelector("#tag-range-min");
    this.rangeMax = this.querySelector("#tag-range-max");
    this.rangeCaption = this.querySelector("#tag-range-caption");

    // The view is rebuilt on every navigation, so both selections are
    // persisted rather than kept on the instance.
    const stored = await chrome.storage.local.get({ [SCOPE_KEY]: "" });
    this.scope = stored[SCOPE_KEY];

    this.renderScopeChips();
    this.scopeChips.addEventListener("click", async (event) => {
      const chip = event.target.closest("[data-scope]");
      if (!chip) return;

      this.scope = chip.dataset.scope;
      await chrome.storage.local.set({ [SCOPE_KEY]: this.scope });
      this.renderScopeChips();
      await this.render();
    });

    this.rangeMin.addEventListener("change", () => this.onRangeChange("min"));
    this.rangeMax.addEventListener("change", () => this.onRangeChange("max"));

    await this.render();
  }

  /** Called by the shell after a global refresh. */
  async refreshData() {
    await this.render();
  }

  /**
   * One chip per platform that actually has contests queued, plus Overview.
   * A single-platform user sees no chips at all rather than three inert ones.
   */
  renderScopeChips() {
    const present = this.presentPlatforms ?? [];
    if (present.length < 2) {
      this.scopeChips.innerHTML = "";
      return;
    }

    // Icons and full names, matching every other row in the panel. The label
    // is escaped but the mark is static markup, so they interpolate separately.
    const chip = (scope, label, mark = "") =>
      `<button type="button" class="filter-chip${
        this.scope === scope ? " is-on" : ""
      }" data-scope="${escapeHtml(scope)}">${mark}${escapeHtml(label)}</button>`;

    this.scopeChips.innerHTML =
      chip("", "Overview") +
      present
        .map((platform) =>
          chip(platform.id, platform.label, platformIcon(platform.id, platform.shortLabel)),
        )
        .join("");
  }

  async render() {
    const [allContests, userRatings] = await Promise.all([
      LocalDB.getTrackedContests(),
      getEffectiveRatings(),
    ]);
    this.userRatings = userRatings;

    const platformIds = new Set(allContests.map((c) => platformOf(c).id));
    this.presentPlatforms = listPlatforms().filter((p) => platformIds.has(p.id));

    // A scope whose contests have all been solved away falls back to Overview
    // rather than showing an empty panel with no explanation.
    if (this.scope && !platformIds.has(this.scope)) this.scope = "";
    this.renderScopeChips();

    this.contests = this.scope
      ? allContests.filter((contest) => platformOf(contest).id === this.scope)
      : allContests;

    const stored = await chrome.storage.local.get({ [rangeKeyFor(this.scope)]: null });
    this.range = stored[rangeKeyFor(this.scope)];

    this.pending = collectPendingProblems(this.contests);
    const { ratings, unrated } = collectRatings(this.pending);
    this.ratings = ratings;

    this.renderHint();

    // Tag vocabularies do not match between platforms — Codeforces says
    // "dfs and similar" where CodeChef says "graphs", and AtCoder publishes
    // none at all — so pooling them produces an authoritative-looking chart
    // built from incompatible lists. Tags live in the per-platform panels only.
    const scoped = Boolean(this.scope);
    this.tagsSection.classList.toggle("hidden", !scoped);
    this.ringSection.classList.toggle("hidden", scoped);

    if (scoped) {
      this.spreadTitle.textContent = "RATING SPREAD";
      this.renderHistogram(ratings, getPlatform(this.scope));
      this.renderCoverage(allContests);
      this.syncRangeControls(ratings);
      this.renderTags();
    } else {
      this.ring.innerHTML = renderPlatformRing(
        this.presentPlatforms.map((platform) => ({
          platform,
          count: this.pending.filter((entry) => entry.platform.id === platform.id).length,
        })),
      );
      this.spreadTitle.textContent = "SOLVE CHANCE";
      this.renderChanceHistogram();
    }
    this.summary.textContent = this.buildSummary(ratings, unrated);
  }

  /**
   * States plainly how much of the queue the tag chart can even see.
   *
   * Without this an empty "graphs" bar reads as "I have no graph problems"
   * when the truth is that half the queue is untagged — AtCoder publishes no
   * tags at all, and Codeforces gyms sit outside its taxonomy.
   */
  renderCoverage(allContests) {
    const scoped = collectPendingProblems(this.scope ? this.contests : allContests);
    const totals = new Map();

    scoped.forEach(({ platform, problem }) => {
      const entry = totals.get(platform.id) ?? { tagged: 0, total: 0 };
      entry.total++;
      if (problem.tags?.length) entry.tagged++;
      totals.set(platform.id, entry);
    });

    const total = [...totals.values()].reduce((sum, e) => sum + e.total, 0);
    const tagged = [...totals.values()].reduce((sum, e) => sum + e.tagged, 0);

    if (total === 0) {
      this.coverage.textContent = "";
      return;
    }

    const overall = Math.round((tagged / total) * 100);
    const breakdown = [...totals.entries()]
      .map(([id, e]) => `${getPlatform(id).shortLabel} ${Math.round((e.tagged / e.total) * 100)}%`)
      .join(", ");

    this.coverage.textContent =
      totals.size > 1
        ? `Tags cover ${overall}% of these problems — ${breakdown}`
        : `Tags cover ${overall}% of these problems`;
  }

  renderHint() {
    const untagged = this.contests.filter(
      (contest) =>
        platformOf(contest).id === "codeforces" &&
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

  /** Overview: unitless, so every platform belongs on the same axis. */
  renderChanceHistogram() {
    const counts = new Map(CHANCE_BANDS.map((band) => [band.label, 0]));
    let unknown = 0;

    this.pending.forEach(({ platform, problem }) => {
      const chance = solveProbability(
        problem.rating,
        this.userRatings[platform.id] ?? null,
      );
      if (chance === null) {
        unknown++;
        return;
      }
      const band = CHANCE_BANDS.find((entry) => chance >= entry.min);
      counts.set(band.label, counts.get(band.label) + 1);
    });

    const tallest = Math.max(...counts.values(), 1);
    const rows = CHANCE_BANDS.map((band) => {
      const count = counts.get(band.label);
      return `
        <div class="hist-row">
          <span class="hist-label wide">${band.label}</span>
          <div class="hist-track">
            ${count > 0 ? `<div class="hist-bar ${band.class}" style="width: ${(count / tallest) * 100}%"></div>` : ""}
          </div>
          <span class="hist-count ${count > 0 ? "" : "is-zero"}">${count}</span>
        </div>`;
    });

    if (unknown > 0) {
      rows.push(
        `<div class="stats-empty">${unknown} problem${unknown === 1 ? "" : "s"} can't be placed — no published difficulty, or no rating of yours on that site.</div>`,
      );
    }

    this.histogram.innerHTML = rows.join("");
  }

  renderHistogram(ratings, platform) {
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
            ${count > 0 ? `<div class="hist-bar ${platform.ratingBandClass(bucket)}" style="width: ${width}%"></div>` : ""}
          </div>
          <span class="hist-count ${count > 0 ? "" : "is-zero"}">${count}</span>
        </div>`);
    }

    this.histogram.innerHTML = rows.join("");
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

    // A single bucket leaves nothing to choose between. Mixed platforms have
    // no shared rating axis, so the range only applies to one platform.
    this.rangeBox.classList.toggle("hidden", options.length < 2 || !this.scope);
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
    await chrome.storage.local.set({ [rangeKeyFor(this.scope)]: this.range });
    this.renderTags();
  }

  renderTags() {
    // Only narrow the count when the selection is actually narrower than the
    // queue; at full span unrated problems still contribute their tags.
    const isFullSpan =
      !this.bounds ||
      !this.scope ||
      (this.range.min === this.bounds.lowest &&
        this.range.max === this.bounds.highest);
    const range = isFullSpan ? null : this.range;

    const tagCounts = countPendingTags(this.contests, range);
    this.renderRangeCaption(range, tagCounts.length);

    if (tagCounts.length === 0) {
      this.tagList.innerHTML = `<div class="stats-empty">${this.noTagsMessage(range)}</div>`;
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

  /**
   * AtCoder has no tags at all — not "none yet", none published, ever. Saying
   * so beats an empty chart that looks like a loading failure.
   */
  noTagsMessage(range) {
    if (this.scope === "atcoder") {
      return "AtCoder doesn't publish problem tags, so there's nothing to chart here.";
    }
    return range
      ? "No tagged problems in that rating range."
      : "No tags on the pending problems.";
  }

  renderRangeCaption(range, tagCount) {
    if (!this.bounds || !this.scope) {
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

  buildSummary(ratings, unrated) {
    const pending = ratings.length + unrated;
    if (pending === 0) return "";

    const parts = [`${pending} pending`];

    // A median only means something inside one platform. Across three it would
    // be a median of numbers that do not share a scale.
    if (this.scope && ratings.length > 0) parts.push(`median ${median(ratings)}`);

    // No per-platform breakdown here on the overview — the ring's legend
    // carries it, with icons and full names instead of abbreviations.
    if (unrated > 0) parts.push(`${unrated} unrated`);

    return parts.join(" · ");
  }
}

function bucketOf(rating) {
  return Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function median(ratings) {
  const sorted = [...ratings].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Ratings of every pending problem across tracked contests. Mirrors the queue
 * view: solved problems are excluded.
 */
function collectRatings(pending) {
  const ratings = [];
  let unrated = 0;

  pending.forEach(({ problem }) => {
    if (typeof problem.rating === "number") {
      ratings.push(problem.rating);
    } else {
      unrated++;
    }
  });

  return { ratings, unrated };
}

customElements.define("cf-stats-view", StatsView);
