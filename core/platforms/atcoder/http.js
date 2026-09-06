/**
 * AtCoder's pages, and recognising when AtCoder refuses.
 *
 * Pacing and fetching come from `services/site-client.js`. What stays here is
 * AtCoder's own: its spacing, and the fact that its refusal looks nothing like
 * anyone else's.
 *
 * **AtCoder refuses by succeeding.** `fetch` follows the 302 transparently, so a
 * signed-out request arrives as a perfectly healthy 200 whose body is the
 * sign-in form. Parsing that yields no submissions — indistinguishable from
 * having solved nothing — and `solved` is sticky, so a swallowed refusal would
 * look like a healthy sync while quietly stranding the queue. The same trap
 * CodeChef's signed-out listing sets, caught the same way: by checking where we
 * actually landed rather than what the status says.
 */
import { createSiteClient } from "../../services/site-client.js";
import { atcoder } from "./descriptor.js";

const MIN_GAP_MS = 1500;

/** Thrown rather than returned, so no caller can mistake it for "nothing found". */
export class NotSignedInError extends Error {
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

const client = createSiteClient({
  // Both the submissions list and standings/json are login-gated, and a
  // cross-site request carries no cookies — so without a tab open on atcoder.jp
  // those two answer with a sign-in form, and the refusal hook says so.
  site: atcoder,
  pacer: { gapMs: MIN_GAP_MS },

  refusal({ response, url }) {
    if (new URL(response.url).pathname === "/login") return new NotSignedInError(url);
    if (response.ok) return null;

    // The status rides along so a caller can say something better than this:
    // `identity.js` turns a 404 into "AtCoder has no user X", which is the
    // difference between a typo and an outage.
    return Object.assign(
      new Error(`AtCoder returned ${response.status} for ${new URL(url).pathname}.`),
      { status: response.status },
    );
  },
});

export const getPage = (url) => client.get(url);
export const getDocument = (url) => client.getDocument(url);
export const getJson = (url) => client.getJson(url);

/** Test seam. Production always uses MIN_GAP_MS. */
export const setRequestSpacing = (ms) => client.setSpacing(ms);

/** Test seam: resets pacing between cases. */
export const resetHttpState = (ms = MIN_GAP_MS) => client.reset(ms);
