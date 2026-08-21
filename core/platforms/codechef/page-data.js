/**
 * Every rule for reading CodeChef's HTML lives here.
 *
 * CodeChef is an SPA — its pages are a ~4 KB shell with no content — so the
 * only thing worth extracting is the bootstrap object the shell carries:
 * `window.codeChefUserData`, which holds the signed-in handle and rating.
 *
 * As in standings-dom.js, extractors return **null, never a plausible
 * default**. A guessed handle would look like a logged-in session and a
 * guessed rating would silently mis-sort every CodeChef problem in the queue.
 */

const MARKER = "window.codeChefUserData";

/**
 * Slices a balanced `{...}` starting at `start`, respecting strings and
 * escapes. A non-greedy regex would stop at the first `};` inside a nested
 * object or a string.
 */
function sliceBalancedObject(text, start) {
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

/** @returns {object|null} the parsed bootstrap object, or null. */
export function extractUserData(html) {
  if (typeof html !== "string") return null;

  const marker = html.indexOf(MARKER);
  if (marker === -1) return null;

  const start = html.indexOf("{", marker);
  if (start === -1) return null;

  const json = sliceBalancedObject(html, start);
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * @returns {{username: string, rating: number|null}|null} null when signed out
 *   or when the page shape has changed — the caller must tell those apart from
 *   "you have solved nothing".
 */
export function extractSession(html) {
  const data = extractUserData(html);
  const user = data?.user;
  if (!user?.username) return null;

  const rating = Number.parseInt(user.rating, 10);
  return {
    username: user.username,
    rating: Number.isFinite(rating) ? rating : null,
  };
}
