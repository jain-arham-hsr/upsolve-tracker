/**
 * Small inline marks for each platform, used wherever a row needs to say which
 * site it came from.
 *
 * Drawn rather than bundled: the real logos are someone else's artwork, and
 * these have to stay legible at about 12px on a dark panel, which detailed
 * marks do not. Each one keeps the site's recognisable shape and colours —
 * Codeforces' three bars, AtCoder's letterform, CodeChef's toque.
 *
 * AtCoder's is light-on-dark rather than the reverse: its branding is black on
 * white, and a #222 square on a #1e1e1e panel is close to invisible.
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
      <path d="M4.1 12.4 L8 3.6 L11.9 12.4 M5.7 9.5 H10.3"
            fill="none" stroke="#1C1D1D" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,

  codechef: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="CodeChef">
      <path d="M4.2 9.2 C2 9.2 1 7.8 1 6.4 C1 4.9 2.3 3.9 3.7 4.2
               C4.2 2.5 5.7 1.5 8 1.5 C10.3 1.5 11.8 2.5 12.3 4.2
               C13.7 3.9 15 4.9 15 6.4 C15 7.8 14 9.2 11.8 9.2 Z"
            fill="#956751" />
      <rect x="4.2" y="9.6" width="7.6" height="4.6" rx="1.1" fill="#5B4638" />
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
