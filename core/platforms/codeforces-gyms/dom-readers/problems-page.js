/**
 * Codeforces' `/gym/<id>` problems page — the last HTML this extension reads.
 *
 * It is read for one kind of contest only: a gym whose standings the setter
 * hid, which answers `FAILED` to `contest.standings` and renders no standings
 * table. Everything else Codeforces serves comes from the JSON API.
 *
 * This file was called `standings-dom.js` long after the standings scrape was
 * deleted, holding no standings parsing at all, and nothing noticed — because
 * nothing tied a reader's name to the page it reads. Naming it for the page is
 * what makes the next such drift visible.
 */
import { DomReader } from "../../dom-reader.js";

/** Shared by both problem readers so their fallbacks can't drift. */
const UNKNOWN_PROBLEM = "Unknown Problem";

export class ProblemsPage extends DomReader {
  static selectors = {
    problemsTable: "table.problems",
    problemRow: "tr",
    indexLink: "td.id a",
    problemLink: 'a[href*="/problem/"]',

    /**
     * The contest name lives in the sidebar box's header link, whose href is
     * the contest root — **not** in a `.caption`.
     *
     * The standings reader's chain was `.contest-name` → `.caption` →
     * `<title>`. A problems page has no `.contest-name`, and its first
     * `.caption` is the "→ About Contest" sidebox heading — so pointing that
     * chain here filed the first real gym in the queue under the name
     * **"→ About Contest"**. That reader is gone; the warning stays.
     */
    contestName: ["#sidebar .rtable th a", "#sidebar .rtable th"],
    title: "title",

    /** "Finished", "Running", "Before start" — the sidebar's phase label. */
    contestPhase: ".contest-state-phase",
  };

  /**
   * @param {Document} doc
   * @param {{contestPath?: string}} [options] - e.g. "/gym/712373". The sidebar
   *   header links to exactly this, which is the most specific way to find the
   *   name; without it the chain above still answers.
   * @returns {{contestName: string|null,
   *            problems: Array<{index: string, name: string, url: string}>,
   *            finished: boolean|null}|null}
   *   `null` when there is no problems table, or a row has no index — either is
   *   a layout change, and the caller refuses loudly rather than storing a
   *   contest that merely looks short.
   */
  static read(doc, { contestPath = null } = {}) {
    const problems = this.#problems(doc);
    if (problems === null) return null;

    return {
      contestName: this.#name(doc, contestPath),
      problems,
      finished: this.#finished(doc),
    };
  }

  /**
   * Null rather than `Contest <id>` when unreadable: a display fallback is the
   * caller's to choose, and this folder's rule is that a reader never invents a
   * plausible value. Note the name is read once at add time and never re-read,
   * so a contest added under the wrong name keeps it until removed and re-added.
   */
  static #name(doc, contestPath) {
    if (contestPath) {
      const linked = this.text(this.first(doc, `#sidebar a[href="${contestPath}"]`));
      if (linked) return linked;
    }

    const fromSidebar = this.text(this.first(doc, this.selectors.contestName));
    if (fromSidebar) return fromSidebar;

    // Codeforces titles pages "<section> - <contest> - Codeforces". Dropping the
    // suffix is worth doing; guessing at the section prefix is not, since a
    // slightly long name still reads correctly and a wrong split does not.
    const title = this.text(this.first(doc, this.selectors.title));
    return title?.replace(/\s*-\s*Codeforces\s*$/i, "").trim() || null;
  }

  /**
   * The definitive problem list. Deriving one from the submissions instead
   * would silently omit any problem nobody attempted, so this page is the
   * authority on what a contest contains.
   */
  static #problems(doc) {
    const table = this.first(doc, this.selectors.problemsTable);
    if (!table) return null;

    const problems = [];

    for (const row of this.all(table, this.selectors.problemRow)) {
      // The header row has no id cell, so this skips it without matching text.
      const indexLink = this.first(row, this.selectors.indexLink);
      if (!indexLink) continue;

      const index = this.text(indexLink);
      const href = indexLink.getAttribute("href");

      // An indexless problem would silently mismatch every later lookup by
      // index, so the whole page is refused rather than the one row skipped.
      if (!index || !href) return null;

      // The name is the row's *other* link to the same problem. Matching on
      // column position would break the first time a column is added.
      const nameLink = this.all(row, this.selectors.problemLink).find(
        (link) => link !== indexLink && this.text(link),
      );

      problems.push({
        index,
        name: this.text(nameLink) ?? UNKNOWN_PROBLEM,
        url: `https://codeforces.com${href}`,
      });
    }

    return problems.length > 0 ? problems : null;
  }

  /**
   * Whether the contest has finished, read off the page rather than the API.
   *
   * The hidden-standings path has no `contest.standings` to ask, and adding a
   * contest mid-flight is not harmless: the estimator would fit partial solve
   * counts, and on a gym nothing ever corrects the result.
   *
   * @returns {boolean|null} null when the page doesn't say, which callers treat
   *   as "proceed" — refusing on an unreadable label would make a contest
   *   unaddable for a reason we cannot even state.
   */
  static #finished(doc) {
    const label = this.text(this.first(doc, this.selectors.contestPhase));
    if (!label) return null;
    return /finished/i.test(label);
  }
}
