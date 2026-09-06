/**
 * Codeforces' HTML, and recognising when Codeforces refuses.
 *
 * The pacing and the fetching now live in `services/site-client.js`, shared with
 * every other platform. What stays here is Codeforces' own: the throttling
 * numbers, tuned against the live site, and what its refusal looks like.
 *
 * **Do not shorten these delays when optimising.** Even sampled, adding a
 * contest issues tens of requests, and they are what keeps the extension from
 * being blocked. `measureFrom: "end"` is load-bearing for the same reason: it
 * waits the full gap after each request finishes, rather than letting a slow
 * page count towards the next gap. `tests/request-pacer.test.js` fails if that
 * is collapsed.
 */
import { createSiteClient } from "../../services/site-client.js";
import { codeforcesGyms } from "./descriptor.js";

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const client = createSiteClient({
  // Routed through a Codeforces tab when one is open, so the request carries the
  // session and Cloudflare sees the user rather than a stranger. Falls back to a
  // direct fetch otherwise, which still reads anything public.
  site: codeforcesGyms,
  pacer: {
    gapMs: [1000, 2500],
    measureFrom: "end",
    cooldown: { everyNth: 15, gapMs: [6000, 12000] },
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[codeforces] Request ${count}: waiting ${seconds}s`);
      }
    },
  },

  /**
   * Cloudflare answers a challenge two ways, and both must be caught: a 403
   * with no useful body, or a 200 whose body is the interstitial. Measured
   * live — `cf-mitigated: challenge`, a page of scripts pointing at
   * challenges.cloudflare.com — so this is not a heuristic.
   *
   * Flagged rather than thrown bare. `contest-status.js` defines
   * `sourceUnreachable` as exactly this ("we failed to ask — network, 403,
   * anything"), but until the flag existed nothing converted the throw into
   * that status, so a challenge failed the add outright and was never retried.
   */
  refusal({ response, body }) {
    if (response.status !== 403 && !body.includes("Just a moment")) return null;
    return Object.assign(new Error(BLOCKED), { isSourceUnreachable: true });
  },
});

export const CodeforcesHttp = {
  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Document>} the parsed page, ready for `dom-readers/`
   */
  getDocument: (url, options = {}) => client.getDocument(url, options),
};

/**
 * Test seam. Takes a spacing rather than always pinning zero: a test that wants
 * to prove this module *is* paced needs a gap it can observe, and one that only
 * wants the requests needs it out of the way.
 */
export function resetHttpState(spacingMs = 0) {
  client.reset(spacingMs);
}
