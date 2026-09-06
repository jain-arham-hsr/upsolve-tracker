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
 *
 * **A caller names its `site` and the routing follows**, rather than assembling
 * `createPageFetch({ matchPatterns: descriptor.hostPermissions })` itself. Three
 * platforms wrote that line identically, and the mistake it invites is quiet:
 * hand it the *wrong* descriptor and every request still succeeds, because a
 * site with no matching tab falls back to a direct fetch. It just stops carrying
 * the session, so only the session-gated routes fail — and they fail the same
 * way they do when the user simply has no tab open, which is a supported state
 * that reports itself politely. Deriving it from the one descriptor the client
 * already belongs to removes the chance.
 */
import { createPacer } from "./request-pacer.js";
import { createPageFetch } from "./page-transport.js";

/**
 * @param {object} options
 * @param {{hostPermissions: string[]}} [options.site] - the platform descriptor
 *   this client speaks to. Its `hostPermissions` are already match patterns, so
 *   they are what routes a request through a tab on that site.
 * @param {object} options.pacer - passed straight to `createPacer`. Defaults
 *   `credentials: "include"`, since a client routed through a page is there to
 *   act as the signed-in user; a caller may still override it.
 * @param {(context: {response: Response, body: string, url: string}) => Error|null} options.refusal
 *   Returns the error to throw when the site refused, or null when it answered.
 *   **Throwing rather than returning empty is the point**; see above.
 * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl]
 *   How the request is issued, in place of `site`'s routing. This is the test
 *   seam; production names a `site`.
 */
export function createSiteClient({ site = null, pacer, refusal, fetchImpl = null }) {
  // Neither means a direct, cookie-less fetch — which works for every public
  // route and quietly fails only the session-gated ones. Refusing here is what
  // keeps that from being something you discover from a user report.
  if (!site && !fetchImpl) {
    throw new Error("createSiteClient needs a `site` to route through, or a `fetchImpl` to stand in for one.");
  }

  const send = createPacer({
    credentials: "include",
    ...pacer,
    fetchImpl: fetchImpl ?? createPageFetch({ matchPatterns: site.hostPermissions }),
  });

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

    /**
     * @returns {Promise<Document>} the body, parsed.
     *
     * The third return type, beside `get` and `getJson`, and between them they
     * cover what the consumers want: a `Document` for everything in a platform's
     * `dom-readers/`, an object for JSON, a raw string for whatever wants neither.
     * Having it here is what keeps `DOMParser` out of platform code, where it was
     * once spelled out beside each fetch — `module-boundaries.test.js` asserts it
     * is constructed in this file and nowhere else.
     */
    async getDocument(url, init = {}) {
      const { body } = await read(url, init);
      return new DOMParser().parseFromString(body, "text/html");
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
