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

  sourceLabel(contest, problem) {
    return `${contest.id} ${problem.index}`;
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

  subtypeLabel(contest) {
    return SUBTYPE_LABELS[String(contest?.type ?? "OTHER").toUpperCase()] ?? "Other";
  },

  badgeClass(contest) {
    return String(contest?.type ?? "").toUpperCase() === "STARTERS"
      ? "type-official"
      : "type-gym";
  },

  /** CodeChef's star bands: 7★ from 2500, down to 1★ below 1400. */
  ratingBands: [
    { min: 2500, class: "band-red" },
    { min: 2200, class: "band-orange" },
    { min: 2000, class: "band-violet" },
    { min: 1800, class: "band-blue" },
    { min: 1600, class: "band-cyan" },
    { min: 1400, class: "band-green" },
    { min: -Infinity, class: "band-gray" },
  ],

  ratingBandClass(rating) {
    return (
      this.ratingBands.find((band) => rating >= band.min)?.class ?? "band-gray"
    );
  },

  capabilities: {
    // Difficulty and tags appear only on the per-problem endpoint — absent
    // from every bulk and contest-level response, even when logged in.
    bulkProblemData: false,
    // The start time arrives with the contest payload itself.
    bulkStartTimes: false,
    // 74% of the catalogue carries a -1 sentinel, and there is no estimator
    // fallback here, so a contest may store with gaps.
    allowsPartialRatings: true,
  },
};

function subtypeFor(contestId) {
  for (const [pattern, subtype] of SUBTYPE_PREFIXES) {
    if (pattern.test(contestId)) return subtype;
  }
  return "OTHER";
}
