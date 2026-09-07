/**
 * CodeChef's `/dashboard`, and the bootstrap object its shell carries.
 *
 * CodeChef is an SPA — its pages are a ~4 KB shell with no content — so the
 * only thing worth reading is `window.codeChefUserData`, which holds the
 * signed-in handle and rating.
 *
 * **That global is a DOM node**, and this file used to pretend otherwise. It
 * lives inside a `<script>` element like any other markup, so the scraper
 * selects the script and reads its text. Slicing it out of the raw HTML string
 * was expedient, not necessary, and it was the only reason this file needed an
 * apology for sitting in `scrapers/`.
 *
 * Returns **null, never a plausible default**. A guessed handle would look like
 * a logged-in session and a guessed rating would silently mis-sort every
 * CodeChef problem in the queue.
 */
import { Scraper } from "../../scraper.js";

const MARKER = "window.codeChefUserData";

export class DashboardPage extends Scraper {
  static selectors = {
    // Every inline script; the one carrying the marker is picked by content,
    // since CodeChef gives it no id or class to select on.
    bootstrap: "script",
  };

  /**
   * @param {Document} doc
   * @returns {{username: string, rating: number|null}|null} null when signed
   *   out **or** when the shell no longer carries the object. The caller must
   *   tell both of those from "you have solved nothing".
   */
  static scrape(doc) {
    const user = this.#userData(doc)?.user;
    if (!user?.username) return null;

    const rating = Number.parseInt(user.rating, 10);
    return {
      username: user.username,
      rating: Number.isFinite(rating) ? rating : null,
    };
  }

  /** @returns {object|null} the whole bootstrap object. */
  static #userData(doc) {
    const source = this.all(doc, this.selectors.bootstrap)
      .map((node) => node.textContent ?? "")
      .find((text) => text.includes(MARKER));
    if (!source) return null;

    const start = source.indexOf("{", source.indexOf(MARKER));
    if (start === -1) return null;

    const json = this.#sliceBalancedObject(source, start);
    if (!json) return null;

    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Slices a balanced `{...}` from `start`, respecting strings and escapes.
   *
   * A non-greedy regex would stop at the first `};` inside a nested object or
   * inside a string, which is why this is hand-written.
   */
  static #sliceBalancedObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }
}
