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
const SCOPE_KEY = "upsolve_tracker.stats_scope";

/** Per-platform: a 1600–1900 span means nothing on AtCoder, where a third of
 *  rated problems sit below 800. */
const rangeKeyFor = (scope) => `upsolve_tracker.tag_rating_range.${scope || "all"}`;

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
    this.nav = this.querySelector("#stats-nav");
    this.spreadTitle = this.querySelector("#spread-title");
    this.rangeBox = this.querySelector("#tag-range");
    this.rangeMin = this.querySelector("#tag-range-min");
    this.rangeMax = this.querySelector("#tag-range-max");
    this.rangeCaption = this.querySelector("#tag-range-caption");
    this.rangeFill = this.querySelector("#range-fill");
    this.rangeValueMin = this.querySelector("#range-value-min");
    this.rangeValueMax = this.querySelector("#range-value-max");

    // The view is rebuilt on every navigation, so both selections are
    // persisted rather than kept on the instance.
    const stored = await chrome.storage.local.get({ [SCOPE_KEY]: "" });
    this.scope = stored[SCOPE_KEY];

    this.renderNav();

    // Two entry points into the same transition: drilling in from a legend row
    // on the Overview, and the back link on a platform panel. Delegated on the
    // view because both are re-rendered on every pass.
    this.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-scope]");
      if (!target) return;

      this.scope = target.dataset.scope;
      await chrome.storage.local.set({ [SCOPE_KEY]: this.scope });
      await this.render();
    });

    // input while dragging, change on release: the tag list is recomputed in
    // memory so it can follow the thumb, but storage is written once per drag
    // rather than once per bucket crossed.
    for (const [input, which] of [[this.rangeMin, "min"], [this.rangeMax, "max"]]) {
      input.addEventListener("input", () => this.onRangeChange(which, false));
      input.addEventListener("change", () => this.onRangeChange(which, true));
    }

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
  /**
   * The Overview carries no navigation of its own — its ring legend is the
   * navigation. A platform panel gets a back link and a header naming what you
   * drilled into, which is what a chip row could never say: that this page is
   * one level down rather than one of four siblings.
   */
  renderNav() {
    if (!this.scope) {
      this.nav.innerHTML = "";
      return;
    }

    // No count here: the summary line directly above already reads
    // "240 pending · median 1600 · 3 unrated" once scoped. This header's job is
    // to name what you drilled into.
    const platform = getPlatform(this.scope);
    this.nav.innerHTML = `
      <button type="button" class="stats-back" data-scope="">\u2039 Overview</button>
      <div class="stats-scope-head">
        ${platformIcon(platform.id, platform.shortLabel)}
        <span class="stats-scope-name">${escapeHtml(platform.label)}</span>
      </div>`;
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
    this.renderNav();

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
    // A platform that publishes no tags gets no tag section at all — heading,
    // coverage line and rating range included. Rendering the frame and then
    // explaining it is empty is worse than not raising the subject: it looks
    // like a load that failed. Asked of the registry, not of the platform id.
    const hasTags = scoped && getPlatform(this.scope).capabilities.publishesTags !== false;
    this.tagsSection.classList.toggle("hidden", !hasTags);
    this.ringSection.classList.toggle("hidden", scoped);

    if (scoped) {
      this.spreadTitle.textContent = "RATING SPREAD";
      this.renderHistogram(ratings, getPlatform(this.scope));
      if (hasTags) {
        this.renderCoverage();
        this.syncRangeControls(ratings);
        this.renderTags();
      }
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
  renderCoverage() {
    // Only ever called from a platform panel — the overview has no tag chart
    // for a coverage line to caveat.
    const scoped = collectPendingProblems(this.contests);
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
        // The `contest.type === "OFFICIAL"` half of this condition is gone:
        // official is a platform now, so the id says it. Note the id itself had
        // to change — it read "codeforces", which after the split matched
        // nothing, so the hint could never have fired again.
        platformOf(contest).id === "codeforces-official" &&
        contest.publishedDataCheckedAt == null,
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
            ${count > 0 ? `<div class="hist-bar ${platform.ratingBandClass?.(bucket) ?? "band-neutral"}" style="width: ${width}%"></div>` : ""}
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

    for (const input of [this.rangeMin, this.rangeMax]) {
      input.min = String(lowest);
      input.max = String(highest);
      input.step = String(BUCKET_SIZE);
    }
    this.rangeMin.value = String(min);
    this.rangeMax.value = String(max);
    this.paintRange();

    // A single bucket leaves nothing to choose between. Mixed platforms have
    // no shared rating axis, so the range only applies to one platform.
    const buckets = (highest - lowest) / BUCKET_SIZE + 1;
    this.rangeBox.classList.toggle("hidden", buckets < 2 || !this.scope);
  }

  /** Moves the highlighted span and the two numbers to match the thumbs. */
  paintRange() {
    const { lowest, highest } = this.bounds ?? {};
    const min = Number(this.rangeMin.value);
    const max = Number(this.rangeMax.value);
    const span = highest - lowest;
    const pct = (value) => (span > 0 ? ((value - lowest) / span) * 100 : 0);

    this.rangeFill.style.left = `${pct(min)}%`;
    this.rangeFill.style.right = `${100 - pct(max)}%`;
    this.rangeValueMin.textContent = String(min);
    this.rangeValueMax.textContent = String(max);

    // Whichever thumb is at the far end has to sit on top, or it becomes
    // impossible to drag back once the two coincide there.
    this.rangeMin.style.zIndex = min >= highest ? "4" : "3";
    this.rangeMax.style.zIndex = min >= highest ? "3" : "4";
  }

  async onRangeChange(changed, persist) {
    let min = Number(this.rangeMin.value);
    let max = Number(this.rangeMax.value);

    // Thumbs clamp rather than cross. Swapping them mid-drag makes the one
    // under the pointer jump to the other side, which reads as a glitch.
    if (min > max) {
      if (changed === "min") {
        min = max;
        this.rangeMin.value = String(min);
      } else {
        max = min;
        this.rangeMax.value = String(max);
      }
    }

    this.range = { min, max };
    this.paintRange();
    this.renderTags();
    if (persist) {
      await chrome.storage.local.set({ [rangeKeyFor(this.scope)]: this.range });
    }
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
   * Only reached on a platform that does publish tags — one that doesn't has
   * no tag section at all (see capabilities.publishesTags). So this is about a
   * queue that happens to have none, not a platform that never will.
   */
  noTagsMessage(range) {
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

customElements.define("upsolve-stats-view", StatsView);
