/**
 * Whose AtCoder progress is this?
 *
 * CLAUDE.md long recorded that on AtCoder "the handle is verified to exist, not
 * to be yours" — its history came from a third party that authenticates nobody,
 * so nothing could contradict a wrong handle. Reading submissions from AtCoder
 * with the user's own session changed that: every page carries
 * `var userScreenName`, so the signed-in account is knowable.
 *
 * The policy is deliberately narrower than CodeChef's, and these cases are
 * mostly about the *narrowness*. On CodeChef the session is the identity, so a
 * mismatch means the returned data is the wrong person's. Here submissions are
 * filtered by `f.User=`, so the data is right regardless — a mismatch means the
 * handle in Settings is not the one you compete under. Worth refusing, but only
 * on positive evidence.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const { getPlatform } = await import("../../../core/platforms/registry.js");
const verifyIdentity = (session) => getPlatform("atcoder").verifyIdentity(session);
const { api } = await import("../../../core/platforms/atcoder/api.js");
const { scraper } = await import("../../../core/platforms/atcoder/scraper.js");

const profile = (signedInAs, rating = 1600) => `<html><head>
  <script>var userScreenName = ${signedInAs === null ? "undefined" : `"${signedInAs}"`};</script>
  </head><body><table class="dl-table">
  <tr><th class="no-break">Rating</th><td><span class="user-blue">${rating}</span></td></tr>
</table></body></html>`;

/** `null` here means the marker is absent entirely, not that it is empty. */
const noMarker = `<html><body><table class="dl-table">
  <tr><th class="no-break">Rating</th><td><span class="user-blue">1600</span></td></tr>
</table></body></html>`;

let served;
beforeEach(() => {
  getPlatform("atcoder").reset(0);
  served = { status: 200, body: profile("") };
  globalThis.fetch = async (url) => ({
    ok: served.status === 200,
    status: served.status,
    url: String(url),
    async text() { return served.body; },
  });
});

test("a handle that is not the signed-in account is refused", async () => {
  served.body = profile("someone_else");
  const error = await verifyIdentity({ handle: "jain_arham_hsr", api, scraper }).then(() => null, (e) => e);

  assert.ok(error, "a contradicted handle must not pass");
  assert.equal(error.isIdentityMismatch, true, "callers branch on the flag, not the sentence");
  assert.match(error.message, /someone_else/);
  assert.match(error.message, /jain_arham_hsr/);
});

test("a matching account confirms, and AtCoder's casing wins", async () => {
  // So "Tourist" and "tourist" do not read as two different accounts on the
  // next comparison and needlessly clear the platform's solved flags.
  served.body = profile("Tourist");
  const identity = await verifyIdentity({ handle: "tourist", api, scraper });
  assert.equal(identity.username, "Tourist");
  assert.equal(identity.rating, 1600);
});

test("signed out still verifies the handle, exactly as before", async () => {
  // Adding a contest has to keep working without a session — difficulty falls
  // back to "???" rather than failing — so an empty marker cannot be fatal.
  served.body = profile("");
  const identity = await verifyIdentity({ handle: "anybody", api, scraper });
  assert.equal(identity.username, "anybody");
  assert.equal(identity.rating, 1600);
});

test("a missing marker is not treated as signed out", async () => {
  // "We could not tell" is not evidence about who you are. Refusing here would
  // make the extension unusable for a reason it cannot state — and a page-shape
  // change is exactly when that would happen.
  served.body = noMarker;
  const identity = await verifyIdentity({ handle: "anybody", api, scraper });
  assert.equal(identity.username, "anybody");
});

test("an unknown handle says so, rather than reporting an HTTP code", async () => {
  served = { status: 404, body: "" };
  await assert.rejects(() => verifyIdentity({ handle: "nope", api, scraper }), /AtCoder has no user "nope"/);
});

test("no handle is its own message, and costs no request", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  await assert.rejects(() => verifyIdentity({ handle: null, api, scraper }), /No AtCoder handle set/);
  assert.equal(called, false);
});

test("a mismatch outranks the rating — it must not be reported as connected", async () => {
  // The failure mode this prevents: surfacing "Connected as …" with somebody
  // else's rating, which would then order the whole AtCoder block of the queue.
  served.body = profile("someone_else", 2400);
  await assert.rejects(() => verifyIdentity({ handle: "me", api, scraper }), (e) => e.isIdentityMismatch);
});
