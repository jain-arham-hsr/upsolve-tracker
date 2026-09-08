/**
 * How a request reaches AtCoder: one client, routed through an atcoder.jp tab
 * when one is open. Both the submissions list and standings/json are
 * login-gated, and a cross-site request carries no cookies — so without a tab
 * those two answer with a sign-in form, and `refusal` says so.
 */
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

export const ORIGIN = "https://atcoder.jp";
const GAP_MS = 1500;

/** Thrown rather than returned, so no caller can mistake it for "nothing found". */
class NotSignedInError extends Error {
  constructor(url) {
    super(
      "AtCoder is not signed in, so your submissions can't be read. " +
        "Open atcoder.jp, sign in, and refresh.",
    );
    this.name = "NotSignedInError";
    this.isNotSignedIn = true;
    this.url = url;
  }
}

export const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },

  /**
   * **AtCoder refuses by succeeding.** `fetch` follows the 302
   * transparently, so a signed-out request arrives as a healthy 200 whose
   * body is the sign-in form. Scraping that yields no submissions —
   * indistinguishable from having solved nothing — and `solved` is sticky,
   * so a swallowed refusal would look like a healthy sync while quietly
   * stranding the queue. Caught by checking where we actually landed
   * rather than what the status says.
   */
  refusal({ response, url }) {
    if (new URL(response.url).pathname === "/login") return new NotSignedInError(url);
    if (response.ok) return null;

    // The status rides along so a caller can say something better than
    // this: `identify` turns a 404 into "AtCoder has no user X", which
    // is the difference between a typo and an outage.
    return Object.assign(
      new Error(`AtCoder returned ${response.status} for ${new URL(url).pathname}.`),
      { status: response.status },
    );
  },
});
