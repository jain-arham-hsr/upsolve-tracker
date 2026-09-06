/**
 * The shared site client.
 *
 * Three platforms were each doing the same four things around `createPacer` —
 * pace, fetch, decide whether the site *refused*, hand back text or JSON — and
 * only two of those varied. This is what they share now, so a mistake here is a
 * mistake on every platform at once, which is exactly why it needs its own
 * tests rather than being covered incidentally through three adapters.
 *
 * The `refusal` hook is the interesting part. A refusal is not an HTTP failure:
 * Codeforces answers a Cloudflare challenge with a 403 *or* a 200 carrying an
 * interstitial, and AtCoder redirects to `/login` and returns a healthy 200
 * containing a sign-in form. Both look like "no data" if you only read
 * `response.ok`, and both are silent in the worst way — an empty result is
 * indistinguishable from having nothing to report, and `solved` is sticky.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createSiteClient } from "../core/services/site-client.js";

const respond = (body, { status = 200, url = "https://example.com/x" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  async text() { return body; },
});

const never = () => null;

let served;
beforeEach(() => {
  served = respond("hello");
  globalThis.fetch = async () => served;
});

// Names the seam rather than a `site`, so these cases exercise the refusal hook
// against the stubbed `globalThis.fetch` without page-transport in the way.
const client = (refusal = never) =>
  createSiteClient({ pacer: { gapMs: 0 }, refusal, fetchImpl: (...args) => fetch(...args) });

test("a body the site actually answered comes back untouched", async () => {
  assert.equal(await client().get("https://example.com/x"), "hello");
});

test("what the site calls a refusal is thrown, not returned as emptiness", async () => {
  // The whole point: returning "" here would be indistinguishable from a real
  // empty answer, and callers write `solved` from these results.
  const flagged = client(({ body }) =>
    body.includes("Just a moment") ? Object.assign(new Error("blocked"), { isSourceUnreachable: true }) : null,
  );

  served = respond("<html>Just a moment</html>", { status: 200 });
  const error = await flagged.get("https://example.com/x").then(() => null, (e) => e);

  assert.ok(error, "a 200 carrying an interstitial must not read as success");
  assert.equal(error.isSourceUnreachable, true);
});

test("a refusal can be decided from the status alone", async () => {
  const on403 = client(({ response }) => (response.status === 403 ? new Error("nope") : null));
  served = respond("", { status: 403 });
  await assert.rejects(() => on403.get("https://example.com/x"), /nope/);
});

test("a refusal can be decided from where the request landed", async () => {
  // AtCoder's shape: fetch follows the 302, so the status is a healthy 200 and
  // only the final URL says you were bounced to a sign-in form.
  const onLogin = client(({ response }) =>
    new URL(response.url).pathname === "/login" ? new Error("signed out") : null,
  );
  served = respond("<form>sign in</form>", { url: "https://example.com/login" });
  await assert.rejects(() => onLogin.get("https://example.com/x"), /signed out/);
});

test("JSON is parsed, and the refusal hook still runs first", async () => {
  served = respond('{"a":1}');
  assert.deepEqual(await client().getJson("https://example.com/x"), { a: 1 });

  const always = client(() => new Error("refused"));
  await assert.rejects(() => always.getJson("https://example.com/x"), /refused/);
});

test("a JSON route answering HTML names the site, not the parser", async () => {
  // A site that answers JSON with a page has refused in a way its own hook did
  // not recognise. "Unexpected token < in JSON" names nothing anyone can act on.
  served = respond("<html>nope</html>", { url: "https://codeforces.com/api/x" });
  await assert.rejects(
    () => client().getJson("https://codeforces.com/api/x"),
    /codeforces\.com answered 200 with something that is not JSON/,
  );
});

test("the caller's init reaches fetch, so headers and method survive", async () => {
  let seen = null;
  globalThis.fetch = async (_url, init) => { seen = init; return respond("ok"); };
  await client().get("https://example.com/x", { headers: { Accept: "application/json" } });
  assert.equal(seen.headers.Accept, "application/json");
});

test("the issuer is a seam, so how a request is made can be swapped", async () => {
  // This exists for a measured reason: a fetch from the extension's own origin
  // is cross-site, so Chrome withholds cookies whose SameSite is unset — the
  // default — and the request arrives unauthenticated. Routing it through a
  // page on the target site is the fix, and it must be swappable in one place
  // rather than reimplemented per platform.
  const calls = [];
  const viaPage = createSiteClient({
    pacer: { gapMs: 0 },
    refusal: never,
    fetchImpl: async (url) => { calls.push(url); return respond("from the page"); },
  });

  assert.equal(await viaPage.get("https://example.com/x"), "from the page");
  assert.deepEqual(calls, ["https://example.com/x"]);
});

test("a custom issuer replaces fetch entirely, rather than wrapping it", async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return respond("direct"); };

  const viaPage = createSiteClient({
    pacer: { gapMs: 0 },
    refusal: never,
    fetchImpl: async () => respond("routed"),
  });

  await viaPage.get("https://example.com/x");
  assert.equal(fetched, false, "the direct path must not also run");
});
