/**
 * What both Codeforces descriptors share: the site itself.
 *
 * A partial descriptor — origin, host permission, mark, rank colours, and the
 * two keys that only need a platform id to differ — with **no `id`**, which is
 * what keeps the registry from ever listing it. Each platform's descriptor
 * spreads this and adds what tells the two apart.
 */
export const codeforces = {
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
