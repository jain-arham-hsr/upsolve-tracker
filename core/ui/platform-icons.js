/**
 * Small inline marks for each platform, used wherever a row needs to say which
 * site it came from.
 *
 * Drawn rather than bundled, but **taken from each site's actual mark** rather
 * than invented — checking the real favicons is what fixed these:
 *
 *  - **Codeforces** — its three bars, yellow/blue/red with blue tallest,
 *    which is exactly what its favicon shows.
 *  - **AtCoder** — the crown, shield and globe of its heraldic crest. The full
 *    crest adds two rampant horses, scrollwork and a wordmark, none of which
 *    survive shrinking. The crown and globe both earn their pixels: without
 *    them a bare shield reads as a generic security badge.
 *  - **CodeChef** — `CC` on brown, which *is* its favicon, in its own colours
 *    (`#583722` / `#FAFAED`, sampled from it). A toque was drawn three times
 *    and read as a cloud, then a muffin, then a mushroom: at 12px a lobed
 *    crown over a band is food, whatever the intent.
 *
 * **The rendered size is the design constraint**, and vectors flatter
 * themselves at 96px. Rasterise at the real size and magnify the pixels before
 * believing a mark works — that is what caught the `@` tried for AtCoder,
 * handsome large and a blob small.
 *
 * The marks render at **16px**. Each element added to the AtCoder crest costs
 * room: a shield alone reads at 12px, a shield with a globe needs 14, and once
 * a crown sits above it the shield shrinks again and 16 is where the globe
 * comes back. Measured at 12, 14, 16 and 18 by magnifying the real pixels —
 * every one of those variants looks fine at 96px.
 *
 * Light-on-dark marks are inverted from their sites' branding, because a dark
 * mark on the #1e1e1e panel is close to invisible.
 *
 * Inline SVG rather than image files so they inherit the panel's rendering and
 * cost no extra request.
 */

const ICONS = {
  codeforces: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="Codeforces">
      <rect x="0.8" y="6"   width="3.6" height="9"  rx="1.2" fill="#F8B00D" />
      <rect x="6.2" y="2"   width="3.6" height="13" rx="1.2" fill="#1F8ACB" />
      <rect x="11.6" y="8.5" width="3.6" height="6.5" rx="1.2" fill="#D6343B" />
    </svg>`,

  atcoder: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="AtCoder">
      <rect width="16" height="16" rx="3" fill="#F7F7F5" />
      <path d="M4.6 4.2 L4.1 1.4 6 3.1 8 1.0 10 3.1 11.9 1.4 11.4 4.2 Z" fill="#1C1D1D" />
      <rect x="4.3" y="4.35" width="7.4" height="1.05" rx="0.35" fill="#1C1D1D" />
      <path d="M8 5.1 12.6 6.6 V10 C12.6 12.4 8 14.5 8 14.5 S3.4 12.4 3.4 10 V6.6 Z"
            fill="#1C1D1D" />
      <circle cx="8" cy="9.6" r="2.2" fill="none" stroke="#F7F7F5" stroke-width="1.05" />
      <path d="M5.8 9.6h4.4" stroke="#F7F7F5" stroke-width="1.05" />
      <ellipse cx="8" cy="9.6" rx="1.01" ry="2.2" fill="none" stroke="#F7F7F5"
               stroke-width="0.95" />
    </svg>`,

  codechef: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="CodeChef">
      <rect width="16" height="16" rx="3.5" fill="#583722" />
      <text x="8" y="8.6" font-family="Helvetica, Arial, sans-serif" font-size="10.5"
            font-weight="700" fill="#FAFAED" text-anchor="middle"
            dominant-baseline="central" letter-spacing="-0.7">CC</text>
    </svg>`,
};

/**
 * @param {string} platformId
 * @param {string} label - fallback text if the platform has no mark yet, so a
 *   new platform shows something rather than nothing.
 */
export function platformIcon(platformId, label = "") {
  return ICONS[platformId] ?? `<span class="platform-chip">${label}</span>`;
}
