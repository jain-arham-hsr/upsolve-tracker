/**
 * One paced, refusal-aware client, configured per site.
 *
 * Every platform was doing the same four things around `createPacer`: pace the
 * request, fetch it, decide whether the site *refused* rather than answered,
 * and hand back text or JSON. Only two of those vary — the pacing numbers and
 * what refusal looks like — so only those are parameters.
 *
 * ## Why this stopped being a tidiness exercise
 *
 * A refusal is not an HTTP failure, and every site expresses it differently:
 * Codeforces answers a Cloudflare challenge with a 403 *or* a 200 whose body is
 * an interstitial; AtCoder redirects to `/login` and returns a perfectly
 * healthy 200 containing a sign-in form. Both parse as "no data" if you only
 * look at `response.ok`, and both are silent in the worst way — an empty
 * result is indistinguishable from having nothing to report, and `solved` is
 * sticky, so a swallowed refusal strands a queue permanently.
 *
 * The `refusal` hook is where each site says what its own "no" looks like, and
 * it is the only place that knowledge lives.
 *
 * ## The transport seam
 *
 * `transport` exists because of a measured problem, not a hypothetical one. A
 * `fetch` from the extension's own origin is **cross-site**, so Chrome withholds
 * cookies whose `SameSite` is unset — the default. Measured against Codeforces:
 * the panel's request arrives unauthenticated and is challenged, while the same
 * request issued from inside a page on that site carries the session and
 * succeeds. Routing through a page is therefore the difference between reading
 * a private gym and not, on every platform at once — which is precisely why it
 * must not be implemented three times.
 */
import { createPacer } from "./request-pacer.js";

/**
 * @param {object} options
 * @param {object} options.pacer - passed straight to `createPacer`.
 * @param {(context: {response: Response, body: string, url: string}) => Error|null} options.refusal
 *   Returns the error to throw when the site refused, or null when it answered.
 *   **Throwing rather than returning empty is the point**; see above.
 * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl]
 *   How the request is issued; passed straight through to the pacer so the
 *   delays apply either way. Defaults to a direct fetch. See `page-transport.js`
 *   for the routed one, and why it is needed.
 */
export function createSiteClient({ pacer, refusal, fetchImpl = null }) {
  const send = createPacer({ ...pacer, fetchImpl });

  async function read(url, init) {
    const response = await send(url, init);
    // Always read the body: a refusal is as often in the body as in the status,
    // and a caller that only wanted JSON still needs the text to be checked.
    const body = await response.text();

    const refused = refusal({ response, body, url });
    if (refused) throw refused;

    return { response, body };
  }

  return {
    /** @returns {Promise<string>} the response body. */
    async get(url, init = {}) {
      return (await read(url, init)).body;
    },

    /** @returns {Promise<any>} the parsed body. */
    async getJson(url, init = {}) {
      const { body, response } = await read(url, init);
      try {
        return JSON.parse(body);
      } catch {
        // A site that answers JSON with HTML has refused in a way its own
        // `refusal` hook did not recognise. Say so, rather than surfacing a
        // parser error that names nothing useful.
        throw new Error(
          `${new URL(url).host} answered ${response.status} with something that is not JSON.`,
        );
      }
    },

    /** Test seam. Production always uses the configured spacing. */
    setSpacing: (ms) => send.setSpacing(ms),

    /** Test seam: resets pacing between cases. */
    reset(ms) {
      send.reset();
      if (ms !== undefined) send.setSpacing(ms);
    },
  };
}
