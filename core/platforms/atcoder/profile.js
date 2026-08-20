/**
 * Reads a rating off an AtCoder profile page.
 *
 * This is the only HTML AtCoder requires. The profile is server-rendered — not
 * the SPA shell CodeChef serves — so the rating sits in a plain labelled table
 * cell. `robots.txt` disallows `/users/*​/history/`, but not the profile page
 * itself, so this uses the permitted path.
 *
 * Same contract as standings-dom.js: **return null, never a plausible
 * default.** A substituted rating would not fail visibly; it would silently
 * mis-sort every AtCoder problem in the queue, because one rating shifts a
 * whole platform's block at once.
 */

/** Matched on exact label text, so "Highest Rating" doesn't win. */
const RATING_LABELS = ["Rating"];

export function extractRating(doc) {
  if (!doc) return null;

  for (const label of RATING_LABELS) {
    const cell = findCellByHeader(doc, label);
    if (cell === null) continue;

    const value = Number.parseInt(cell.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Finds the `<td>` paired with a `<th>` whose text is exactly `label`.
 * Exact match matters: AtCoder's profile table also has "Highest Rating",
 * "Rated Matches" and "Rank", and a substring match would take whichever came
 * first.
 */
function findCellByHeader(doc, label) {
  const headers = doc.querySelectorAll("th");

  for (const header of headers) {
    if (header.textContent.trim() !== label) continue;

    const cell = header.nextElementSibling;
    if (cell && cell.tagName?.toLowerCase() === "td") {
      return cell.textContent.trim();
    }
  }
  return null;
}
