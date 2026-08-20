/**
 * The Codeforces platform descriptor.
 *
 * Everything that knows a Codeforces URL is shaped like `/contest/1993` or
 * `/gym/104123` lives here. Before this file, the same regex existed twice
 * (contest-manager.js and contest-list.js) and the origin was hardcoded in
 * three more places, so a URL change meant five edits.
 *
 * `subtype` is the value stored on `contest.type` — kept under that name so
 * existing records need no migration.
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

  /** Display-only, e.g. "Contest 2193A". */
  sourceLabel(contest, problem) {
    const noun = subtypeOf(contest) === "OFFICIAL" ? "Contest" : "Gym";
    return `${noun} ${contest.id}${problem.index}`;
  },

  /** Badge text in the contest list. */
  subtypeLabel(contest) {
    return subtypeOf(contest) === "OFFICIAL" ? "Official" : "Gym";
  },

  /** Badge style: filled for primary contests, outlined for secondary. */
  badgeClass(contest) {
    return subtypeOf(contest) === "OFFICIAL" ? "type-official" : "type-gym";
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

  capabilities: {
    // problemset.problems covers every official problem in one request.
    bulkProblemData: true,
    // contest.list / contest.list?gym=true.
    bulkStartTimes: true,
    // The estimator fills anything CF leaves unrated, so a gap here is a bug
    // worth refusing on rather than storing. AtCoder and CodeChef have no
    // estimator and set this true.
    allowsPartialRatings: false,
  },
};

function subtypeOf(contest) {
  const raw = (contest?.type ?? "").toUpperCase();
  return raw === "GYM" ? "GYM" : "OFFICIAL";
}
