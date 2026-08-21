/**
 * Small inline marks for each platform, used wherever a row needs to say which
 * site it came from.
 *
 * Drawn rather than bundled: the real logos are someone else's artwork, and
 * these have to stay legible at about 12px on a dark panel, which detailed
 * marks do not. Codeforces keeps its three bars; AtCoder is an AC monogram,
 * which also happens to be the verdict you are chasing; CodeChef is its toque.
 *
 * **12px is the design constraint, not an afterthought.** An `@` was tried for
 * AtCoder — "At"Coder, and a mark rather than a bare letter — but its inner
 * detail collapses into a blob at that size. The toque likewise only stopped
 * reading as a brown cloud once it sat on a plate: a pale hat against a solid
 * ground has a silhouette, a lumpy brown shape on a dark panel does not.
 *
 * Both light-on-dark marks are inverted from their sites' branding, because a
 * dark mark on the #1e1e1e panel is close to invisible.
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
      <rect width="16" height="16" rx="3.5" fill="#F2F2F2" />
      <text x="8" y="8.4" font-family="Helvetica, Arial, sans-serif" font-size="10"
            font-weight="700" fill="#1C1D1D" text-anchor="middle"
            dominant-baseline="central" letter-spacing="-0.6">AC</text>
    </svg>`,

  codechef: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="CodeChef">
      <rect width="16" height="16" rx="3.5" fill="#7A5238" />
      <circle cx="5.4" cy="6.2" r="2.1" fill="#F3E6DC" />
      <circle cx="10.6" cy="6.2" r="2.1" fill="#F3E6DC" />
      <circle cx="8" cy="5.2" r="2.5" fill="#F3E6DC" />
      <rect x="4.7" y="8.2" width="6.6" height="3.9" rx="0.9" fill="#F3E6DC" />
      <path d="M8 8.6v3" stroke="#7A5238" stroke-width="0.85" />
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
