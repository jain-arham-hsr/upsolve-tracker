/**
 * CodeChef contest codes live at the site root, so the URL matcher has to
 * separate them from every other path on the site. Getting that wrong in
 * either direction is silent: too loose and "+ Add Contest" lights up on a
 * profile page, too tight and real contests are unaddable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { codechef } from "../core/platforms/codechef/descriptor.js";
import { matchContestUrl } from "../core/platforms/registry.js";

test("contest codes at the site root are recognised", () => {
  for (const [url, id, subtype] of [
    ["https://www.codechef.com/START252D", "START252D", "STARTERS"],
    ["https://www.codechef.com/START252D/problems/IOI7", "START252D", "STARTERS"],
    ["https://www.codechef.com/rankings/START252D?page=1", "START252D", "STARTERS"],
    ["https://codechef.com/COOK89", "COOK89", "COOKOFF"],
    ["https://www.codechef.com/LTIME110", "LTIME110", "LUNCHTIME"],
    ["https://www.codechef.com/CAH1801", "CAH1801", "OTHER"],
  ]) {
    const match = matchContestUrl(url);
    assert.ok(match, `${url} should match`);
    assert.equal(match.platform.id, "codechef");
    assert.equal(match.contestId, id);
    assert.equal(match.subtype, subtype);
  }
});

test("the site's own lower-case sections are not contests", () => {
  // This is what upper-case-only buys: CodeChef's sections are lower-case.
  for (const url of [
    "https://www.codechef.com/problems/CDMT",
    "https://www.codechef.com/ratings",
    "https://www.codechef.com/practice",
    "https://www.codechef.com/users/jain_arham_hsr",
    "https://www.codechef.com/dashboard",
    "https://www.codechef.com/",
  ]) {
    assert.equal(matchContestUrl(url), null, `${url} should not match`);
  }
});

test("solved status keys on the problem code, so divisions share it", () => {
  // The same problem runs in every division of a Starters. Solving it in Div 4
  // must clear it from a tracked Div 3 too.
  const inDiv4 = codechef.solvedKey({ id: "START252D" }, { index: "IOI7" });
  const inDiv3 = codechef.solvedKey({ id: "START252C" }, { index: "IOI7" });
  assert.equal(inDiv4, inDiv3);
  assert.match(inDiv4, /^codechef:/);
});

test("problem links point into the contest, not the practice page", () => {
  assert.equal(
    codechef.problemUrl({ id: "START252D" }, { index: "IOI7" }),
    "https://www.codechef.com/START252D/problems/IOI7",
  );
});

test("partial ratings are allowed — there is no estimator fallback here", () => {
  assert.equal(codechef.capabilities.allowsPartialRatings, true);
  assert.equal(codechef.capabilities.bulkProblemData, false);
});
