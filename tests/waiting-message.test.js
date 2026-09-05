/**
 * What a waiting contest tells the user, and why it is not one sentence.
 *
 * Three facts wait — `notEndedYet`, `notPublishedYet`, `sourceUnreachable` —
 * but for a long time only one of them could reach the add path, so the message
 * was written for that one and hardcoded. When a Cloudflare block began
 * answering `sourceUnreachable`, a seven-month-old *finished* contest was told
 * it "isn't published yet": false on its face, and it reads as a bug in the
 * extension rather than a hiccup at the platform.
 *
 * The cause was always on `error.contestStatus`; nothing read it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { waitingExplanation } from "../core/ui/waiting-message.js";
import {
  NOT_ENDED_YET,
  NOT_PUBLISHED_YET,
  SOURCE_UNREACHABLE,
  UNAVAILABLE,
  shouldWait,
} from "../core/contest-status.js";

const at = (status, message = "boom") => waitingExplanation({ contestStatus: status, message }, "2197");

test("an unpublished contest is described as unpublished", () => {
  assert.match(at(NOT_PUBLISHED_YET), /2197 isn't published yet/);
});

test("a running contest is described as running, not unpublished", () => {
  assert.match(at(NOT_ENDED_YET), /hasn't finished yet/);
  assert.doesNotMatch(at(NOT_ENDED_YET), /isn't published/);
});

test("an unreachable source repeats the adapter's own sentence", () => {
  // Only the adapter can say *what* was unreachable — and for a Cloudflare
  // block it is also the only sentence that tells the user what to do.
  const blocked = "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";
  const shown = at(SOURCE_UNREACHABLE, blocked);
  assert.match(shown, /blocking requests/);
  assert.doesNotMatch(shown, /isn't published yet/, "the old copy lied about a published contest");
});

test("every waiting status gets a sentence, and none inherits another's", () => {
  // The regression guard: a status added later must not silently fall into
  // whichever branch happens to be first.
  const seen = new Set();
  for (const status of [NOT_ENDED_YET, NOT_PUBLISHED_YET, SOURCE_UNREACHABLE]) {
    assert.ok(shouldWait(status), `${status} should wait`);
    const shown = at(status);
    assert.ok(shown.length > 0);
    assert.equal(seen.has(shown), false, `${status} reuses another status' wording`);
    seen.add(shown);
  }
});

test("an unrecognised status is vague rather than confidently wrong", () => {
  // `unavailable` never reaches here — it refuses instead of waiting — so this
  // stands in for any status added in future.
  assert.equal(shouldWait(UNAVAILABLE), false);
  const shown = at(UNAVAILABLE);
  assert.match(shown, /couldn't be added yet/);
  assert.doesNotMatch(shown, /isn't published|hasn't finished/);
});

test("every message says what happens next", () => {
  for (const status of [NOT_ENDED_YET, NOT_PUBLISHED_YET, SOURCE_UNREACHABLE, undefined]) {
    assert.match(at(status), /retried on a refresh/, `${status} does not say what happens next`);
  }
});
