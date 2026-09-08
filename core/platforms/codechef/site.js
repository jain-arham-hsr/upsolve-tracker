/**
 * CodeChef, the site.
 *
 * Origin, host permission, mark, and the settings section. CodeChef grades in
 * stars, so there are no rank colours to carry: ratings render neutral.
 */
export const site = {
  id: "codechef",
  label: "CodeChef",
  /* Chart slot — red, the nearest working hue to CodeChef's maroon, which
     fails the chroma floor as a fill. This pair sits at CVD deutan delta-E 6.2
     against the yellow: inside the 6-8 band, legal only because every swatch
     carries an icon, a full name and a count. Drop to #c0392b if that stops
     being true. */
  chartColor: "#e34948",
  settingsSection: "codechef",
  origin: "https://www.codechef.com",
  hostPermissions: ["*://*.codechef.com/*"],

  /**
   * `CC` on brown, which *is* its favicon, in its own sampled colours. A toque
   * was drawn three times and read as a cloud, a muffin, a mushroom.
   */
  icon: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="CodeChef">
      <rect width="16" height="16" rx="3.5" fill="#583722" />
      <text x="8" y="8.6" font-family="Helvetica, Arial, sans-serif" font-size="10.5"
            font-weight="700" fill="#FAFAED" text-anchor="middle"
            dominant-baseline="central" letter-spacing="-0.7">CC</text>
    </svg>`,
};
