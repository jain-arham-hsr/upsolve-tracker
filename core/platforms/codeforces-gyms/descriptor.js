/**
 * Codeforces' gyms — everything under `/gym/<id>`.
 *
 * ## Why this is a platform of its own, and not a subtype
 *
 * See the sibling descriptor for the full argument. In short: a gym's roster
 * has **no API source** — `contest.standings` needs signing and a
 * hidden-standings gym answers `FAILED` to it outright — so this is the only
 * Codeforces path that scrapes HTML, and it is the only one that carries
 * `http.js`, `scraping.js` and `dom-parsers/`. An official round shares
 * none of that.
 *
 * They still share one Codeforces **account** — one handle, one key pair, one
 * settings section — which is why `core/settings/schema.js` declares sections
 * rather than being generated per platform.
 */

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)/i;

export const codeforcesGyms = {
  id: "codeforces-gyms",
  label: "Codeforces Gyms",
  shortLabel: "CF",
  origin: "https://codeforces.com",

  /**
   * One subtype, always. `contest.type` keeps the value it has always stored,
   * so nothing about a record changes — but the platform now implies it.
   */
  subtypes: [{ value: "GYM", label: "Gym" }],

  /**
   * @param {string} url
   * @returns {{contestId: string, subtype: string}|null} null when the URL is
   *   not a Codeforces gym — never a guess. `/contest/<id>` falls through to
   *   the official descriptor.
   */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    return match ? { contestId: match[1], subtype: "GYM" } : null;
  },

  contestUrl(contest) {
    return `${this.origin}/gym/${contest.id}`;
  },

  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problem/${problem.index}`;
  },

  /** Display-only, e.g. "Gym 104123A". */
  sourceLabel(contest, problem) {
    return `Gym ${contest.id}${problem.index}`;
  },

  /**
   * The second of Codeforces' two filter rows. The label names the platform,
   * because the filter is a flat list: a row has to stand on its own without a
   * header above it.
   */
  filterGroups: [{ key: "codeforces-gyms", label: "Codeforces Gyms" }],

  filterKey() {
    return "codeforces-gyms";
  },

  /**
   * Pills shown beside the contest id. Worth labelling here because a gym is
   * off the public problemset — its ratings are mostly estimated and it has no
   * editorial.
   */
  contestFlags() {
    return ["Gym"];
  },

  /** How the contest is named in prose. */
  contestLabel() {
    return "Gym contest";
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
   * Key for "the user has solved this". See the official descriptor for why the
   * two Codeforces platforms namespace separately and why that is correct: each
   * adapter reads the whole account's `user.status` and stamps its own prefix,
   * and lookups go through the platform that owns the contest.
   */
  solvedKey(contest, problem) {
    return `codeforces-gyms:${contest.id}-${problem.index}`;
  },

  problemKey(contest, problem) {
    return `codeforces-gyms:${contest.id}-${problem.index}`;
  },

  /* TODO: awaiting a validated fourth hue. Sharing official's yellow for now,
     which is legible but ambiguous — two adjacent arcs of one colour, told
     apart only by the legend. The replacement has to clear the chroma floor as
     a fill on #1e1e1e and hold CVD separation from all three existing colours,
     re-checked as a set of four rather than on its own. */
  chartColor: "#c98500",

  capabilities: {
    // Gyms sit outside CF's taxonomy and their tags are usually bare, but the
    // vocabulary exists — they come off the standings response — so the stats
    // panel's tag section belongs.
    publishesTags: true,
    // The participant field is readable, so a gap left after the estimator has
    // run is a bug worth refusing on rather than a problem the site has not
    // rated.
    canEstimate: true,
  },
};
