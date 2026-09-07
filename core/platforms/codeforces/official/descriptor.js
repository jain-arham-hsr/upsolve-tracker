/**
 * Codeforces' official rounds — everything under `/contest/<id>`.
 *
 * A platform of its own rather than a subtype of one Codeforces platform: an
 * official round is read entirely from the JSON API and touches no HTML,
 * while a gym can need a page. The folder answers "which am I", so nothing
 * downstream branches on it. What the two share is one account and the site
 * itself, in `../descriptor.js`.
 */
import { codeforces } from "../descriptor.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/contest\/(\d+)/i;

export const codeforcesOfficial = {
  ...codeforces,

  id: "codeforces-official",
  label: "Codeforces Official",
  shortLabel: "CF",

  /** One subtype, always; `contest.type` keeps the value it has always stored. */
  subtypes: [{ value: "OFFICIAL", label: "Official" }],

  /** `/gym/<id>` falls through to the gyms descriptor; the path segment is the whole difference. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
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
