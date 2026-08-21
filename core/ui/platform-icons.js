/**
 * Small inline marks for each platform, used wherever a row needs to say which
 * site it came from.
 *
 * Drawn rather than bundled, but **taken from each site's actual mark** rather
 * than invented — checking the real favicons is what fixed these:
 *
 *  - **Codeforces** — its three bars, yellow/blue/red with blue tallest,
 *    which is exactly what its favicon shows.
 *  - **AtCoder** — its actual crest, shrunk rather than redrawn. See the note
 *    on that entry: the whole emblem at 14px reads as *an ornate crest*, which
 *    is enough to tell it apart, where every simplification of it read as
 *    something else entirely.
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

  // Not drawn: AtCoder's own crest, shrunk. Six hand-drawn attempts each read
  // as something else at this size — a security badge, then an apricot — while
  // the real thing keeps a silhouette a reader recognises even when no
  // individual element is legible.
  //
  // It needs some processing. The crest is line art on transparency and only
  // 24% of its canvas is ink, so a plain downscale averages those thin strokes
  // into grey haze — dilating them first preserves the mass. It is then
  // inverted onto a rounded white plate to match the other two, which the
  // original favicon does not have. Embedded at 2x rather than shipped as a
  // file so this module stays pure: the tests import it with no extension APIs
  // available.
  atcoder: `
    <img class="platform-icon" alt="AtCoder"
         src="data:image/png;base64,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" />`,

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
