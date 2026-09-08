/**
 * How a request reaches CodeChef: one client, routed through a codechef.com tab
 * when one is open, since the site answers for whoever holds the session cookie.
 */
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

export const ORIGIN = "https://www.codechef.com";

/** Human-paced. A contest costs 1 + one request per problem. */
const GAP_MS = 1500;

export const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },

  /**
   * CodeChef's refusal is a 403 — its `/api/` routes are CSRF-gated, and
   * an unauthenticated or rate-limited caller gets one rather than an
   * error body.
   *
   * Note this is *not* how a signed-out session shows up: that returns a
   * perfectly good 200 with an empty solved list, which is why
   * `fetchAccepted` verifies identity rather than trusting the payload.
   * Two different refusals, and conflating them is how the platform became
   * untrackable once before.
   */
  refusal({ response, url }) {
    if (response.status === 403) {
      return new Error(
        "CodeChef refused the request. Open codechef.com in a tab, make sure you're " +
          "signed in, and try again.",
      );
    }
    if (response.ok) return null;
    return new Error(`CodeChef returned ${response.status} for ${new URL(url).pathname}.`);
  },
});
