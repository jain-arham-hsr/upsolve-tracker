/**
 * Codeforces' official rounds — everything under `/contest/<id>`.
 *
 * ## Why this is a platform of its own, and not a subtype
 *
 * Official and gym were one descriptor with a `subtypeOf()` helper that six
 * separate modules then branched on. They are not two flavours of one
 * acquisition path: an official round is read entirely from the JSON API
 * (`contest.standings`, `problemset.problems`, `contest.ratingChanges`) and
 * touches no HTML at all, while a gym's roster has no API source and must be
 * scraped. Three API methods each, disjoint. Splitting them means the folder
 * answers "which am I", so nothing downstream has to.
 *
 * They still share one Codeforces **account** — one handle, one key pair, one
 * settings section — which is why `core/settings/schema.js` declares sections
 * rather than being generated per platform.
 */

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/contest\/(\d+)/i;

export const codeforcesOfficial = {
  id: "codeforces-official",
  label: "Codeforces Official",
  shortLabel: "CF",
  origin: "https://codeforces.com",

  /**
   * One subtype, always. `contest.type` keeps the value it has always stored,
   * so nothing about a record changes — but the platform now implies it, which
   * is what let `problemset-sync.js` and `start-times.js` drop their gates.
   */
  subtypes: [{ value: "OFFICIAL", label: "Official" }],

  /**
   * @param {string} url
   * @returns {{contestId: string, subtype: string}|null} null when the URL is
   *   not an official Codeforces contest — never a guess. `/gym/<id>` falls
   *   through to the gyms descriptor, since the path segment is the whole
   *   difference between them.
   */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    return match ? { contestId: match[1], subtype: "OFFICIAL" } : null;
  },

  contestUrl(contest) {
    return `${this.origin}/contest/${contest.id}`;
  },

  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problem/${problem.index}`;
  },

  /** Display-only, e.g. "Official 2193A". */
  sourceLabel(contest, problem) {
    return `Official ${contest.id}${problem.index}`;
  },

  /**
   * Codeforces contributes two filter rows, because official and gym are
   * genuinely different things to practise — it just gets them from two
   * platforms now rather than from one platform's two groups.
   *
   * The label names the platform, because the filter is a flat list: a row has
   * to stand on its own without a header above it.
   */
  filterGroups: [{ key: "codeforces-official", label: "Codeforces Official" }],

  filterKey() {
    return "codeforces-official";
  },

  /**
   * Pills shown beside the contest id. Codeforces is the one platform that
   * labels this, because a gym is off the public problemset — its ratings are
   * estimated and it has no editorial. **Both** values are drawn: with only
   * "Gym" labelled, an unlabelled row reads as missing data rather than as an
   * official round.
   */
  contestFlags() {
    return ["Official"];
  },

  /** How the contest is named in prose. */
  contestLabel() {
    return "Official contest";
  },

  /**
   * A Codeforces contest is identified by a bare number, so "#" is what marks
   * 692934 as an id rather than a stray count. AtCoder's ABC466 and CodeChef's
   * START252D already read as codes and take the hash badly.
   */
  contestIdLabel(contest) {
    return `#${contest.id}`;
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

  /**
   * Duplicated in the sibling descriptor, deliberately. Both platforms *are*
   * Codeforces, so both tint their ratings with Codeforces' own rank colours —
   * and a descriptor that reached into its sibling for them would be the one
   * import that makes the two folders one.
   */
  ratingBandClass(rating) {
    return (
      this.ratingBands.find((band) => rating >= band.min)?.class ?? "band-gray"
    );
  },

  /**
   * Which origins this platform needs, composed into the manifest by
   * vite.config.js. Chrome needs these declared statically, but the build can
   * gather them — so adding a platform never means "and edit the manifest".
   *
   * Both Codeforces platforms name the same origin; `vite.config.js`
   * deduplicates, or the manifest would list it twice.
   */
  hostPermissions: ["*://*.codeforces.com/*"],

  /**
   * Its three bars, yellow/blue/red with blue tallest, which is exactly what
   * its favicon shows. Drawn rather than bundled, but taken from the real
   * mark rather than invented — see ui/platform-icons.js for why that
   * distinction kept mattering.
   *
   * Both Codeforces platforms carry the same mark, on purpose: they are the
   * same site, and the legend row's name is what tells them apart.
   */
  icon: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="Codeforces">
      <rect x="0.8" y="6"   width="3.6" height="9"  rx="1.2" fill="#F8B00D" />
      <rect x="6.2" y="2"   width="3.6" height="13" rx="1.2" fill="#1F8ACB" />
      <rect x="11.6" y="8.5" width="3.6" height="6.5" rx="1.2" fill="#D6343B" />
    </svg>`,

  /**
   * Key for "the user has solved this". Namespaced by platform so a single Set
   * can hold solved history from every site at once.
   *
   * **The two Codeforces platforms namespace separately, and that is correct
   * rather than an oversight.** `user.status` returns the whole account's
   * submissions with no gym/official marker, so each adapter fetches that same
   * stream and stamps its own prefix on it; `applySolvedStatus` then looks up
   * by the prefix of the platform that *owns* the contest. Both adapters see
   * every submission, so the key each one needs is always present. That makes
   * the duplicated fetch load-bearing: skip either and solves stop clearing for
   * that platform.
   */
  solvedKey(contest, problem) {
    return `codeforces-official:${contest.id}-${problem.index}`;
  },

  /**
   * Identity for dedup. On Codeforces a problem belongs to exactly one contest,
   * so contest+index is already unique — unlike AtCoder and CodeChef, where the
   * same problem appears in several contests.
   */
  problemKey(contest, problem) {
    return `codeforces-official:${contest.id}-${problem.index}`;
  },

  /* Chart slot — yellow. Not CF's brand blue: these are a validated categorical
     set checked together against the dark surface, and blue is AtCoder's slot
     here. Changing one means re-validating all of them. */
  chartColor: "#c98500",

  capabilities: {
    // problemset.problems carries tags, and covers every official problem in
    // one request.
    publishesTags: true,
    // Codeforces is the only platform whose participant field is readable, so
    // it is the only one that can estimate a difficulty the site has not
    // published. That single fact decides what a gap means: here the estimator
    // should have filled it, so a hole left over is a bug worth refusing on;
    // elsewhere it is simply a problem the site has not rated, and shows "???".
    canEstimate: true,
  },
};
