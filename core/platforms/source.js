/**
 * What a source is.
 *
 * > A source owns **one site's reads**. It holds the client those reads go
 * > through, joins paths onto an origin, and hands back text, JSON or a
 * > `Document`. Endpoints are its methods; what an answer's fields mean —
 * > a sentinel rating, an accepted status — are its statics.
 *
 * One subclass per platform, in `sources.js`, and nothing else exported from
 * that file but at most a singleton. Every read of a site goes through the
 * `sources` a session carries, which is the one seam a test injects a fake
 * through.
 *
 * ## Instances, where `Scraper` is statics-only
 *
 * The asymmetry is deliberate and worth knowing before "fixing" it. Scraping is
 * pure — a `Document` in, facts out — so a scraper needs no state and no `new`.
 * A source is the opposite: it holds a client, sometimes a TTL cache, and on
 * Codeforces a **key pair**. `Platform#buildSession` builds one per credential
 * set, Settings builds a second to check credentials you have typed but not
 * saved, and both live on the session. Statics could not express that.
 *
 * Platforms with no credentials export a singleton instead, so their callers
 * still never write `new`.
 *
 * ## What it does not do
 *
 * It does not know *which* endpoints exist, how many requests one takes, or
 * what a bad answer means — those are the subclass's, and they differ per route
 * even on one site. AtCoder's tasks route returns null so a contest waits;
 * its submissions route throws, because `solved` is sticky and a silent empty
 * would strand the queue permanently. A client cannot make that call.
 */
import { withTtlCache } from "../services/ttl-cache.js";

export class Source {
  /**
   * @param {object} options
   * @param {object} options.client - a `services/site-client.js` client. Every
   *   platform uses one, including Codeforces' signed API: it passes a direct
   *   `fetchImpl` and a no-op `refusal`, because it works anonymously and
   *   expresses failure in the payload rather than the transport.
   * @param {string} [options.origin] - prefix for relative paths.
   */
  constructor({ client, origin = "" }) {
    if (!client) throw new Error(`${this.constructor.name} was built with no client.`);
    this.client = client;
    this.origin = origin;
  }

  /** Absolute URLs pass through, so a caller may hand over either. */
  url(path) {
    return /^https?:\/\//i.test(path) ? path : `${this.origin}${path}`;
  }

  /** @returns {Promise<string>} */
  text(path, init) {
    return this.client.get(this.url(path), init);
  }

  /** @returns {Promise<any>} */
  json(path, init) {
    return this.client.getJson(this.url(path), init);
  }

  /** @returns {Promise<Document>} ready for the platform's `scrapers/`. */
  document(path, init) {
    return this.client.getDocument(this.url(path), init);
  }

  /**
   * A short-lived memo, for a payload one add reads two or three times.
   *
   * Deliberately short everywhere it is used: paying twice within one add is
   * waste, but a stale answer outliving the add is worse than a second request.
   * See `services/ttl-cache.js` — this only wires it to the instance so `reset`
   * can clear it.
   */
  memo(load, { ttlMs }) {
    const cached = withTtlCache(load, { ttlMs });
    (this.#memos ??= []).push(cached);
    return cached;
  }

  #memos;

  /**
   * Test seam, reached through `Platform#reset`. Takes a spacing rather than
   * always pinning zero: a test proving this module *is* paced needs a gap it
   * can observe, and one that only wants the requests needs it out of the way.
   */
  reset(spacingMs = 0) {
    this.client.reset(spacingMs);
    for (const memo of this.#memos ?? []) memo.clear();
  }
}
