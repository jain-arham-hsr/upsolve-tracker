/**
 * What a DOM reader is.
 *
 * > A reader owns **one page**. Given that page it returns the facts that page
 * > carries, or `null` when the page is not the shape it knows. It declares
 * > every selector it uses in one block. It fetches nothing.
 *
 * `dom-readers/` existed before that sentence did, which is why the files in it
 * had drifted into six different shapes: some exported one extractor, some
 * three, one kept its selectors in a block and the rest scattered them through
 * function bodies. Asked what they had in common the honest answer was "two
 * helpers" — the symptom of a category named before it was defined.
 *
 * ## The assembly used to happen in the wrong file
 *
 * `scraping.js` fetched a page and then *composed its facts itself*, calling
 * three or four extractors and deciding which failure meant the whole page was
 * unusable. That put page knowledge in the fetcher — including, verbatim, the
 * comment "Not findContestName: this page names the contest somewhere else",
 * which is a reader's business by any reading. One `read` per page moves that
 * back, and leaves `scraping.js` doing only what its name says.
 *
 * ## Statics, not instances
 *
 * Parsing is pure, so there is no instance state worth having and no reason to
 * make every caller write `new`. Static inheritance carries `selectors` and the
 * helpers perfectly well: inside a static method `this` is the subclass, so
 * `this.first(...)` and `this.selectors` resolve to the reader being run.
 *
 * ## Two rules that are easy to lose
 *
 * **Extractors return `null`, never a plausible default.** The Codeforces
 * version of this was written after `parseInt(...) || 0` turned an unreadable
 * cell into a zero — which broke nothing visibly and produced *confidently
 * wrong ratings* that were stored and sorted like real ones.
 *
 * **A null page and a null field mean different things.** `parse` returning
 * null means "this is not the page I know" — a layout change, and the caller
 * should refuse loudly. A null *field* means the page rendered and the value
 * is not on it, which is a fact the caller can act on. Flattening the two loses
 * exactly the information that tells a broken selector from an empty profile.
 */
export class DomReader {
  /**
   * Every selector this page needs, in one block, so a layout change is one
   * block to edit rather than a hunt through function bodies.
   *
   * A value may be a string or an array of strings; an array is an ordered
   * fallback chain for `first`, where the earlier entries are the ones we
   * actually expect and the later ones are what the page degrades to.
   *
   * @abstract
   */
  static selectors = {};

  /**
   * The facts this page carries.
   *
   * @abstract
   * @param {Document} doc
   * @returns {object|null} null only when the page is not the one this reader
   *   knows — see the header for why that is not the same as a null field.
   */
  static read(doc) {
    throw new Error(`${this.name} must implement read()`);
  }

  /**
   * First match wins, over one selector or an ordered chain of them.
   *
   * @returns {Element|null}
   */
  static first(root, selector) {
    for (const one of [selector].flat()) {
      const found = root?.querySelector(one);
      if (found) return found;
    }
    return null;
  }

  /** All matches for one selector, as a real array. */
  static all(root, selector) {
    return [...(root?.querySelectorAll(selector) ?? [])];
  }

  /**
   * An element's text, whitespace collapsed.
   *
   * `null` rather than `""` for an empty one: an empty string is falsy in some
   * places and truthy-looking in others, and the callers here all want to know
   * "was there anything" rather than "what was the string".
   *
   * @returns {string|null}
   */
  static text(element) {
    const raw = element?.innerText ?? element?.textContent;
    return raw?.replace(/\s+/g, " ").trim() || null;
  }
}
