/**
 * The AtCoder platform descriptor.
 *
 * Two things differ structurally from Codeforces and drive most of what
 * follows:
 *
 *  - **A problem can belong to several contests.** 1,906 of 9,383 do. So a
 *    problem's identity is its task id, not contest + index, and solving it
 *    anywhere counts as solving it everywhere.
 *  - **Difficulty is published, not estimated**, and is unbounded below —
 *    1,772 rated problems sit under 800 and 931 are negative. Nothing here
 *    may clamp to a Codeforces-shaped floor.
 */

const URL_PATTERN = /^https?:\/\/(?:www\.)?atcoder\.jp\/contests\/([A-Za-z0-9_-]+)/i;

// `/contests/archive` is the contest *list*, not a contest.
const NOT_CONTESTS = new Set(["archive"]);

const SUBTYPE_PREFIXES = [
  [/^abc\d/i, "ABC"],
  [/^arc\d/i, "ARC"],
  [/^agc\d/i, "AGC"],
  [/^ahc\d/i, "AHC"],
];

export const atcoder = {
  id: "atcoder",
  label: "AtCoder",
  shortLabel: "AC",
  origin: "https://atcoder.jp",

  subtypes: [
    { value: "ABC", label: "ABC" },
    { value: "ARC", label: "ARC" },
    { value: "AGC", label: "AGC" },
    { value: "AHC", label: "AHC" },
    { value: "OTHER", label: "Other" },
  ],

  /**
   * @returns {{contestId: string, subtype: string}|null}
   */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;

    const contestId = match[1];
    if (NOT_CONTESTS.has(contestId.toLowerCase())) return null;

    return { contestId, subtype: subtypeFor(contestId) };
  },

  contestUrl(contest) {
    return `${this.origin}/contests/${contest.id}`;
  },

  /**
   * The task id is the problem's identity, so it is stored on the problem.
   * Without it the best available link is the contest itself — a degraded
   * link, not a fabricated one.
   */
  problemUrl(contest, problem) {
    if (!problem?.problemId) return this.contestUrl(contest);
    return `${this.contestUrl(contest)}/tasks/${problem.problemId}`;
  },

  sourceLabel(contest, problem) {
    return `${String(contest.id).toUpperCase()} ${problem.index}`;
  },

  filterGroups: [{ key: "atcoder", label: "AtCoder" }],

  filterKey() {
    return "atcoder";
  },

  /** Nothing about an AtCoder round changes how its row should be read. */
  contestFlags() {
    return [];
  },

  /** Already a code, not a number — no "#" needed to say so. */
  contestIdLabel(contest) {
    return String(contest.id);
  },

  contestLabel() {
    return "AtCoder contest";
  },

  /**
   * Keyed on the task id, not contest + index. The same problem appears in
   * several contests — daily-training rounds are mostly reruns — and solving
   * it once should clear it everywhere it shows up.
   */
  solvedKey(contest, problem) {
    return `atcoder:${problem?.problemId ?? `${contest.id}-${problem?.index}`}`;
  },

  problemKey(contest, problem) {
    return this.solvedKey(contest, problem);
  },

  /**
   * AtCoder's own bands. Note they start far lower than Codeforces' — its
   * scale runs negative — so borrowing Codeforces' thresholds would paint the
   * entire ABC range a single colour.
   */
  /**
   * Chart colour for this platform's slice of the overview ring — aqua; AtCoder brands achromatically, so the slot is arbitrary.
   *
   * Fixed per platform, never assigned by size: a filter that changes which
   * platforms are present must not repaint the survivors. Taken from the first
   * three slots of the validated categorical theme rather than picked by eye;
   * the icons' own brand colours fail the chroma floor as fills.
   */
  /* Chart slot — blue. AtCoder brands achromatically, so there is no brand
     colour to take and the slot is free. */
  chartColor: "#3987e5",

  /**
   * **No rank colours.** AtCoder has its own scheme, but the queue previously
   * borrowed Codeforces' — which attaches Codeforces' meaning to an AtCoder
   * number. "Cyan 1600" says something specific there and nothing here.
   * Ratings render neutral instead; see problem-row.js.
   */


  hostPermissions: ["*://*.atcoder.jp/*"],

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
  icon: `
    <img class="platform-icon" alt="AtCoder"
         src="data:image/png;base64,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" />`,

  settingsFields: [
    {
      key: "upsolve_tracker.atcoder_handle",
      label: "Handle",
      store: "local",
      type: "text",
      placeholder: "e.g., tourist",
      help: "No key needed — the handle alone reads which problems you have solved, directly from AtCoder.",
    },
  ],

  /** One field, so there is nothing to wait for before checking it. */
  verify: { trigger: "change" },

  capabilities: {
    // AtCoder publishes no problem tags at all — not "none yet", none ever.
    // The stats panel drops its whole tag section rather than heading an
    // empty one, which reads as a failed load.
    publishesTags: false,
    // AtCoder Problems publishes difficulty for every rated contest.
    bulkProblemData: true,
    bulkStartTimes: true,
    // No estimator: AtCoder's standings need a login, so there is no field to
    // fit against. A problem the site has not rated therefore stores as null
    // and renders "???" — never as a guess — and converges on a later refresh.
    canEstimate: false,
  },
};

function subtypeFor(contestId) {
  for (const [pattern, subtype] of SUBTYPE_PREFIXES) {
    if (pattern.test(contestId)) return subtype;
  }
  return "OTHER";
}
