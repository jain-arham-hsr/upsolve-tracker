/**
 * The CodeChef platform descriptor.
 *
 * Three structural differences from the others:
 *
 *  - **Contest codes live at the site root** (`/START252D`), not under a
 *    `/contests/` prefix, so the URL matcher has to discriminate contest codes
 *    from every other path on the site. Codes are upper-case; CodeChef's own
 *    sections (`/problems`, `/ratings`, `/practice`) are lower-case.
 *  - **Starters run as divisions.** `/START252` is a parent with no problems
 *    of its own; the contest you competed in is `START252A`..`D`.
 *  - **The same problem runs in several divisions**, so a problem's identity
 *    is its own code, not contest + index.
 */

// Upper-case only: that is what separates a contest code from /problems,
// /ratings, /practice and the rest of the site.
const URL_PATTERN =
  /^https?:\/\/(?:www\.)?codechef\.com\/(?:rankings\/)?([A-Z][A-Z0-9]{2,})(?:[/?#]|$)/;

const SUBTYPE_PREFIXES = [
  [/^START\d/, "STARTERS"],
  [/^COOK\d/, "COOKOFF"],
  [/^LTIME\d/, "LUNCHTIME"],
];

const SUBTYPE_LABELS = {
  STARTERS: "Starters",
  COOKOFF: "Cook-Off",
  LUNCHTIME: "Lunchtime",
  OTHER: "Other",
};

export const codechef = {
  id: "codechef",
  label: "CodeChef",
  shortLabel: "CC",
  origin: "https://www.codechef.com",

  subtypes: Object.entries(SUBTYPE_LABELS).map(([value, label]) => ({ value, label })),

  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;

    const contestId = match[1];
    return { contestId, subtype: subtypeFor(contestId) };
  },

  contestUrl(contest) {
    return `${this.origin}/${contest.id}`;
  },

  /** In-contest URL, not the practice one — `problem_url` points at practice. */
  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problems/${problem.index}`;
  },

  /**
   * Names the contest without its division letter.
   *
   * A Starters problem usually runs in several divisions at once — MODSUB was
   * in all four of Starters 252 — so "START252D MODSUB" claims it belongs to
   * Div 4 specifically, which is not true. The division is still real and is
   * still shown on the Contests tab, where it identifies the contest actually
   * tracked; here it only misleads.
   *
   * The URL keeps it: `/START252/problems/MODSUB` does not exist, because the
   * parent contest carries no problems of its own.
   */
  sourceLabel(contest, problem) {
    return `${withoutDivision(contest.id)} ${problem.index}`;
  },

  contestLabel() {
    return "CodeChef contest";
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

  filterGroups: [{ key: "codechef", label: "CodeChef" }],

  filterKey() {
    return "codechef";
  },

  /** Nothing about a CodeChef contest changes how its row should be read. */
  contestFlags() {
    return [];
  },

  /**
   * Already a code, not a number — no "#" needed to say so. The division
   * suffix comes off for the same reason it does in sourceLabel: the same
   * problem runs in every division of a Starters, so naming one division
   * overstates which contest a row belongs to. The stored id keeps it, since
   * that is what the URL and the problem list need.
   */
  contestIdLabel(contest) {
    return withoutDivision(contest.id);
  },

  /** CodeChef's star bands: 7★ from 2500, down to 1★ below 1400. */
  /**
   * Chart colour for this platform's slice of the overview ring — orange, nearest its brown toque.
   *
   * Fixed per platform, never assigned by size: a filter that changes which
   * platforms are present must not repaint the survivors. Taken from the first
   * three slots of the validated categorical theme rather than picked by eye;
   * the icons' own brand colours fail the chroma floor as fills.
   */
  /* Chart slot — red, the nearest working hue to CodeChef's maroon, which
     fails the chroma floor as a fill. Note this pair sits at CVD deutan
     delta-E 6.2 against the yellow: inside the 6-8 band, which is legal only
     because every swatch carries an icon, a full name and a count beside it.
     Drop to #c0392b if that stops being true. */
  chartColor: "#e34948",

  /**
   * **No rank colours.** CodeChef grades in stars, so painting its ratings on
   * Codeforces' scale imports a meaning that does not transfer.
   */


  hostPermissions: ["*://*.codechef.com/*"],

  /**
   * `CC` on brown, which *is* its favicon, in its own colours (#583722 /
   * #FAFAED, sampled from it). A toque was drawn three times and read as a
   * cloud, then a muffin, then a mushroom: at 12px a lobed crown over a band
   * is food, whatever the intent.
   */
  icon: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="CodeChef">
      <rect width="16" height="16" rx="3.5" fill="#583722" />
      <text x="8" y="8.6" font-family="Helvetica, Arial, sans-serif" font-size="10.5"
            font-weight="700" fill="#FAFAED" text-anchor="middle"
            dominant-baseline="central" letter-spacing="-0.7">CC</text>
    </svg>`,

  settingsFields: [
    {
      key: "upsolve_tracker.codechef_handle",
      label: "Handle",
      store: "local",
      type: "text",
      placeholder: "e.g., tourist",
      help:
        "No key needed. CodeChef answers for whoever is signed in at codechef.com, " +
        "so this handle is what that session gets checked against \u2014 if they don't " +
        "match, syncing stops rather than reading somebody else's solves.",
    },
  ],

  verify: { trigger: "change" },

  capabilities: {
    // Tags come back with each problem, mixed with the setter's handle and
    // the contest code; cleanTags strips those.
    publishesTags: true,
    // Difficulty and tags appear only on the per-problem endpoint — absent
    // from every bulk and contest-level response, even when logged in.
    bulkProblemData: false,
    // The start time arrives with the contest payload itself.
    bulkStartTimes: false,
    // No estimator: /api/rankings/ answers 403, so there is no field to fit
    // against. A -1 or 9999 sentinel therefore stores as null and renders
    // "???" rather than being guessed at.
    canEstimate: false,
  },
};

/**
 * Drops a single trailing division letter: START252D -> START252.
 *
 * Anchored on digits before the letter so codes that simply end in one are
 * untouched — the divisions are always a suffix on a numbered contest.
 */
function withoutDivision(contestId) {
  return String(contestId).replace(/^([A-Z]+\d+)[A-Z]$/, "$1");
}

function subtypeFor(contestId) {
  for (const [pattern, subtype] of SUBTYPE_PREFIXES) {
    if (pattern.test(contestId)) return subtype;
  }
  return "OTHER";
}
