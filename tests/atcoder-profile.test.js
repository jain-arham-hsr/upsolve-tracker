/**
 * The AtCoder rating extractor. A wrong rating here does not fail visibly — it
 * silently shifts every AtCoder problem's position in the merged queue, since
 * one rating moves a whole platform's block at once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { extractRating } from "../core/platforms/atcoder/dom-parsers/profile.js";

const doc = (body) =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html");

// Shaped like the real page: Rank first, then Rating, then Highest Rating
// carrying extra markup for the colour title.
const PROFILE = `
  <table class="dl-table">
    <tr><th class="no-break">Rank</th><td>1st  (Top &lt;0.01%)</td></tr>
    <tr><th class="no-break">Rating</th><td><span class="user-red">3797</span></td></tr>
    <tr><th class="no-break">Highest Rating</th><td><span class="user-red">4229</span>
        <span class="bold">―</span><span>King</span></td></tr>
    <tr><th class="no-break">Rated Matches</th><td>62</td></tr>
  </table>`;

test("the current rating is read, not the highest", () => {
  // Both cells contain a four-digit number; a substring match on "Rating"
  // would take whichever row came first.
  assert.equal(extractRating(doc(PROFILE)), 3797);
});

test("a negative rating parses", () => {
  assert.equal(extractRating(doc("<table><tr><th>Rating</th><td>-12</td></tr></table>")), -12);
});

test("a changed page returns null rather than a plausible rating", () => {
  assert.equal(extractRating(doc("<p>no table here</p>")), null);
  assert.equal(extractRating(doc("<table><tr><th>Rating</th></tr></table>")), null);
  assert.equal(extractRating(doc("<table><tr><th>Rating</th><td>n/a</td></tr></table>")), null);
  assert.equal(extractRating(null), null);
});

test("an unrated newcomer's profile yields null, not zero", () => {
  // Someone who has never competed has no Rating row at all. Zero would read
  // as a real rating and make every problem look impossible.
  assert.equal(
    extractRating(doc("<table><tr><th>Rank</th><td>—</td></tr></table>")),
    null,
  );
});
