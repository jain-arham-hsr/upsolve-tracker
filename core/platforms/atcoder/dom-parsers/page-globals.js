/**
 * The signed-in marker AtCoder renders into every page it serves.
 *
 * `var userScreenName = "…"` sits in an inline `<script>` that the site's own
 * code reads, alongside `contestScreenName` — which makes it a far steadier
 * signal than the navbar it is derived from.
 *
 * **It is a DOM node**, and this file used to pretend otherwise, regexing the
 * raw HTML string instead of selecting the script that holds it. That was the
 * only thing making this look like an exception in `dom-parsers/`; it is not
 * one. It is simply the parser for a fragment every page carries rather than
 * for one page, which is why it is named for the global instead.
 */
import { PageParser } from "../../page-parser.js";

export class PageGlobals extends PageParser {
  static selectors = {
    // No id or class to select on, so the script is picked by content.
    bootstrap: "script",
  };

  static #SCREEN_NAME = /\bvar\s+userScreenName\s*=\s*"([^"]*)"/;

  /**
   * Who the browser is signed in to AtCoder as.
   *
   * **Three outcomes, and conflating any two loses information:**
   *
   *   - a handle — signed in, and this is who as
   *   - `""` — the page rendered and nobody is signed in. A *fact*.
   *   - `null` — the marker is missing entirely, so the page shape changed and
   *     we do not know. Not the same as being signed out, and callers must not
   *     treat it as such: "we could not tell" is not evidence of anything.
   *
   * The page itself is never null here — every AtCoder page is a page this
   * parser knows, so a missing marker is a null *field*, not a wrong page.
   *
   * @param {Document} doc
   * @returns {{signedInAs: string|null}}
   */
  static parse(doc) {
    for (const script of this.all(doc, this.selectors.bootstrap)) {
      const match = this.#SCREEN_NAME.exec(script.textContent ?? "");
      if (match) return { signedInAs: match[1] };
    }
    return { signedInAs: null };
  }
}
