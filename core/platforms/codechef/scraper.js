/**
 * CodeChef's one page: `/dashboard`, and the bootstrap object its shell carries.
 *
 * CodeChef is an SPA — its pages are a ~4 KB shell with no content — so the
 * only thing worth reading is `window.codeChefUserData`, which holds the
 * signed-in handle and rating. The dashboard is the lightest page carrying it
 * (~9 KB, against 84 KB for the homepage, which doesn't carry it at all).
 *
 * That global is a DOM node: it lives inside a `<script>` element like any
 * other markup, so the parser selects the script and reads its text rather
 * than regexing the raw HTML string. Selecting the script is what made every
 * parser in the tree take a `Document`.
 */
import { Scraper, all } from "../scraper.js";
import { createSiteClient } from "../../services/site-client.js";
import { site } from "./site.js";

const ORIGIN = "https://www.codechef.com";

/** Human-paced; `api.js` names the same site, so both clients queue as one. */
const GAP_MS = 1500;

/**
 * Routed through a codechef.com tab when one is open — the whole point of
 * this page is who the browser is signed in as. A 403 is CodeChef's refusal;
 * signed out is *not* one, and arrives as a shell carrying no user.
 */
const client = createSiteClient({
  site,
  pacer: { gapMs: GAP_MS },
  refusal({ response, url }) {
    if (response.status === 403) {
      return new Error(
        "CodeChef refused the request. Open codechef.com in a tab, make sure you're " +
          "signed in, and try again.",
      );
    }
    if (response.ok) return null;
    return new Error(`CodeChef returned ${response.status} for ${new URL(url).pathname}.`);
  },
});

export class CodeChefScraper extends Scraper {
  constructor() {
    super({ origin: ORIGIN, client });
  }

  /** The browser's session is the identity: one instance serves every session. */
  static fromSettings() {
    return scraper;
  }

  /** Test seam: resets pacing between cases. */
  static reset(spacingMs = 0) {
    scraper.reset(spacingMs);
  }

  /**
   * Who the browser is signed in as.
   *
   * @returns {Promise<{username: string, rating: number|null}|null>} null both
   *   when signed out and when the shell no longer carries the bootstrap
   *   object; the platform must not read either as "nothing solved".
   */
  async dashboard() {
    return parseDashboard(await this.document("/dashboard"));
  }
}

export const scraper = new CodeChefScraper();

// ---------------------------------------------------------------------------
// /dashboard
// ---------------------------------------------------------------------------

const DASHBOARD = {
  // Every inline script; the one carrying the marker is picked by content,
  // since CodeChef gives it no id or class to select on.
  bootstrap: "script",
};

const MARKER = "window.codeChefUserData";

/**
 * Returns **null, never a plausible default**. A guessed handle would look
 * like a logged-in session and a guessed rating would silently mis-sort every
 * CodeChef problem in the queue.
 *
 * @param {Document} doc
 * @returns {{username: string, rating: number|null}|null} null when signed
 *   out **or** when the shell no longer carries the object. The caller must
 *   tell both of those from "you have solved nothing".
 */
export function parseDashboard(doc) {
  const user = userData(doc)?.user;
  if (!user?.username) return null;

  const rating = Number.parseInt(user.rating, 10);
  return { username: user.username, rating: Number.isFinite(rating) ? rating : null };
}

/** @returns {object|null} the whole bootstrap object. */
function userData(doc) {
  const source = all(doc, DASHBOARD.bootstrap)
    .map((node) => node.textContent ?? "")
    .find((content) => content.includes(MARKER));
  if (!source) return null;

  const start = source.indexOf("{", source.indexOf(MARKER));
  if (start === -1) return null;

  const json = sliceBalancedObject(source, start);
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
function sliceBalancedObject(content, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const char = content[i];

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
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}
