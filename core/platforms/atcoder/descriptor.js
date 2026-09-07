/**
 * AtCoder.
 *
 * Two things differ structurally from Codeforces and drive most of what
 * follows. A problem can belong to several contests — 1,906 of 9,383 do — so
 * its identity is its task id, not contest + index, and solving it anywhere
 * counts everywhere. And difficulty is unbounded below: 931 rated problems
 * are negative, so nothing here may clamp to a Codeforces-shaped floor.
 */

const URL_PATTERN = /^https?:\/\/(?:www\.)?atcoder\.jp\/contests\/([A-Za-z0-9_-]+)/i;

/** `/contests/archive` is the contest *list*, not a contest. */
const NOT_CONTESTS = new Set(["archive"]);

const SUBTYPES = [
  [/^abc\d/i, "ABC", "ABC"],
  [/^arc\d/i, "ARC", "ARC"],
  [/^agc\d/i, "AGC", "AGC"],
  [/^ahc\d/i, "AHC", "AHC"],
];

export const atcoder = {
  id: "atcoder",
  label: "AtCoder",
  shortLabel: "AC",
  origin: "https://atcoder.jp",

  subtypes: [...SUBTYPES.map(([, value, label]) => ({ value, label })), { value: "OTHER", label: "Other" }],

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

  /** The task id is the problem's identity; without it the contest is the best link, degraded not fabricated. */
  problemUrl(contest, problem) {
    if (!problem?.problemId) return this.contestUrl(contest);
    return `${this.contestUrl(contest)}/tasks/${problem.problemId}`;
  },

  /** Display-only, e.g. "ABC466 C". */
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

  contestLabel() {
    return "AtCoder contest";
  },

  /** Already a code, not a number — no "#" needed to say so. */
  contestIdLabel(contest) {
    return String(contest.id);
  },

  /**
   * Keyed on the task id, not contest + index: the same problem appears in
   * several contests, and solving it once should clear it everywhere.
   */
  solvedKey(contest, problem) {
    return `atcoder:${problem?.problemId ?? `${contest.id}-${problem?.index}`}`;
  },

  problemKey(contest, problem) {
    return this.solvedKey(contest, problem);
  },

  /* Chart slot — blue. AtCoder brands achromatically, so the slot is free.
     A validated categorical set checked together against the dark surface;
     changing one means re-validating all of them. No rank colours: AtCoder
     has its own scheme, and borrowing Codeforces' would attach its meaning to
     an AtCoder number. Ratings render neutral. */
  chartColor: "#3987e5",

  hostPermissions: ["*://*.atcoder.jp/*"],

  /**
   * AtCoder's own crest, not a drawing: six hand-drawn attempts each read as
   * something else at this size. The line art is dilated before downscaling
   * so the thin strokes keep their mass, then inverted onto a rounded white
   * plate to match the other two. Embedded so this module stays pure.
   */
  icon: `
    <img class="platform-icon" alt="AtCoder"
         src="data:image/png;base64,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" />`,

  capabilities: {
    // AtCoder publishes no problem tags at all — not "none yet", none ever —
    // so the stats panel drops its tag section rather than heading an empty one.
    publishesTags: false,
    // AtCoder publishes no difficulty either, so every rating here is fitted
    // locally over the contest's own standings. A leftover null is therefore
    // a fault, not a fact about the problem; a field that could not be read
    // is `sourceUnreachable` and waits.
    canEstimate: true,
  },
};

function subtypeFor(contestId) {
  for (const [pattern, value] of SUBTYPES) {
    if (pattern.test(contestId)) return value;
  }
  return "OTHER";
}
