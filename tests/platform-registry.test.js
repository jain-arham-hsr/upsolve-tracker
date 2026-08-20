/**
 * The registry replaces two copies of a URL regex and three hardcoded origins.
 * These tests pin the two things that would break silently: a URL that should
 * not match returning something plausible, and contest ids colliding across
 * platforms once more than one platform exists.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  matchContestUrl,
  getPlatform,
  platformOf,
  contestKey,
  makeContestKey,
  listPlatforms,
  DEFAULT_PLATFORM_ID,
} from "../core/platforms/registry.js";

test("Codeforces contest and gym URLs are recognised", () => {
  for (const [url, id, subtype] of [
    ["https://codeforces.com/contest/1993", "1993", "OFFICIAL"],
    ["https://codeforces.com/contest/1993/problem/B", "1993", "OFFICIAL"],
    ["http://www.codeforces.com/gym/104123", "104123", "GYM"],
    ["https://CODEFORCES.com/CONTEST/2193/standings", "2193", "OFFICIAL"],
  ]) {
    const match = matchContestUrl(url);
    assert.ok(match, `${url} should match`);
    assert.equal(match.platform.id, "codeforces");
    assert.equal(match.contestId, id);
    assert.equal(match.subtype, subtype);
  }
});

test("non-contest URLs return null rather than a plausible guess", () => {
  for (const url of [
    "https://codeforces.com/problemset",
    "https://codeforces.com/profile/tourist",
    "https://www.codechef.com/START252D",
    "not a url",
    "",
    null,
    undefined,
  ]) {
    assert.equal(matchContestUrl(url), null, `${url} should not match`);
  }
});

test("records written before platforms existed read as Codeforces", () => {
  assert.equal(platformOf({ id: "2193", type: "OFFICIAL" }).id, "codeforces");
  assert.equal(platformOf({}).id, "codeforces");
  assert.equal(getPlatform(undefined).id, DEFAULT_PLATFORM_ID);
  assert.equal(getPlatform("").id, DEFAULT_PLATFORM_ID);
});

test("an id from a newer version throws instead of silently defaulting", () => {
  assert.throws(() => getPlatform("nonexistent"), /Unknown platform/);
});

test("contest ids do not collide across platforms", () => {
  // The whole reason storage keys gained a platform: CF contest 1000 and a
  // CodeChef contest "1000" are different contests.
  assert.notEqual(
    makeContestKey("codeforces", "1000"),
    makeContestKey("codechef", "1000"),
  );
  // Numeric vs string ids are the same contest — backups carry both.
  assert.equal(makeContestKey("codeforces", 1000), makeContestKey("codeforces", "1000"));
  assert.equal(contestKey({ id: 1993 }), contestKey({ id: "1993", platform: "codeforces" }));
});

test("every registered platform implements the descriptor contract", () => {
  for (const platform of listPlatforms()) {
    for (const method of [
      "matchUrl", "contestUrl", "problemUrl", "sourceLabel", "solvedKey", "problemKey",
    ]) {
      assert.equal(typeof platform[method], "function", `${platform.id}.${method}`);
    }
    assert.ok(platform.capabilities, `${platform.id}.capabilities`);
    assert.equal(typeof platform.capabilities.allowsPartialRatings, "boolean");
  }
});
