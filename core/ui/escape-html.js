/**
 * Escapes a value for interpolation into innerHTML.
 *
 * Problem names, contest names and problem indices all originate from scraped
 * Codeforces markup, so they are untrusted input by the time the views render
 * them. Safe for both text content and quoted attribute values.
 */
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
