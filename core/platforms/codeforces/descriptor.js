/**
 * The Codeforces platform descriptor.
 *
 * Everything that knows a Codeforces URL is shaped like `/contest/1993` or
 * `/gym/104123` lives here. Before this file, the same regex existed twice
 * (contest-manager.js and contest-list.js) and the origin was hardcoded in
 * three more places, so a URL change meant five edits.
 *
 * `subtype` is the value stored on `contest.type`.
 */

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/(contest|gym)\/(\d+)/i;

const SUBTYPE_PATHS = { OFFICIAL: "contest", GYM: "gym" };

export const codeforces = {
  id: "codeforces",
  label: "Codeforces",
  shortLabel: "CF",
  origin: "https://codeforces.com",

  subtypes: [
    { value: "OFFICIAL", label: "Official" },
    { value: "GYM", label: "Gym" },
  ],

  /**
   * @param {string} url
   * @returns {{contestId: string, subtype: string}|null} null when the URL is
   *   not a Codeforces contest — never a guess.
   */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;
    return {
      contestId: match[2],
      subtype: match[1].toLowerCase() === "contest" ? "OFFICIAL" : "GYM",
    };
  },

  contestUrl(contest) {
    const path = SUBTYPE_PATHS[subtypeOf(contest)];
    return `${this.origin}/${path}/${contest.id}`;
  },

  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problem/${problem.index}`;
  },

  /**
   * Display-only, e.g. "Official 2193A".
   *
   * Reuses the badge wording rather than keeping a second Official/Gym
   * mapping — "Contest" and "Gym" read as different kinds of thing, when they
   * are two values of the same one.
   */
  sourceLabel(contest, problem) {
    return `${this.subtypeLabel(contest)} ${contest.id}${problem.index}`;
  },

  /**
   * Codeforces splits into two, because official and gym are genuinely
   * different things to practise. Platforms with many subtypes offer one group
   * instead — nobody wants five AtCoder rows.
   *
   * Labels name the platform, because the filter is a flat list: a row has to
   * stand on its own without a header above it.
   */
  filterGroups: [
    { key: "codeforces:OFFICIAL", label: "Codeforces Official" },
    { key: "codeforces:GYM", label: "Codeforces Gym" },
  ],

  filterKey(contest) {
    return `codeforces:${subtypeOf(contest)}`;
  },

  /** Feeds sourceLabel, e.g. "Official 2237C". Not drawn on its own. */
  subtypeLabel(contest) {
    return subtypeOf(contest) === "OFFICIAL" ? "Official" : "Gym";
  },

  /**
   * Pills shown beside the contest id. Codeforces is the one platform where the
   * subtype changes how the row reads — a gym is off the public problemset, so
   * its ratings are estimated and it has no editorial — so it is the one
   * platform that labels it. Both values are named: with only "Gym" drawn, an
   * unlabelled row reads as missing data rather than as an official round.
   */
  contestFlags(contest) {
    return [subtypeOf(contest) === "OFFICIAL" ? "Official" : "Gym"];
  },

  /**
   * A Codeforces contest is identified by a bare number, so "#" is what marks
   * 692934 as an id rather than a stray count. AtCoder's ABC466 and CodeChef's
   * START252D already read as codes and take the hash badly.
   */
  contestIdLabel(contest) {
    return `#${contest.id}`;
  },

  /** How the contest is named in prose, e.g. "Official contest". */
  contestLabel(contest) {
    return subtypeOf(contest) === "OFFICIAL" ? "Official contest" : "Gym contest";
  },

  /**
   * Key for "the user has solved this". Namespaced by platform so a single
   * Set can hold solved history from every site at once — bare
   * `${contestId}-${index}` would let a Codeforces contest and a CodeChef one
   * sharing a number mark each other's problems solved.
   */
  solvedKey(contest, problem) {
    return `codeforces:${contest.id}-${problem.index}`;
  },

  /**
   * Identity for dedup. On Codeforces a problem belongs to exactly one
   * contest, so contest+index is already unique — unlike AtCoder and CodeChef,
   * where the same problem appears in several contests.
   */
  problemKey(contest, problem) {
    return `codeforces:${contest.id}-${problem.index}`;
  },

  /**
   * Codeforces rank bands, so a histogram bar carries the same meaning the
   * colour does on the site itself.
   */
  /**
   * Chart colour for this platform's slice of the overview ring — blue, matching the tallest bar in its logo.
   *
   * Fixed per platform, never assigned by size: a filter that changes which
   * platforms are present must not repaint the survivors. Taken from the first
   * three slots of the validated categorical theme rather than picked by eye;
   * the icons' own brand colours fail the chroma floor as fills.
   */
  /* Chart slot — yellow. Not CF's brand blue: these three are a validated
     categorical triple checked together against the dark surface, and blue
     is AtCoder's slot here. Changing one means re-validating all three. */
  chartColor: "#c98500",

  ratingBands: [
    { min: 2400, class: "band-red" },
    { min: 2100, class: "band-orange" },
    { min: 1900, class: "band-violet" },
    { min: 1600, class: "band-blue" },
    { min: 1400, class: "band-cyan" },
    { min: 1200, class: "band-green" },
    { min: -Infinity, class: "band-gray" },
  ],

  ratingBandClass(rating) {
    return (
      this.ratingBands.find((band) => rating >= band.min)?.class ?? "band-gray"
    );
  },


  /**
   * Which origins this platform needs, composed into the manifest by
   * vite.config.js. Chrome needs these declared statically, but the build can
   * gather them — so adding a platform never means "and edit the manifest".
   */
  hostPermissions: ["*://*.codeforces.com/*"],

  /**
   * Its three bars, yellow/blue/red with blue tallest, which is exactly what
   * its favicon shows. Drawn rather than bundled, but taken from the real
   * mark rather than invented — see ui/platform-icons.js for why that
   * distinction kept mattering.
   */
  icon: `
    <svg viewBox="0 0 16 16" class="platform-icon" role="img" aria-label="Codeforces">
      <rect x="0.8" y="6"   width="3.6" height="9"  rx="1.2" fill="#F8B00D" />
      <rect x="6.2" y="2"   width="3.6" height="13" rx="1.2" fill="#1F8ACB" />
      <rect x="11.6" y="8.5" width="3.6" height="6.5" rx="1.2" fill="#D6343B" />
    </svg>`,

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
  // available.,

  /**
   * What Settings asks for, and where each answer is kept.
   *
   * `store: "secret"` means IndexedDB rather than chrome.storage.local, which
   * is what keeps the key pair out of the exported JSON backup. The keys are
   * the ones already in use, so nothing stored has to move.
   *
   * `help` is authored here, in the repo, and is injected as trusted HTML so
   * it can carry a link — it is deliberately *not* run through escapeHtml,
   * which everything originating outside the extension must be.
   */
  settingsFields: [
    {
      key: "upsolve_tracker.handle",
      label: "Handle",
      store: "local",
      type: "text",
      placeholder: "e.g., tourist",
      help: "Used to look up your accepted submissions.",
    },
    {
      key: "api_key",
      label: "API key",
      store: "secret",
      type: "text",
      placeholder: "e.g., 70f9b...",
      help:
        'Generate a key pair at <a href="https://codeforces.com/settings/api" target="_blank" rel="noreferrer">codeforces.com/settings/api</a>, then paste both halves below. The pair is stored in this browser only, is used to sign requests to codeforces.com, and is kept out of the JSON backup on purpose.',
    },
    {
      key: "api_secret",
      label: "API secret",
      store: "secret",
      type: "password",
      placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
      help: "The secret half of the same key pair.",
    },
  ],

  /**
   * A button rather than verifying on change, because three fields have to be
   * filled before the check can mean anything — and a signed request fired
   * after each one would mostly be asking with an incomplete key pair.
   */
  verify: {
    trigger: "button",
    label: "Test connection",
    help: "Checks the handle and key against Codeforces before you rely on them.",
    incomplete: "Fill in all three fields first.",
  },

  capabilities: {
    // problemset.problems carries tags. Gyms sit outside CF's taxonomy and
    // are usually bare, but the vocabulary exists, so the section belongs.
    publishesTags: true,
    // problemset.problems covers every official problem in one request.
    bulkProblemData: true,
    // contest.list / contest.list?gym=true.
    bulkStartTimes: true,
    // Codeforces is the only platform whose participant field is readable, so
    // it is the only one that can estimate a difficulty the site has not
    // published. That single fact decides what a gap means: here the estimator
    // should have filled it, so a hole left over is a bug worth refusing on;
    // elsewhere it is simply a problem the site has not rated, and shows "???".
    canEstimate: true,
  },
};

function subtypeOf(contest) {
  const raw = (contest?.type ?? "").toUpperCase();
  return raw === "GYM" ? "GYM" : "OFFICIAL";
}
