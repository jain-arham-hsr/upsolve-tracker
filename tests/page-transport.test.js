/**
 * Routing a request through a page on the target site.
 *
 * Exists because of a measurement, not a theory. A fetch from the extension's
 * own origin is cross-site, so Chrome withholds cookies whose `SameSite` is
 * unset — the default — and the panel talks to every platform as a stranger.
 * Issued from inside a page on that site the same request carries the session.
 * Confirmed in the user's own browser: side panel 403 and unauthenticated,
 * content script 200 and logged in, same second.
 *
 * The fallbacks are what these tests mostly guard. Every one of them is a case
 * where the routed path is unavailable, and getting any of them wrong means the
 * request silently stops happening rather than quietly going direct.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createPageFetch, PAGE_FETCH } from "../core/services/page-transport.js";

const MATCHES = ["*://*.codeforces.com/*"];
const reply = (over = {}) => ({
  ok: true, status: 200, url: "https://codeforces.com/x", body: "page said hi", ...over,
});

let direct;
beforeEach(() => {
  direct = [];
});
const fallback = async (url) => { direct.push(url); return { ok: true, status: 200, url, async text() { return "direct"; } }; };

const withTabs = (query, sendMessage) =>
  createPageFetch({ matchPatterns: MATCHES, tabs: () => ({ query, sendMessage }), fallback });

test("a request goes through an open tab on the site", async () => {
  const sent = [];
  const fetchImpl = withTabs(
    async () => [{ id: 7 }],
    async (tabId, msg) => { sent.push({ tabId, msg }); return reply(); },
  );

  const response = await fetchImpl("https://codeforces.com/contest/1/standings", {});
  assert.equal(await response.text(), "page said hi");
  assert.equal(direct.length, 0, "it must not also fetch directly");
  assert.equal(sent[0].tabId, 7);
  assert.equal(sent[0].msg.type, PAGE_FETCH);
});

test("the final URL survives, because that is what a refusal hides in", async () => {
  // AtCoder answers a signed-out request with a 302 to /login and a healthy
  // 200. The status says nothing; only the landed URL does. A real `Response`
  // built from a body cannot carry `url`, which is why this returns a
  // Response-shaped object rather than a Response.
  const fetchImpl = withTabs(
    async () => [{ id: 1 }],
    async () => reply({ url: "https://atcoder.jp/login" }),
  );
  const response = await fetchImpl("https://atcoder.jp/contests/x/submissions", {});
  assert.equal(response.url, "https://atcoder.jp/login");
});

test("no tab on the site falls back to a direct fetch", async () => {
  // Public pages still work this way. Anything needing a session then fails
  // through the site's own refusal hook, which can say so — rather than here,
  // which cannot know what the caller wanted.
  const fetchImpl = withTabs(async () => [], async () => reply());
  assert.equal(await (await fetchImpl("https://codeforces.com/x", {})).text(), "direct");
  assert.deepEqual(direct, ["https://codeforces.com/x"]);
});

test("a tab with no content script falls back rather than failing", async () => {
  // Chrome does not inject into tabs that were already open when the extension
  // was installed or reloaded, so sendMessage rejects. Common enough after any
  // reload that it must not surface as an error.
  const fetchImpl = withTabs(
    async () => [{ id: 3 }],
    async () => { throw new Error("Could not establish connection."); },
  );
  assert.equal(await (await fetchImpl("https://codeforces.com/x", {})).text(), "direct");
});

test("a stale tab is skipped in favour of a live one", async () => {
  const fetchImpl = withTabs(
    async () => [{ id: 1 }, { id: 2 }],
    async (tabId) => {
      if (tabId === 1) throw new Error("no receiver");
      return reply({ body: "second tab" });
    },
  );
  assert.equal(await (await fetchImpl("https://codeforces.com/x", {})).text(), "second tab");
  assert.equal(direct.length, 0);
});

test("an error reported by the page falls back rather than propagating", async () => {
  const fetchImpl = withTabs(async () => [{ id: 1 }], async () => ({ error: "net::ERR_FAILED" }));
  assert.equal(await (await fetchImpl("https://codeforces.com/x", {})).text(), "direct");
});

test("no chrome.tabs at all still works", async () => {
  // The options page and the test runner have no tabs API. Requests there must
  // simply go direct rather than throwing on a missing global.
  const fetchImpl = createPageFetch({ matchPatterns: MATCHES, tabs: () => undefined, fallback });
  assert.equal(await (await fetchImpl("https://codeforces.com/x", {})).text(), "direct");
});

test("only cloneable init survives, since the message is structured-cloned", async () => {
  // A `Headers` instance would arrive empty and silently drop every header.
  let seen = null;
  const fetchImpl = withTabs(async () => [{ id: 1 }], async (_id, msg) => { seen = msg.init; return reply(); });
  await fetchImpl("https://codeforces.com/x", { headers: { Accept: "text/html" }, method: "GET" });
  assert.deepEqual(seen, { headers: { Accept: "text/html" }, method: "GET" });
});
