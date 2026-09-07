/**
 * AtCoder's `/contests/<id>/submissions` page, filtered to one user.
 *
 * ## Why the verdict is re-read rather than trusted
 *
 * The page is requested with `f.Status=AC`, so in principle every row is an
 * accepted submission. This reads the verdict cell anyway. If AtCoder ever
 * renames that filter parameter, the request still returns 200 with the
 * *unfiltered* list — and trusting the query string would then mark every
 * attempted problem solved. `solved` is sticky and never cleared, so that
 * mistake is permanent and silent. Reading the verdict costs nothing and makes
 * the filter an optimisation rather than a load-bearing assumption.
 */
import { Scraper } from "../../scraper.js";

/** AtCoder prints the verdict as a short label; only an exact "AC" counts. */
const ACCEPTED = "AC";

export class SubmissionsPage extends Scraper {
  static selectors = {
    table: "table",
    row: "tbody tr",
    cell: "td",
    verdictLabel: "span",
    taskLink: 'a[href*="/tasks/"]',
    // AtCoder paginates in a `<ul class="pagination">` whose links carry page=N.
    pageLink: ".pagination a[href]",
  };

  static #TASK_HREF = /\/contests\/[^/]+\/tasks\/([^/?#]+)/;

  /**
   * @returns {{acceptedTaskIds: Set<string>, pageCount: number}|null}
   *   `null` when there is no submissions table — a layout change. Distinct
   *   from an empty set, which means the table is present and you have solved
   *   nothing in this contest. Conflating those would let a broken selector
   *   read as "no solves", and `solved` being sticky makes that permanent.
   */
  static scrape(doc) {
    const table = this.first(doc, this.selectors.table);
    if (!table) return null;

    return {
      acceptedTaskIds: this.#accepted(table),
      pageCount: this.#pageCount(doc),
    };
  }

  /**
   * Identity is the task id from the row's link, the same rule `tasks.js`
   * follows, and what lets one solve clear a problem from every contest that
   * reruns it.
   */
  static #accepted(table) {
    const accepted = new Set();

    for (const row of this.all(table, this.selectors.row)) {
      const link = this.first(row, this.selectors.taskLink);
      const match = (link?.getAttribute("href") ?? "").match(this.#TASK_HREF);
      if (!match) continue;
      if (!this.#isAccepted(row)) continue;

      accepted.add(match[1]);
    }

    return accepted;
  }

  /**
   * A row counts only if some cell says exactly "AC".
   *
   * Exact, not `includes`: "WA" and "TLE" are distinct verdicts, but so is
   * "AC × 3" in some views, and a substring test would also match the word
   * inside a language name.
   */
  static #isAccepted(row) {
    return this.all(row, this.selectors.cell).some((cell) => {
      const label = this.first(cell, this.selectors.verdictLabel);
      return this.text(label ?? cell) === ACCEPTED;
    });
  }

  /**
   * Absent pagination means a single page, which is the common case: filtered
   * to one user and to accepted submissions, a contest rarely exceeds one.
   *
   * @returns {number} at least 1.
   */
  static #pageCount(doc) {
    const pages = this.all(doc, this.selectors.pageLink)
      .map((link) => Number(link.getAttribute("href")?.match(/[?&]page=(\d+)/)?.[1]))
      .filter((page) => Number.isInteger(page) && page > 0);

    return pages.length > 0 ? Math.max(...pages) : 1;
  }
}
