/**
 * What an API is.
 *
 * > An API owns **one site's JSON**. It holds the client those reads go
 * > through, joins paths onto the site's origin, fetches a route and reads
 * > what came back into the facts a platform decides over.
 *
 * Data reaches this extension two ways: as JSON from a site's API, or as
 * HTML from a page it scrapes. One `api.js` per site is the first; `Scraper`
 * in `scraper.js` is the second. Each owns its own fetching and its own
 * reading, and hands finished facts to `platform.js`, which only decides.
 *
 * ## The two halves of a route
 *
 * A route method fetches and reads: `standings(id)` returns the payload,
 * `accepted(handle)` the accepted pairs. What it reads *with* is a pure
 * function exported beside it — `problemsFrom`, `summariseSubmissions`,
 * `parseDifficulty` — taking a payload and returning facts, so every reading
 * runs in Node against a fixture with no network. `module-boundaries.test.js`
 * pins that an exported `parse*` never fetches.
 *
 * ## Instances
 *
 * An API holds a client, sometimes a memo, and on Codeforces a **key pair**:
 * `Platform#buildSession` builds one per credential set, and Settings builds
 * a second to check credentials you have typed but not saved. A site with no
 * credentials exports a singleton instead, so its callers never write `new`.
 *
 * ## What it does not do
 *
 * It never decides. A route answers with a payload, a null for "not the shape
 * I know", or a throw for "I could not ask" — and what each of those means
 * for the add is the platform's call, which is why an `api.js` never imports
 * `contest-status.js`.
 */
import { withTtlCache } from "../services/ttl-cache.js";

export class Api {
  /**
   * @param {object} options
   * @param {object} options.client - a `services/site-client.js` client,
   *   built in the subclass's own file. Codeforces' signed API passes a
   *   direct `fetchImpl` and a no-op `refusal`, because it works anonymously
   *   and expresses failure in the payload rather than the transport.
   * @param {string} [options.origin] - prefix for relative paths.
   */
  constructor({ client, origin = "" }) {
    if (!client) throw new Error(`${this.constructor.name} was built with no client.`);
    this.client = client;
    this.origin = origin;
  }

  /**
   * The instance a session carries, from a slug → value map of settings.
   * A site with credentials builds one; a site without returns its singleton.
   *
   * @abstract
   */
  static fromSettings(_values) {
    throw new Error(`${this.name} must implement static fromSettings()`);
  }

  /**
   * Test seam, reached through `Platform#reset`: resets the site's client and
   * every memo, so one case's cached payload never answers the next case's
   * question. Takes a spacing rather than always pinning zero, so a test that
   * proves a route *is* paced has a gap it can observe.
   *
   * @abstract
   */
  static reset(_spacingMs = 0) {
    throw new Error(`${this.name} must implement static reset()`);
  }

  /** Absolute URLs pass through, so a caller may hand over either. */
  url(path) {
    return /^https?:\/\//i.test(path) ? path : `${this.origin}${path}`;
  }

  /** @returns {Promise<any>} the parsed body. */
  json(path, init) {
    return this.client.getJson(this.url(path), init);
  }

  /**
   * A short-lived memo, for a payload one add reads two or three times.
   *
   * Deliberately short everywhere it is used: paying twice within one add is
   * waste, but a stale answer outliving the add is worse than a second
   * request. See `services/ttl-cache.js` — this only wires it to the instance
   * so `reset` can clear it.
   */
  memo(load, { ttlMs }) {
    const cached = withTtlCache(load, { ttlMs });
    (this.#memos ??= []).push(cached);
    return cached;
  }

  #memos;

  /** The instance half of the seam above: this client, and this instance's memos. */
  reset(spacingMs = 0) {
    this.client.reset(spacingMs);
    for (const memo of this.#memos ?? []) memo.clear();
  }
}
