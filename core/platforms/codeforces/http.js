/**
 * Fetching Codeforces HTML, and recognising when Codeforces refuses.
 *
 * This is what is left of `services/http-client.js` after the generic half —
 * jitter, periodic cooldown, queueing — moved into `services/request-pacer.js`.
 * What remains is Codeforces' own: it is the only source in this extension
 * behind Cloudflare, the only one whose session cookie has to ride along, and
 * the only one whose throttling numbers were tuned against a live site.
 *
 * **Do not shorten these delays when optimising.** Even sampled, adding a
 * contest issues tens of requests, and they are what keeps the extension from
 * being blocked. `measureFrom: "end"` is load-bearing for the same reason: it
 * waits the full gap after each request finishes, rather than letting a slow
 * page count towards the next gap. `tests/request-pacer.test.js` fails if that
 * is collapsed.
 */
import { createPacer } from "../../services/request-pacer.js";

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const paced = createPacer({
  gapMs: [1000, 2500],
  measureFrom: "end",
  cooldown: { everyNth: 15, gapMs: [6000, 12000] },
  // The user's Codeforces session cookie, without which a private gym's
  // standings are invisible.
  credentials: "include",
  onWait: ({ count, ms, isCooldown }) => {
    const seconds = (ms / 1000).toFixed(2);
    if (isCooldown) {
      // `info`, not `warn`. chrome://extensions collects warnings alongside
      // errors, so a normal add used to file a row there every 15 requests —
      // the same trap the waiting-contest logging was fixed for.
      console.info(`[codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
    } else {
      console.log(`[codeforces] Request ${count}: waiting ${seconds}s`);
    }
  },
});

export const CodeforcesHttp = {
  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<string>} the response body as text
   */
  async get(url, options = {}) {
    const response = await paced(url, options);

    // Cloudflare answers a challenge with a 403 and no useful body.
    if (response.status === 403) throw new Error(BLOCKED);

    const text = await response.text();

    // And sometimes with a 200 carrying the interstitial instead.
    if (text.includes("Just a moment")) throw new Error(BLOCKED);

    return text;
  },
};

/** Test seam, matching `codechef/api.js` and `atcoder/problems-api.js`. */
export function resetHttpState() {
  paced.reset();
  paced.setSpacing(0);
}
