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
  listSites,
  siteOf,
} from "../core/platforms/registry.js";

test("sites group platforms: Codeforces is one site with two, and colours are distinct per site", () => {
  const sites = listSites();
  assert.deepEqual(sites.map((site) => site.id), ["codeforces", "atcoder", "codechef"]);
  assert.deepEqual(sites[0].platforms.map((p) => p.id), ["codeforces-official", "codeforces-gyms"]);
  assert.equal(new Set(sites.map((site) => site.chartColor)).size, 3, "each site has its own identity colour");
  for (const site of sites) {
    for (const platform of site.platforms) {
      assert.equal(platform.chartColor, site.chartColor, `${platform.id} does not carry its site's colour`);
      assert.equal(platform.site.id, site.id);
    }
  }
  assert.equal(siteOf({ id: "1", platform: "codeforces-gyms" }).id, "codeforces");
});

test("Codeforces contest and gym URLs are recognised", () => {
  // The path segment is the whole difference between the two Codeforces
  // platforms, so this is also what proves `/contest/` and `/gym/` resolve to
  // different adapters rather than to one that then branches.
  for (const [url, id, subtype, platformId] of [
    ["https://codeforces.com/contest/1993", "1993", "OFFICIAL", "codeforces-official"],
    ["https://codeforces.com/contest/1993/problem/B", "1993", "OFFICIAL", "codeforces-official"],
    ["http://www.codeforces.com/gym/104123", "104123", "GYM", "codeforces-gyms"],
    ["https://CODEFORCES.com/CONTEST/2193/standings", "2193", "OFFICIAL", "codeforces-official"],
  ]) {
    const match = matchContestUrl(url);
    assert.ok(match, `${url} should match`);
    assert.equal(match.platform.id, platformId);
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

test("a contest must name its platform", () => {
  // No read-time default any more: a record without a platform is malformed,
  // and guessing one would silently file it under Codeforces.
  assert.throws(() => contestKey({ id: 1993 }));
  assert.throws(() => platformOf({ id: 1993 }));
  assert.equal(contestKey({ id: 1993, platform: "codeforces-official" }), "codeforces-official:1993");
});

test("an id from a newer version throws instead of silently defaulting", () => {
  assert.throws(() => getPlatform("nonexistent"), /Unknown platform/);
});

test("contest ids do not collide across platforms", () => {
  // The whole reason storage keys gained a platform: CF contest 1000 and a
  // CodeChef contest "1000" are different contests.
  assert.notEqual(
    makeContestKey("codeforces-official", "1000"),
    makeContestKey("codechef", "1000"),
  );
  // Numeric vs string ids are the same contest — backups carry both.
  assert.equal(makeContestKey("codeforces-official", 1000), makeContestKey("codeforces-official", "1000"));
  assert.equal(
    contestKey({ id: 1993, platform: "codeforces-official" }),
    contestKey({ id: "1993", platform: "codeforces-official" }),
  );
});

test("every registered platform implements the describing contract", () => {
  for (const platform of listPlatforms()) {
    for (const method of [
      "matchUrl", "contestUrl", "problemUrl", "sourceLabel", "solvedKey", "problemKey",
      "contestFlags", "contestIdLabel",
    ]) {
      assert.equal(typeof platform[method], "function", `${platform.id}.${method}`);
    }
    assert.ok(platform.capabilities, `${platform.id}.capabilities`);
    assert.equal(typeof platform.capabilities.canEstimate, "boolean");
  }
});

test("a contest tracked under a resolved division is found by its parent id", () => {
  // The add-banner bug: CodeChef /START252 stores as START252D, so a bare key
  // comparison reported it untracked and offered to add it again.
  const contests = [
    { id: "START252D", platform: "codechef", sourceId: "START252", problems: [] },
    { id: "1993", platform: "codeforces-official", problems: [] },
  ];

  assert.equal(findTrackedContest(contests, "codechef", "START252")?.id, "START252D");
  assert.equal(findTrackedContest(contests, "codechef", "START252D")?.id, "START252D");
  assert.equal(findTrackedContest(contests, "codeforces-official", "1993")?.id, "1993");
});

test("a sourceId does not match across platforms or for other contests", () => {
  const contests = [
    { id: "START252D", platform: "codechef", sourceId: "START252", problems: [] },
  ];
  assert.equal(findTrackedContest(contests, "codeforces-official", "START252"), null);
  assert.equal(findTrackedContest(contests, "codechef", "START251"), null);
  assert.equal(findTrackedContest([], "codechef", "START252"), null);
  assert.equal(findTrackedContest(undefined, "codechef", "START252"), null);
});

test("a null entry in storage doesn't break the lookup", () => {
  // Backups have been seen carrying these; describeBackupProblem refuses them,
  // but the lookup runs against whatever is already stored.
  assert.equal(findTrackedContest([null, { id: "1", platform: "codeforces-official" }], "codeforces-official", "1")?.id, "1");
});

test("the queue label matches the badge wording, not a second vocabulary", () => {
  // "Contest 2237C" beside "Gym 703136K" reads as two kinds of thing, when
  // Official and Gym are two values of the same one.
  // Each platform states its own word now, rather than both reading
  // `contest.type` through a shared helper.
  assert.equal(
    getPlatform("codeforces-official").sourceLabel({ id: "2237" }, { index: "C" }),
    "Official 2237C",
  );
  assert.equal(
    getPlatform("codeforces-gyms").sourceLabel({ id: "703136" }, { index: "K" }),
    "Gym 703136K",
  );

  // Whatever the badge says is what the label says. Both Codeforces platforms,
  // since the two vocabularies could now drift apart in two files rather than
  // one.
  for (const id of ["codeforces-official", "codeforces-gyms"]) {
    const platform = getPlatform(id);
    const contest = { id: "1" };
    assert.ok(
      platform.sourceLabel(contest, { index: "A" }).startsWith(platform.contestFlags(contest)[0]),
      `${id}'s sourceLabel and contestFlags disagree`,
    );
  }
});


test("only Codeforces carries a row flag", () => {
  // "ABC" and "STARTERS" restated what the contest name and platform mark
  // already said. Codeforces official-vs-gym is the one subtype that changes
  // how the row reads, so it is the only one still drawn.
  const flagsFor = (platform, contest) => getPlatform(platform).contestFlags(contest);

  // The flag is the platform's now, not a reading of `contest.type` — which is
  // why each is asked of the platform that owns it.
  assert.deepEqual(flagsFor("codeforces-gyms", { id: 709413 }), ["Gym"]);
  assert.deepEqual(flagsFor("codeforces-official", { id: 2242 }), ["Official"]);
  assert.deepEqual(flagsFor("atcoder", { id: "abc466", type: "ABC" }), []);
  assert.deepEqual(flagsFor("codechef", { id: "START252D", type: "STARTERS" }), []);
});

test("only Codeforces hashes its contest id", () => {
  // A bare number needs "#" to read as an id; ABC466 and START252D do not.
  const label = (platform, contest) => getPlatform(platform).contestIdLabel(contest);

  assert.equal(label("codeforces-official", { id: 692934 }), "#692934");
  assert.equal(label("codeforces-official", { id: 2225 }), "#2225");
  assert.equal(label("atcoder", { id: "abc466" }), "abc466");
  // The division comes off: the same problem runs in all four, so naming one
  // overstates which contest the row is. The stored id keeps it.
  assert.equal(label("codechef", { id: "START252D" }), "START252");
  assert.equal(label("codechef", { id: "LTIME108" }), "LTIME108");
});

test("no platform decides whether a contest may wait", () => {
  // `mayBeUnpublished(subtype)` used to answer this, false for gyms so a
  // private one could never wait forever. It is gone: the distinction it drew
  // is now carried by the fact an adapter reports. A gym still running is
  // `notEndedYet` and bounded, because contests end; a finished gym with no
  // measurable field is `unavailable` and refuses outright. Naming the facts
  // precisely removed the need for a per-platform policy at all.
  for (const id of listPlatforms().map((p) => p.id)) {
    assert.equal(
      getPlatform(id).mayBeUnpublished,
      undefined,
      `${id} still declares a waiting policy of its own`,
    );
  }
});
