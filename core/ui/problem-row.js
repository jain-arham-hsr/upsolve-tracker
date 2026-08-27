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
 * @param {{position?: number, compact?: boolean}} [options]
 *   `position` is the 1-based place in the queue, omitted inside a contest's
 *   expansion where the global numbering would mislead. `compact` is for that
 *   expansion too: one line, no platform mark and no contest code, because the
 *   header directly above already carries both and repeating them on every row
 *   buries the contest's own title.
 */
export function renderProblemRow(row, { position, compact = false } = {}) {
  // `!= null`, not truthiness: AtCoder difficulties reach 0 and go negative,
  // and a truthy test would show a real 0 as unrated.
  const rated = row.rating != null;

  // No "Rating:" label. The word implied a single scale shared across
  // platforms, which is the one thing the ordering model denies — the mark
  // beside the number says whose scale it is instead.
  const ratingText = rated ? String(row.rating) : "???";
  const tone = rated ? (row.tone ?? "tone-neutral") : "is-unrated";

  // This number was modelled, not published.
  //
  // Two sources reach it. AtCoder flags ~11% of its own models low-confidence.
  // And the Codeforces estimator runs wherever CF publishes nothing — which on
  // a gym is most problems, and where its error was measured at a mean 211
  // against the problems CF does rate. An unmarked number reads as exact, so a
  // soft one has to say so.
  //
  // `ratingSource === "estimated"` is written only by the Codeforces adapter;
  // AtCoder and CodeChef store "official" or null. So this marks exactly what
  // the extension inferred and nothing that a platform published.
  // `rated &&` because the mark qualifies a number: beside "???" it would claim
  // there is a soft value where there is none. The adapters only ever set
  // "estimated" alongside a real rating, so this is belt and braces.
  const modelled =
    rated &&
    (row.ratingConfidence === "experimental" || row.ratingSource === "estimated");

  // Carried as a *state on the number* — a dotted underline — rather than as a
  // glyph beside it. A "~" was tried and cost four consecutive layout bugs,
  // because one character of width competes with the digits for space and every
  // way of resolving that competition broke something else: it fell onto the
  // next line as a fifth child of a four-column subgrid; it detached across
  // .meta-line's flex gap; reserving a column for it pushed every *unmarked*
  // number away from its platform mark; and drawing it out of flow wedged it
  // against that mark. A decoration occupies no width, so none of that arises.
  //
  // The title moves here too. On the glyph it made a ~6.7px hover target and
  // hovering the number itself did nothing; an underline is also the
  // conventional "there is an explanation attached" cue, so the indicator and
  // the affordance are now the same object.
  const estimated = modelled ? " is-estimated" : "";
  const estimatedTitle = !modelled
    ? ""
    : row.ratingConfidence === "experimental"
      ? ` title="Low-confidence estimate"`
      : ` title="Estimated from this contest's results — Codeforces publishes no rating for it"`;

  // A problem the platform never mirrored to practice can't be submitted any
  // more, so it is dropped from the queue entirely (pending-problems.js) and
  // survives only in a contest's expansion — where hiding it would make the
  // contest look shorter than it is. Marked, not silently different.
  //
  // The wording stays platform-neutral: this renderer is shared, and naming
  // CodeChef here would be the one place a view branches on the platform.
  //
  // It leads the name rather than trailing it. `.compact-name` truncates with
  // an ellipsis, so a trailing mark is clipped off the end for exactly the long
  // titles most likely to need explaining — "Maximize the Minim…" showed the
  // row muted with no clue why. Leading, it is always the first thing on the
  // line and cannot be truncated away.
  const unupsolvable = row.upsolvable === false;
  const warn = unupsolvable
    ? `<span class="upsolve-warn" title="Not in the practice archive — it can't be submitted outside the contest">⚠</span> `
    : "";
  const rowClass = unupsolvable ? " is-unupsolvable" : "";

  // Names come from scraped or API-supplied data; the marks are static.
  const name = escapeHtml(row.name?.replace(/\s+/g, " ").trim() || "Unknown Problem");
  const mark = platformIcon(row.platform, row.platformLabel ?? "");

  const index =
    position == null
      ? ""
      : `<div class="problem-index">${String(position).padStart(2, "0")}.</div>`;

  // A compact row must have exactly four children. `.contest-problems` declares
  // four columns and each row borrows them with `subgrid`, so a fifth drops onto
  // an implicit row of its own — which is exactly what the old "~" flag did,
  // leaving a stray mark on the line below every estimated problem. The `⚠`
  // therefore lives *inside* the name cell, and the estimate mark is no longer
  // an element at all.
  if (compact) {
    return `
    <a href="${escapeHtml(row.url)}" target="_blank" class="problem-row is-compact${rowClass}">
      <span class="compact-index">${escapeHtml(row.index ?? "")}</span>
      <span class="compact-name">${warn}${name}</span>
      <span class="compact-chance">${formatSolveProbability(row.solveProbability)}</span>
      <span class="compact-rating ${tone}${estimated}"${estimatedTitle}>${ratingText}</span>
    </a>`;
  }

  return `
    <a href="${escapeHtml(row.url)}" target="_blank" class="problem-row${rowClass}">
      ${index}
      <div class="problem-content">
        <div class="problem-title">${warn}${name}</div>
        <div class="problem-meta">
          <span class="meta-line">
            <span class="solve-chance" title="Estimated chance you solve this">${formatSolveProbability(
              row.solveProbability,
            )}</span>
            ${mark}
            <span class="rating ${tone}${estimated}"${estimatedTitle}>${ratingText}</span>
          </span>
          <span class="meta-line">
            <span class="source">${escapeHtml(row.sourceLabel)}</span>
          </span>
        </div>
      </div>
    </a>`;
}
