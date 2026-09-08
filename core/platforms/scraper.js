/**
 * What a scraper is.
 *
 * > A scraper owns **one site's pages**. It holds the client those reads go
 * > through, fetches a page as a `Document`, and parses it into the facts a
 * > platform decides over.
 *
 * The second of the two ways data arrives; `Api` in `api.js` is the first.
 * A site has a `scraper.js` only where it reads a page at all — Codeforces
 * reads one, for a gym whose standings the setter hid; AtCoder has no API
 * and reads three; CodeChef reads its dashboard for who is signed in.
 *
 * ## The two halves of a page
 *
 * A page method fetches and parses: `tasks(id)` fetches `/contests/<id>/tasks`
 * and returns its name, times and problems. What it parses *with* is a pure
 * `parse*` function exported beside it, taking a `Document` and returning
 * facts or `null`, with its selectors declared in one block above it. That
 * split is what lets every parser run in Node against `linkedom` with no
 * network stack, which is most of the coverage these sites have.
 * `module-boundaries.test.js` pins that a `parse*` export never fetches.
 *
 * ## Two rules that are easy to lose
 *
 * **A parser returns `null`, never a plausible default.** The Codeforces
 * version of this was written after `parseInt(...) || 0` turned an unreadable
 * cell into a zero — which broke nothing visibly and produced *confidently
 * wrong ratings* that were stored and sorted like real ones.
 *
 * **A null page and a null field mean different things.** A parser returning
 * null means "this is not the page I know" — a layout change, and the platform
 * should refuse loudly. A null *field* means the page rendered and the value
 * is not on it, which is a fact the platform can act on. Flattening the two
 * loses exactly the information that tells a broken selector from an empty
 * profile.
 *
 * The string→`Document` step happens once, in `site-client.js#getDocument`,
 * with the browser's real `DOMParser`; nothing here parses a string.
 */
export class Scraper {
  /**
   * @param {object} options
   * @param {object} options.client - a `services/site-client.js` client,
   *   built in the subclass's own file and routed through a tab on the site,
   *   so a page is read as the signed-in user.
   * @param {string} [options.origin] - prefix for relative paths.
   */
  constructor({ client, origin = "" }) {
    if (!client) throw new Error(`${this.constructor.name} was built with no client.`);
    this.client = client;
    this.origin = origin;
  }

  /**
   * The instance a session carries. No site needs credentials to read a
   * page — the browser's session is what a page read carries — so every
   * subclass returns its singleton.
   *
   * @abstract
   */
  static fromSettings(_values) {
    throw new Error(`${this.name} must implement static fromSettings()`);
  }

  /**
   * Test seam, reached through `Platform#reset`: resets the page client's
   * pacing between cases. See `Api.reset` for why it takes a spacing.
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

  /** @returns {Promise<Document>} the page, ready for a `parse*` function. */
  document(path, init) {
    return this.client.getDocument(this.url(path), init);
  }

  /** The instance half of the seam above. */
  reset(spacingMs = 0) {
    this.client.reset(spacingMs);
  }
}

// ── the reading vocabulary every parser shares ──────────────────────────

/**
 * First match wins, over one selector or an ordered chain of them.
 *
 * A chain is an ordered fallback, where the earlier entries are the ones we
 * actually expect and the later ones are what the page degrades to.
 *
 * @returns {Element|null}
 */
export function first(root, selector) {
  for (const one of [selector].flat()) {
    const found = root?.querySelector(one);
    if (found) return found;
  }
  return null;
}

/** All matches for one selector, as a real array. */
export function all(root, selector) {
  return [...(root?.querySelectorAll(selector) ?? [])];
}

/**
 * An element's text, whitespace collapsed.
 *
 * `null` rather than `""` for an empty one: an empty string is falsy in some
 * places and truthy-looking in others, and every caller here wants to know
 * "was there anything" rather than "what was the string".
 *
 * @returns {string|null}
 */
export function text(element) {
  const raw = element?.innerText ?? element?.textContent;
  return raw?.replace(/\s+/g, " ").trim() || null;
}
