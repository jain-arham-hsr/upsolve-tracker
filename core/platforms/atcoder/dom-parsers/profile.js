/**
 * AtCoder's `/users/<handle>` page.
 *
 * Server-rendered — not the SPA shell CodeChef serves — so the rating sits in a
 * plain labelled table cell. `robots.txt` disallows `/users/*​/history/`, but not
 * the profile itself, so this uses the permitted path.
 *
 * A substituted rating would not fail visibly; it would silently mis-sort every
 * AtCoder problem in the queue, because one rating shifts a whole platform's
 * block at once. Hence the folder rule: null, never a plausible default.
 */
import { PageParser } from "../../page-parser.js";

export class ProfilePage extends PageParser {
  static selectors = {
    header: "th",
  };

  /** Matched on exact label text, so "Highest Rating" doesn't win. */
  static #RATING_LABELS = ["Rating"];

  /**
   * @returns {{rating: number|null}} never null itself.
   *
   * The page has no load-bearing table whose absence would mean "this is not a
   * profile" — a profile with no rating row is a real profile belonging to
   * someone who has not competed. So the *field* is nullable and the page is
   * not, which is the distinction `page-parser.js` exists to keep.
   */
  static parse(doc) {
    return { rating: this.#rating(doc) };
  }

  static #rating(doc) {
    if (!doc) return null;

    for (const label of this.#RATING_LABELS) {
      const cell = this.#cellFor(doc, label);
      if (cell === null) continue;

      const value = Number.parseInt(cell.replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  /**
   * The `<td>` paired with a `<th>` whose text is exactly `label`.
   *
   * Exact match matters: the profile table also has "Highest Rating", "Rated
   * Matches" and "Rank", and a substring match would take whichever came first.
   */
  static #cellFor(doc, label) {
    for (const header of this.all(doc, this.selectors.header)) {
      if (this.text(header) !== label) continue;

      const cell = header.nextElementSibling;
      if (cell?.tagName?.toLowerCase() === "td") return this.text(cell);
    }
    return null;
  }
}
