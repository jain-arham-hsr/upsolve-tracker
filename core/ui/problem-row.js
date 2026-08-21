/**
 * One problem, as the queue and the contest list both render it.
 *
 * Shared rather than copied: the two views must agree on ordering and on what
 * a row says, and duplicated markup drifts. The view model is separated from
 * the markup so ordering can be applied between them.
 */
import { solveProbability, formatSolveProbability } from "../queue-order.js";
import { escapeHtml } from "./escape-html.js";
import { platformIcon } from "./platform-icons.js";

/**
 * @param {{contest: object, platform: object, problem: object}} pending
 *   — an entry from `collectPendingProblems()`.
 * @param {Record<string, number|null>} userRatings
 */
export function toProblemRow({ contest, platform, problem }, userRatings) {
  return {
    ...problem,
    contestId: contest.id,
    platform: platform.id,
    platformLabel: platform.shortLabel,
    startTimeSeconds: contest.startTimeSeconds ?? null,
    url: platform.problemUrl(contest, problem),
    sourceLabel: platform.sourceLabel(contest, problem),

    // Only Codeforces tints its ratings, because only there do the colours
    // carry the site's own established meaning. Painting a CodeChef number on
    // Codeforces' scale would import a rank meaning that does not transfer, so
    // platforms without their own scheme render neutral.
    tone:
      problem.rating != null && platform.ratingBandClass
        ? platform.ratingBandClass(problem.rating).replace("band-", "tone-")
        : null,

    // Ratings from different sites aren't comparable, so the queue orders by
    // how likely you are to solve each one instead. Null whenever either input
    // is unknown — never a stand-in.
    solveProbability: solveProbability(
      problem.rating,
      userRatings?.[platform.id] ?? null,
    ),
  };
}

/**
 * @param {object} row - from `toProblemRow`
 * @param {{position?: number}} [options] - 1-based place in the queue. Omitted
 *   inside a contest's expansion, where the queue's global numbering would be
 *   misleading.
 */
export function renderProblemRow(row, { position } = {}) {
  // `!= null`, not truthiness: AtCoder difficulties reach 0 and go negative,
  // and a truthy test would show a real 0 as unrated.
  const rated = row.rating != null;

  // No "Rating:" label. The word implied a single scale shared across
  // platforms, which is the one thing the ordering model denies — the mark
  // beside the number says whose scale it is instead.
  const ratingText = rated ? String(row.rating) : "???";
  const tone = rated ? (row.tone ?? "tone-neutral") : "is-unrated";

  // ~11% of AtCoder's models are flagged low-confidence; marking them beats
  // presenting an estimate as if it were measured.
  const flag =
    row.ratingConfidence === "experimental"
      ? `<span class="rating-flag" title="Low-confidence estimate">~</span>`
      : "";

  // Names come from scraped or API-supplied data; the marks are static.
  const name = escapeHtml(row.name?.replace(/\s+/g, " ").trim() || "Unknown Problem");
  const mark = platformIcon(row.platform, row.platformLabel ?? "");

  const index =
    position == null
      ? ""
      : `<div class="problem-index">${String(position).padStart(2, "0")}.</div>`;

  return `
    <a href="${escapeHtml(row.url)}" target="_blank" class="problem-row">
      ${index}
      <div class="problem-content">
        <div class="problem-title">${name}</div>
        <div class="problem-meta">
          <span class="meta-line">
            <span class="solve-chance" title="Estimated chance you solve this">${formatSolveProbability(
              row.solveProbability,
            )}</span>
            ${mark}
            <span class="rating ${tone}">${ratingText}</span>${flag}
          </span>
          <span class="meta-line">
            <span class="source">${escapeHtml(row.sourceLabel)}</span>
          </span>
        </div>
      </div>
    </a>`;
}
