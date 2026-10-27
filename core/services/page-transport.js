/**
 * Issuing a request from inside a page on the target site.
 *
 * ## Why this exists
 *
 * A `fetch` from the extension's own origin is **cross-site**. Chrome withholds
 * cookies whose `SameSite` is unset — which is the default — and
 * `credentials: "include"` does not override that; it governs whether cookies
 * *may* be sent, not whether the browser considers them same-site. So the panel
 * talks to every platform as an anonymous stranger.
 *
 * Measured, from the user's own browser, three ways in the same second:
 *
 * | request issued from      | status | challenged | carried the session |
 * |--------------------------|--------|------------|---------------------|
 * | the extension side panel | 403    | yes        | **no**              |
 * | a content script         | 200    | no         | **yes**             |
 * | the page's own context   | 200    | no         | yes                 |
 *
 * That is the whole reason for this module. It is not a way around a site's
 * defences: it is how an extension acts as the user on a site the user is
 * already signed in to, which is what a content script is *for*. The request
 * that results is the same one the user's own tab would make.
 *
 * **That measurement is a moment, not a law.** Re-measured on Codeforces on
 * 2026-10-27, a direct fetch from the side panel with no codeforces.com tab open
 * read a *private* gym's page logged in, unchallenged, problems and all — so
 * at that moment the site was neither challenging the extension nor
 * withholding the login. CodeChef has never needed a tab in practice either.
 * Whether a session travels depends on how each site sets its cookie and on
 * whether its bot check is active, and both change without notice. So this
 * module stays: it costs nothing when a tab is open, and it is what keeps the
 * session-gated reads working when a site tightens up again.
 *
 * ## What it cannot do
 *
 * It needs a tab open on that site. When there is none it falls back to a direct
 * fetch, which still works for anything public — AtCoder's task lists, an
 * unchallenged Codeforces page — and fails honestly for anything that needs a
 * session, because the site's own `refusal` hook will say so. It does **not**
 * open a tab: doing that on a background refresh would be a browser hijacking
 * the user did not ask for.
 */

/** The one message this protocol has. Mirrored in the content script. */
export const PAGE_FETCH = "upsolve:page-fetch";

/**
 * A `fetchImpl` for `createSiteClient` that routes through a page on the site.
 *
 * @param {object} options
 * @param {string[]} options.matchPatterns - the site's `hostPermissions`, which
 *   are already match patterns and already declared for it.
 * @param {() => any} [options.tabs] - test seam for `chrome.tabs`.
 * @param {Function} [options.fallback] - test seam for the direct fetch.
 * @returns {(url: string, init: object) => Promise<object>} a Response-*shaped*
 *   object: `{ ok, status, url, text() }`. Deliberately not a real `Response` —
 *   one constructed from a body cannot carry `url`, and `url` is exactly what
 *   AtCoder's refusal check reads to notice it was bounced to a sign-in form.
 */
export function createPageFetch({
  matchPatterns,
  tabs = () => globalThis.chrome?.tabs,
  fallback = (...args) => fetch(...args),
}) {
  return async function pageFetch(url, init = {}) {
    const api = tabs();
    if (!api?.query) return fallback(url, init);

    let open = [];
    try {
      open = await api.query({ url: matchPatterns });
    } catch {
      // Querying by URL needs host permission for those URLs. We have it, but a
      // failure here must not take the request down with it.
      return fallback(url, init);
    }
    if (open.length === 0) return fallback(url, init);

    for (const tab of open) {
      try {
        const reply = await api.sendMessage(tab.id, {
          type: PAGE_FETCH,
          url,
          // Only what survives structured cloning. Callers pass plain objects;
          // a `Headers` instance would arrive empty and silently drop them.
          init: { headers: init.headers ?? undefined, method: init.method ?? undefined },
        });

        if (reply?.error) throw new Error(reply.error);
        if (!reply) continue;

        return {
          ok: reply.ok,
          status: reply.status,
          url: reply.url,
          async text() {
            return reply.body;
          },
        };
      } catch {
        // No content script in that tab — it was open before the extension was
        // installed or reloaded, and Chrome does not inject retroactively. Try
        // the next one, then give up and go direct.
        continue;
      }
    }

    return fallback(url, init);
  };
}
