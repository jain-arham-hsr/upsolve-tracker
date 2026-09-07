/**
 * CodeChef.
 *
 * Three things differ structurally from the others. Contest codes live at
 * the site root (`/START252D`), not under a `/contests/` prefix, so the URL
 * matcher has to tell a contest code from every other path on the site.
 * Starters run as divisions: `/START252` is a parent with no problems of its
 * own, and the contest you competed in is `START252A`..`D`. And the same
 * problem runs in several divisions, so its identity is its own code, not
 * contest + index.
 */

/** Upper-case only: that is what separates a contest code from /problems, /ratings and the rest. */
const URL_PATTERN =
  /^https?:\/\/(?:www\.)?codechef\.com\/(?:rankings\/)?([A-Z][A-Z0-9]{2,})(?:[/?#]|$)/;

const SUBTYPES = [
  [/^START\d/, "STARTERS", "Starters"],
  [/^COOK\d/, "COOKOFF", "Cook-Off"],
  [/^LTIME\d/, "LUNCHTIME", "Lunchtime"],
];

export const codechef = {
  id: "codechef",
  label: "CodeChef",
  shortLabel: "CC",
  origin: "https://www.codechef.com",

  subtypes: [...SUBTYPES.map(([, value, label]) => ({ value, label })), { value: "OTHER", label: "Other" }],

  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;

    const contestId = match[1];
    return { contestId, subtype: subtypeFor(contestId) };
  },

  contestUrl(contest) {
    return `${this.origin}/${contest.id}`;
  },

  /** The in-contest URL, not the practice one the API's `problem_url` points at. */
  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problems/${problem.index}`;
  },

  /**
   * Display-only, without the division letter: a Starters problem usually
   * runs in several divisions at once, so "START252D MODSUB" claims a
   * membership that is not true. The stored id keeps the letter.
   */
  sourceLabel(contest, problem) {
    return `${withoutDivision(contest.id)} ${problem.index}`;
  },

  filterGroups: [{ key: "codechef", label: "CodeChef" }],

  filterKey() {
    return "codechef";
  },

  /** Nothing about a CodeChef contest changes how its row should be read. */
  contestFlags() {
    return [];
  },

  contestLabel() {
    return "CodeChef contest";
  },

  /** Already a code, not a number; the division comes off for the reason `sourceLabel` gives. */
  contestIdLabel(contest) {
    return withoutDivision(contest.id);
  },

  /**
   * Keyed on the problem code alone. Codes are unique site-wide, and the same
   * problem runs in every division of a Starters — solving it in Div 4 has to
   * clear it from a tracked Div 3 as well.
   */
  solvedKey(contest, problem) {
    return `codechef:${problem.index}`;
  },

  problemKey(contest, problem) {
    return this.solvedKey(contest, problem);
  },

  /* Chart slot — red, the nearest working hue to CodeChef's maroon, which
     fails the chroma floor as a fill. This pair sits at CVD deutan delta-E 6.2
     against the yellow: inside the 6-8 band, legal only because every swatch
     carries an icon, a full name and a count. Drop to #c0392b if that stops
     being true. No rank colours: CodeChef grades in stars. */
  chartColor: "#e34948",

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

  capabilities: {
    // Tags come back with each problem, mixed with the setter's handle and
    // the contest code; `cleanTags` strips those.
    publishesTags: true,
    // No estimator: /api/rankings/ answers 403, so there is no field to fit
    // against. A -1 or 9999 sentinel stores as null and renders "???".
    canEstimate: false,
  },
};

/** START252D → START252. Anchored on digits before the letter, so codes that simply end in one are untouched. */
function withoutDivision(contestId) {
  return String(contestId).replace(/^([A-Z]+\d+)[A-Z]$/, "$1");
}

function subtypeFor(contestId) {
  for (const [pattern, value] of SUBTYPES) {
    if (pattern.test(contestId)) return value;
  }
  return "OTHER";
}
