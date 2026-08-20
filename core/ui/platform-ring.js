/**
 * The overview ring: where the backlog sits, by platform.
 *
 * A composition chart, so colour encodes **identity** — each platform's slot is
 * fixed on its descriptor, never assigned by size. Filtering to two platforms
 * must not repaint the survivors.
 *
 * Deliberately not a progress ring. `updateSolvedStatus` deletes a contest once
 * every problem in it is solved, so the only solved problems still on disk are
 * those in part-finished contests: a "you've solved 12%" ring would understate
 * by an unknowable amount and would *fall* as you cleared contests.
 */
import { escapeHtml } from "./escape-html.js";
import { platformIcon } from "./platform-icons.js";

const SIZE = 100;
const RADIUS = 40;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A surface-coloured gap between segments, so adjacent fills stay separable. */
const GAP = 2;

/**
 * @param {{platform: object, count: number}[]} slices
 * @returns {string} markup, or "" when there is nothing to draw.
 */
export function renderPlatformRing(slices) {
  const present = (slices ?? []).filter((slice) => slice.count > 0);
  const total = present.reduce((sum, slice) => sum + slice.count, 0);
  if (total === 0) return "";

  // One platform needs no gap — a lone arc with a notch in it just looks broken.
  const gap = present.length > 1 ? GAP : 0;

  let offset = 0;
  const arcs = present
    .map(({ platform, count }) => {
      const length = (count / total) * CIRCUMFERENCE;
      // Never let a tiny slice vanish entirely; 1px still reads as present.
      const drawn = Math.max(length - gap, 1);
      const arc = `
        <circle
          class="ring-arc" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}"
          fill="none" stroke="${platform.chartColor}" stroke-width="${STROKE}"
          stroke-dasharray="${drawn.toFixed(2)} ${(CIRCUMFERENCE - drawn).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
        ><title>${escapeHtml(platform.label)}: ${count}</title></circle>`;
      offset += length;
      return arc;
    })
    .join("");

  // Counts sit in the legend as text too, so the chart is never the only way
  // to read them.
  const legend = present
    .map(
      ({ platform, count }) => `
      <li class="ring-legend-row">
        <span class="ring-swatch" style="background-color: ${platform.chartColor}"></span>
        ${platformIcon(platform.id, platform.shortLabel)}
        <span class="ring-legend-name">${escapeHtml(platform.label)}</span>
        <span class="ring-legend-count">${count}</span>
      </li>`,
    )
    .join("");

  return `
    <div class="ring-figure">
      <svg class="ring-chart" viewBox="0 0 ${SIZE} ${SIZE}" role="img"
           aria-label="Pending problems by platform">
        <g transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})">${arcs}</g>
        <text class="ring-total" x="${SIZE / 2}" y="${SIZE / 2 - 2}"
              text-anchor="middle" dominant-baseline="middle">${total}</text>
        <text class="ring-caption" x="${SIZE / 2}" y="${SIZE / 2 + 11}"
              text-anchor="middle" dominant-baseline="middle">pending</text>
      </svg>
      <ul class="ring-legend">${legend}</ul>
    </div>`;
}
