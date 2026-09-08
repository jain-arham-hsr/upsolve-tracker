/**
 * Collapsing a team into one rating, which every Codeforces field reading
 * ends in. The properties below are what `partyRatings` relies on it for:
 * above the strongest member, monotone in its members, and exactly the
 * ability with an even chance against the team.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { teamRating } from "../../../core/platforms/codeforces/api.js";

test("a team collapses to a rating above its strongest member", () => {
  // The whole point: three 1500s solve more than one 1500 does, so a team
  // cannot collapse to its max. `max` was tried as a cheap substitute and
  // measured worse — see tests/platforms/codeforces/estimator-accuracy.test.js.
  assert.ok(teamRating([1500, 1500, 1500]) > 1500);
  assert.ok(teamRating([2000, 1200, 900]) > 2000);
});

test("a team of one is exactly that one, untouched by the search", () => {
  // Every official Codeforces contest is individual, so this is the common
  // case; rounding a solo competitor's own rating would shift the whole field.
  for (const rating of [-500, 0, 800, 1337, 3500]) {
    assert.equal(teamRating([rating]), rating);
  }
});

test("adding a weaker member never makes a team weaker", () => {
  // Monotonicity. A member who contributes nothing should still not subtract,
  // and a mean would break this — which is why `mean` was rejected too.
  let previous = teamRating([2400]);
  for (const added of [800, 1000, 1200, 1600]) {
    const next = teamRating([2400, added]);
    assert.ok(next >= previous, `adding ${added} dropped the team to ${next} from ${previous}`);
    previous = next;
  }
});

test("the collapsed rating is the ability with an even chance against the team", () => {
  // The definition, asserted directly rather than through its consequences:
  // the product of each member's loss probability against R is 0.5.
  const members = [1800, 1600, 1400];
  const R = teamRating(members);
  const loss = members.reduce((p, r) => p * (1 / (1 + Math.pow(10, (r - R) / 400))), 1);
  assert.ok(Math.abs(loss - 0.5) < 0.01, `loss probability was ${loss}, not ~0.5`);
});
