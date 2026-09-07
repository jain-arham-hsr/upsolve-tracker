/**
 * Codeforces: one site, two platforms.
 *
 * `/contest/<id>` is an official round and `/gym/<id>` a gym, and they are
 * registered as separate platforms rather than subtypes of one: an official
 * round is read entirely from the JSON API and touches no HTML, while a gym
 * can need a page. A class per platform answers "which am I", so nothing
 * downstream branches on it. What they share — origin, host permission, mark,
 * rank colours, and the two keys that only need a platform id to differ — is
 * the partial below, which both spread.
 */
const site = {
  origin: "https://codeforces.com",

  /**
   * Composed into the manifest by vite.config.js, which deduplicates — both
   * Codeforces platforms name the same origin.
   */
  hostPermissions: ["*://*.codeforces.com/*"],

  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problem/${problem.index}`;
  },

  /**
   * A Codeforces contest is identified by a bare number, so "#" is what marks
   * 692934 as an id rather than a stray count.
   */
  contestIdLabel(contest) {
    return `#${contest.id}`;
  },

  /**
   * Namespaced by platform id, and the two Codeforces platforms namespace
   * separately on purpose: `user.status` returns the whole account's
   * submissions with no gym/official marker, so each platform reads the same
   * stream and stamps its own prefix, and `applySolvedStatus` looks up by the
   * prefix of the platform that owns the contest.
   */
  solvedKey(contest, problem) {
    return `${this.id}:${contest.id}-${problem.index}`;
  },

  /** On Codeforces a problem belongs to exactly one contest, so this is already unique. */
  problemKey(contest, problem) {
    return `${this.id}:${contest.id}-${problem.index}`;
  },

  ratingBands: [
    { min: 2400, class: "band-red" },
    { min: 2100, class: "band-orange" },
    { min: 1900, class: "band-violet" },
    { min: 1600, class: "band-blue" },
    { min: 1400, class: "band-cyan" },
    { min: 1200, class: "band-green" },
    { min: -Infinity, class: "band-gray" },
  ],

  /** Codeforces' own rank colours; the only platform whose numbers are tinted. */
  ratingBandClass(rating) {
    return this.ratingBands.find((band) => rating >= band.min)?.class ?? "band-gray";
  },

  /**
   * Its three bars, yellow/blue/red with blue tallest — the favicon, drawn.
   * Both platforms carry the same mark: they are the same site, and the
   * legend row's name is what tells them apart.
   */
  icon: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="Codeforces">
      <rect x="0.8" y="6"   width="3.6" height="9"  rx="1.2" fill="#F8B00D" />
      <rect x="6.2" y="2"   width="3.6" height="13" rx="1.2" fill="#1F8ACB" />
      <rect x="11.6" y="8.5" width="3.6" height="6.5" rx="1.2" fill="#D6343B" />
    </svg>`,
};

// ---------------------------------------------------------------------------
// Official rounds
// ---------------------------------------------------------------------------

const OFFICIAL_URL = /^https?:\/\/(?:www\.)?codeforces\.com\/contest\/(\d+)/i;

export const codeforcesOfficial = {
  ...site,

  id: "codeforces-official",
  label: "Codeforces Official",
  shortLabel: "CF",

  /** One subtype, always; `contest.type` keeps the value it has always stored. */
  subtypes: [{ value: "OFFICIAL", label: "Official" }],

  /** `/gym/<id>` falls through to the gyms descriptor; the path segment is the whole difference. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(OFFICIAL_URL) : null;
    return match ? { contestId: match[1], subtype: "OFFICIAL" } : null;
  },

  contestUrl(contest) {
    return `${this.origin}/contest/${contest.id}`;
  },

  /** Display-only, e.g. "Official 2193A". */
  sourceLabel(contest, problem) {
    return `Official ${contest.id}${problem.index}`;
  },

  /**
   * One of Codeforces' two filter rows. The label names the platform because
   * the filter is a flat list: a row has to stand on its own.
   */
  filterGroups: [{ key: "codeforces-official", label: "Codeforces Official" }],

  filterKey() {
    return "codeforces-official";
  },

  /**
   * Both Codeforces values are drawn: with only "Gym" labelled, an unlabelled
   * row reads as missing data rather than as an official round.
   */
  contestFlags() {
    return ["Official"];
  },

  contestLabel() {
    return "Official contest";
  },

  /* Chart slot — yellow. Not CF's brand blue: these are a validated categorical
     set checked together against the dark surface, and blue is AtCoder's slot.
     Changing one means re-validating all of them. */
  chartColor: "#c98500",

  capabilities: {
    // problemset.problems carries tags, and covers every official problem.
    publishesTags: true,
    // The participant field is readable, so a gap left after the estimator has
    // run is a bug worth refusing on, not a problem the site has not rated.
    canEstimate: true,
  },
};

// ---------------------------------------------------------------------------
// Gyms
// ---------------------------------------------------------------------------

const GYM_URL = /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)/i;

export const codeforcesGyms = {
  ...site,

  id: "codeforces-gyms",
  label: "Codeforces Gyms",
  shortLabel: "CF",

  subtypes: [{ value: "GYM", label: "Gym" }],

  /** `/contest/<id>` falls through to the official descriptor. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(GYM_URL) : null;
    return match ? { contestId: match[1], subtype: "GYM" } : null;
  },

  contestUrl(contest) {
    return `${this.origin}/gym/${contest.id}`;
  },

  /** Display-only, e.g. "Gym 104123A". */
  sourceLabel(contest, problem) {
    return `Gym ${contest.id}${problem.index}`;
  },

  filterGroups: [{ key: "codeforces-gyms", label: "Codeforces Gyms" }],

  filterKey() {
    return "codeforces-gyms";
  },

  /** Worth labelling: a gym is off the public problemset, mostly estimated, with no editorial. */
  contestFlags() {
    return ["Gym"];
  },

  contestLabel() {
    return "Gym contest";
  },

  /* TODO: awaiting a validated fourth hue. Sharing official's yellow for now,
     which is legible but ambiguous — two adjacent arcs of one colour, told
     apart only by the legend. The replacement has to clear the chroma floor as
     a fill on #1e1e1e and hold CVD separation from all three existing colours,
     re-checked as a set of four rather than on its own. */
  chartColor: "#c98500",

  capabilities: {
    // Gyms sit outside CF's taxonomy and their tags are usually bare, but the
    // vocabulary exists — they come off the standings response.
    publishesTags: true,
    canEstimate: true,
  },
};
