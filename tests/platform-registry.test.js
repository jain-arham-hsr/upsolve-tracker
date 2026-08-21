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
  findTrackedContest,
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

test("a contest tracked under a resolved division is found by its parent id", () => {
  // The add-banner bug: CodeChef /START252 stores as START252D, so a bare key
  // comparison reported it untracked and offered to add it again.
  const contests = [
    { id: "START252D", platform: "codechef", sourceId: "START252", problems: [] },
    { id: "1993", platform: "codeforces", problems: [] },
  ];

  assert.equal(findTrackedContest(contests, "codechef", "START252")?.id, "START252D");
  assert.equal(findTrackedContest(contests, "codechef", "START252D")?.id, "START252D");
  assert.equal(findTrackedContest(contests, "codeforces", "1993")?.id, "1993");
});

test("a sourceId does not match across platforms or for other contests", () => {
  const contests = [
    { id: "START252D", platform: "codechef", sourceId: "START252", problems: [] },
  ];
  assert.equal(findTrackedContest(contests, "codeforces", "START252"), null);
  assert.equal(findTrackedContest(contests, "codechef", "START251"), null);
  assert.equal(findTrackedContest([], "codechef", "START252"), null);
  assert.equal(findTrackedContest(undefined, "codechef", "START252"), null);
});

test("a null entry in storage doesn't break the lookup", () => {
  // Backups have been seen carrying these; describeBackupProblem refuses them,
  // but the lookup runs against whatever is already stored.
  assert.equal(findTrackedContest([null, { id: "1", platform: "codeforces" }], "codeforces", "1")?.id, "1");
});

test("the queue label matches the badge wording, not a second vocabulary", () => {
  // "Contest 2237C" beside "Gym 703136K" reads as two kinds of thing, when
  // Official and Gym are two values of the same one.
  const cf = getPlatform("codeforces");
  assert.equal(cf.sourceLabel({ id: "2237", type: "OFFICIAL" }, { index: "C" }), "Official 2237C");
  assert.equal(cf.sourceLabel({ id: "703136", type: "GYM" }, { index: "K" }), "Gym 703136K");

  // Whatever the badge says is what the label says.
  for (const type of ["OFFICIAL", "GYM"]) {
    const contest = { id: "1", type };
    assert.ok(
      cf.sourceLabel(contest, { index: "A" }).startsWith(cf.subtypeLabel(contest)),
    );
  }
});

test("a record predating platforms still labels as Official", () => {
  assert.equal(getPlatform("codeforces").sourceLabel({ id: "2193" }, { index: "A" }), "Official 2193A");
});
