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
