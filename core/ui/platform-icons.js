/**
 * The small mark that says which site a row came from.
 *
 * The marks themselves live on their descriptors, beside `chartColor` — a
 * platform's own appearance is its own to declare, and this module is shared
 * by every row in the app, so it must not know which platforms exist. What
 * stays here is the fallback and the design rules that apply to all of them.
 *
 * **The rendered size is the design constraint**, and vectors flatter
 * themselves at 96px. Rasterise at the real size and magnify the pixels before
 * believing a mark works — that is what caught the `@` tried for AtCoder,
 * handsome large and a blob small, and the three separate CodeChef toques that
 * read as a cloud, a muffin and a mushroom.
 *
 * The marks render at **14px**. Roughly 200 pixels buys a silhouette and one
 * interior stroke; a globe's circle, equator and meridian need 16px once a
 * crown sits above them, and a centred disc reads as fruit at any size.
 * Measured at 12, 14, 16 and 18 by magnifying the real pixels — every rejected
 * variant looked fine at 96px, which is how a cloud, a muffin, a mushroom and
 * an apricot all got through.
 *
 * Light-on-dark marks are inverted from their sites' branding, because a dark
 * mark on the #1e1e1e panel is close to invisible.
 *
 * Inline SVG rather than image files so they inherit the panel's rendering and
 * cost no extra request.
 */
import { listPlatforms } from "../platforms/registry.js";

/**
 * @param {string} platformId
 * @param {string} label - fallback text if the platform has no mark yet, so a
 *   new platform shows something rather than nothing.
 */
export function platformIcon(platformId, label = "") {
  // `listPlatforms().find`, not `getPlatform`, which throws on an id it does
  // not know. The fallback below is the point of this function: a platform
  // without a mark yet should show something rather than take the panel down.
  const icon = listPlatforms().find((p) => p.id === platformId)?.icon;
  return icon ?? `<span class="platform-chip">${label}</span>`;
}
