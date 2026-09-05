/**
 * Every selector and parsing rule for AtCoder's submissions list.
 *
 * Quarantined for the same reason as `tasks-dom.js` and
 * `codeforces/standings-dom.js`: a layout change should be a one-file fix.
 * Takes a `Document`, never a string, so nothing here parses.
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

/** AtCoder prints the verdict as a short label; only an exact "AC" counts. */
const ACCEPTED = "AC";

/**
 * Task ids with an accepted submission on this page.
 *
 * Identity is the task id from the row's link, never the displayed index — the
 * same rule `tasks-dom.js` follows, and what lets one solve clear a problem from
 * every contest that reruns it.
 *
 * @returns {Set<string>|null} `null` when no submissions table can be found —
 *   distinct from an empty set, which means the table is present and you have no
 *   accepted submissions in this contest. Those two must not be conflated: one
 *   is a layout change, the other is a fact.
 */
export function parseAcceptedTaskIds(doc) {
  const table = doc.querySelector("table");
  if (!table) return null;

  const rows = [...table.querySelectorAll("tbody tr")];
  const accepted = new Set();

  for (const row of rows) {
    const link = row.querySelector('a[href*="/tasks/"]');
    const match = link?.getAttribute("href")?.match(/\/contests\/[^/]+\/tasks\/([^/?#]+)/);
    if (!match) continue;

    if (!hasAcceptedVerdict(row)) continue;
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
function hasAcceptedVerdict(row) {
  const cells = [...row.querySelectorAll("td")];
  return cells.some((cell) => {
    const label = cell.querySelector("span");
    const text = (label ?? cell).textContent?.trim();
    return text === ACCEPTED;
  });
}

/**
 * How many pages the list runs to.
 *
 * AtCoder paginates in a `<ul class="pagination">` whose links carry `page=N`.
 * Absent pagination means a single page, which is the common case: filtered to
 * one user and to accepted submissions, a contest rarely exceeds one.
 *
 * @returns {number} at least 1.
 */
export function parsePageCount(doc) {
  const pages = [...doc.querySelectorAll(".pagination a[href]")]
    .map((link) => Number(link.getAttribute("href")?.match(/[?&]page=(\d+)/)?.[1]))
    .filter((page) => Number.isInteger(page) && page > 0);

  return pages.length > 0 ? Math.max(...pages) : 1;
}
