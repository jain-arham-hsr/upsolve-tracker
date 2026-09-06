/**
 * The one place AtCoder's page globals are read.
 *
 * The AtCoder counterpart to `codechef/dom-parsers/page-globals.js`, and it
 * exists for the same reason: a site's embedded state is markup, and markup
 * belongs in exactly one file so a layout change is a one-file fix.
 *
 * **This is the one file in the folder that is not a DOM parser.** It takes the
 * raw HTML *string* and reads the page's JavaScript globals by regex, where its
 * neighbours take a parsed `Document` and use CSS selectors. It sits here
 * because it is still page-in, value-out with nothing fetched — and it is named
 * for the globals rather than for a page because AtCoder emits this marker on
 * every page it serves, so there is no one page to name it after.
 *
 * AtCoder renders `var userScreenName = "…"` into every page it serves — the
 * site's own scripts read it, alongside `contestScreenName` — which makes it a
 * far steadier signal than the navbar it is derived from.
 */

/**
 * Who the browser is signed in to AtCoder as.
 *
 * **Three outcomes, and conflating any two of them loses information:**
 *
 *   - a handle — signed in, and this is who as
 *   - `""` — the page rendered and nobody is signed in. A *fact*.
 *   - `null` — the marker is missing entirely, so the page shape changed and we
 *     do not know. Not the same as being signed out, and callers must not treat
 *     it as such: "we could not tell" is not evidence of anything.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractSignedInUser(html) {
  const match = /\bvar\s+userScreenName\s*=\s*"([^"]*)"/.exec(html);
  if (!match) return null;
  return match[1];
}
