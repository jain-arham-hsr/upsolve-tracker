/**
 * Codeforces' gyms — everything under `/gym/<id>`.
 *
 * The only Codeforces path that can read a page: a gym whose standings the
 * setter hid answers FAILED to `contest.standings`, and the `/gym/<id>`
 * problems page is the one page such a contest still renders. See the
 * official descriptor for why the two are platforms rather than subtypes.
 */
import { codeforcesSite } from "../site.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)/i;

export const codeforcesGyms = {
  ...codeforcesSite,

  id: "codeforces-gyms",
  label: "Codeforces Gyms",
  shortLabel: "CF",

  subtypes: [{ value: "GYM", label: "Gym" }],

  /** `/contest/<id>` falls through to the official descriptor. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
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
