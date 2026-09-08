/**
 * The shared `Scraper` base, and the reading vocabulary every parser shares.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { Scraper, first, all, text } from "../core/platforms/scraper.js";

const stubClient = () => {
  const calls = [];
  return {
    calls,
    getDocument: async (url, init) => (calls.push({ how: "doc", url, init }), "doc"),
    reset: (ms) => calls.push({ how: "reset", ms }),
  };
};

test("document reaches the client, on the origin, carrying init through", async () => {
  const client = stubClient();
  const scraper = new Scraper({ client, origin: "https://example.com" });

  await scraper.document("/c", { headers: { Accept: "text/html" } });
  await scraper.document("https://codeforces.com/gym/1");

  assert.deepEqual(
    client.calls.map((c) => [c.how, c.url]),
    [["doc", "https://example.com/c"], ["doc", "https://codeforces.com/gym/1"]],
  );
  assert.equal(client.calls[0].init.headers.Accept, "text/html");
});

test("a scraper refuses to exist without a client, and its statics are a contract", () => {
  assert.throws(() => new Scraper({ origin: "https://example.com" }), /no client/);
  class Forgetful extends Scraper {}
  assert.throws(() => Forgetful.fromSettings({}), /Forgetful must implement static fromSettings/);
  assert.throws(() => Forgetful.reset(), /Forgetful must implement static reset/);
});

test("reset reaches the client with the spacing", () => {
  const client = stubClient();
  new Scraper({ client }).reset(60);
  assert.deepEqual(client.calls, [{ how: "reset", ms: 60 }]);
});

const page = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

test("first takes the earliest selector in a chain that matches, and null otherwise", () => {
  const doc = page(`<p class="b">two</p><p class="a">one</p>`);
  assert.equal(text(first(doc, [".a", ".b"])), "one");
  assert.equal(text(first(doc, [".missing", ".b"])), "two");
  assert.equal(first(doc, ".missing"), null);
  assert.equal(first(null, ".a"), null, "a null root is a null match, not a throw");
});

test("all is a real array, and text collapses whitespace to null when empty", () => {
  const doc = page(`<ul><li> a </li><li>b\n  c</li><li>   </li></ul>`);
  const items = all(doc, "li");
  assert.ok(Array.isArray(items));
  assert.deepEqual(items.map(text), ["a", "b c", null]);
  assert.deepEqual(all(null, "li"), []);
});
