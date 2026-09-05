/**
 * The page half of `core/services/page-transport.js`.
 *
 * Runs inside a page on a supported platform and makes requests on the panel's
 * behalf. The point is not the fetching — it is *where* the fetch happens: from
 * here the request is same-site, so the browser sends the user's cookies, and
 * the site answers as it would for the tab they are looking at. From the panel
 * it is cross-site, cookies are withheld, and the site sees a stranger.
 *
 * It initiates nothing. It answers one message type and does nothing otherwise,
 * so a page the user visits is not doing work for the extension unless the
 * extension asked.
 */
import { PAGE_FETCH } from "@core/services/page-transport.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== PAGE_FETCH) return undefined;

  (async () => {
    try {
      const response = await fetch(message.url, {
        credentials: "include",
        ...message.init,
      });

      sendResponse({
        ok: response.ok,
        status: response.status,
        // The *final* URL, after any redirect. AtCoder answers a signed-out
        // request with a 302 to /login and a perfectly healthy 200, so this is
        // the only field that reveals the refusal.
        url: response.url,
        body: await response.text(),
      });
    } catch (error) {
      sendResponse({ error: String(error) });
    }
  })();

  // Keeps the message channel open for the async reply above. Without it the
  // panel's `sendMessage` resolves undefined and the request silently falls
  // back to the cross-site path this exists to avoid.
  return true;
});
