/**
 * Small inline marks for each platform, used wherever a row needs to say which
 * site it came from.
 *
 * Drawn rather than bundled, but **taken from each site's actual mark** rather
 * than invented — checking the real favicons is what fixed these:
 *
 *  - **Codeforces** — its three bars, yellow/blue/red with blue tallest,
 *    which is exactly what its favicon shows.
 *  - **AtCoder** — the crown and shield of its heraldic crest, the shield
 *    divided per pale. The full crest adds a globe, two rampant horses,
 *    scrollwork and a wordmark; none of those survive shrinking. Every part
 *    that stayed is earning its pixels: without the crown a bare shield is a
 *    security badge, and the division is what stops the shield reading as a
 *    solid blob — a *disc* in the middle instead made the whole thing an
 *    apricot.
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
 * The marks render at **14px**, which is why the AtCoder shield is narrow,
 * flat-topped and divided rather than rounded and filled. Roughly 200 pixels
 * buys a silhouette and one interior stroke; a globe's circle, equator and
 * meridian need 16px once a crown sits above them, and a centred disc reads as
 * fruit at any size. Measured at 12, 14, 16 and 18 by magnifying the real
 * pixels — every rejected variant looked fine at 96px, which is how a cloud, a
 * muffin, a mushroom and an apricot all got through.
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
      <path d="M5.1 4.0 L4.6 1.5 6.4 3.0 8 1.1 9.6 3.0 11.4 1.5 10.9 4.0 Z" fill="#1C1D1D" />
      <rect x="4.8" y="4.2" width="6.4" height="1.0" rx="0.3" fill="#1C1D1D" />
      <path d="M4.4 6.5 H11.6 V9.9 C11.6 12.3 9.4 13.8 8 14.8 6.6 13.8 4.4 12.3 4.4 9.9 Z"
            fill="#1C1D1D" />
      <path d="M8 6.5 V14.8" stroke="#F7F7F5" stroke-width="0.75" />
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
