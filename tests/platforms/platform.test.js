/**
 * The Platform base: what the registry refuses when it checks an instance,
 * what the account defaults do through the site's source, and what the base
 * checks at every boundary a subclass's answer crosses.
 *
 * Each case here was confirmed by removing the check it names and watching it
 * go green — a boundary assertion that has never fired is not yet evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Platform, DESCRIPTOR_MEMBERS } from "../../core/platforms/platform.js";
import { Source } from "../../core/platforms/source.js";
import { getPlatform } from "../../core/platforms/registry.js";
import { READY, SOURCE_UNREACHABLE, notEndedYet } from "../../core/contest-status.js";

/** A Source that answers the account questions from a table, and never fetches. */
class FakeSources extends Source {
  static known = { me: { username: "me", rating: 1500 } };
  static solved = [{ contest: { id: null }, problem: { index: "A" } }];
  constructor() { super({ client: { reset() {} } }); }
  static fromSettings() { return new FakeSources(); }
  static reset() {}
  async identity(handle) { return FakeSources.known[handle] ?? null; }
  async accepted() { return FakeSources.solved; }
}

/** The smallest complete subclass, over CodeChef's site and settings. */
function complete({ site = getPlatform("codechef").constructor.site, Sources = FakeSources } = {}) {
  return class Fake extends Platform {
    static site = site;
    static Sources = Sources;
    id = "codechef";
    label = "Fake";
    shortLabel = "FK";
    subtypes = [];
    matchUrl() { return null; }
    contestUrl() { return ""; }
    problemUrl() { return ""; }
    sourceLabel() { return ""; }
    filterGroups = [];
    filterKey() { return "codechef"; }
    contestFlags() { return []; }
    contestLabel() { return ""; }
    contestIdLabel() { return ""; }
    solvedKey(contest, problem) { return `codechef:${problem.index}`; }
    problemKey(contest, problem) { return this.solvedKey(contest, problem); }
    chartColor = "#000";
    capabilities = { publishesTags: true, canEstimate: false };

    async fetchContest({ contestId }) {
      return {
        id: contestId, name: "A Contest", startTimeSeconds: 1, publishedDataCheckedAt: 2,
        problems: [{ index: "A", name: "Alpha" }],
      };
    }
  };
}

const build = (Fake) => Platform.check(new Fake());

test("a class declaring no site or no Sources cannot even be constructed", () => {
  const NoSite = complete(); NoSite.site = null;
  assert.throws(() => new NoSite(), /declares no site/);
  const NoSources = complete(); NoSources.Sources = null;
  assert.throws(() => new NoSources(), /declares no Sources class/);
});

test("the site's object is taken on: origin, host permission, mark, settings section", () => {
  const platform = build(complete());
  assert.equal(platform.origin, "https://www.codechef.com");
  assert.deepEqual(platform.hostPermissions, ["*://*.codechef.com/*"]);
  assert.ok(platform.icon.includes("<svg"));
  assert.equal(platform.settingsSection, "codechef");
});

test("an instance missing a describing member is refused by name", () => {
  for (const member of DESCRIPTOR_MEMBERS) {
    const platform = new (complete())();
    delete platform[member];
    if (!(member in platform)) {
      assert.throws(() => Platform.check(platform), new RegExp(`missing ${member}`), member);
    }
  }
});

test("a class without fetchContest, or without any way to read accepted submissions, is refused", () => {
  const NoFetch = complete(); delete NoFetch.prototype.fetchContest;
  assert.throws(() => build(NoFetch), /must implement fetchContest\(\)/);

  class Mute extends FakeSources {}
  Mute.prototype.accepted = undefined;
  assert.throws(() => build(complete({ Sources: Mute })), /fetchAccepted\(\), or its source accepted\(\)/);
});

test("canEstimate, readField() and estimate() are one fact, refused in every direction", () => {
  const Claims = complete();
  Claims.prototype.capabilities = undefined;
  const claims = new Claims(); claims.capabilities = { publishesTags: true, canEstimate: true };
  assert.throws(() => Platform.check(claims), /declares canEstimate: true but implements neither/);

  const Estimates = complete();
  Estimates.prototype.readField = async () => ({});
  Estimates.prototype.estimate = () => {};
  assert.throws(() => build(Estimates), /but declares canEstimate: false/);

  const ReadsOnly = complete(); ReadsOnly.prototype.readField = async () => ({});
  assert.throws(() => build(ReadsOnly), /readField\(\) without estimate\(\)/);
  const FitsOnly = complete(); FitsOnly.prototype.estimate = () => {};
  assert.throws(() => build(FitsOnly), /estimate\(\) without readField\(\)/);
});

test("a settings section the schema does not declare is refused", () => {
  const Fake = complete({ site: { ...getPlatform("codechef").constructor.site, settingsSection: "nowhere" } });
  assert.throws(() => build(Fake), /settings section "nowhere"/);
});

test("the slugs and the handle slug come from the schema section, declared once", () => {
  const platform = build(complete());
  assert.deepEqual(platform.settingSlugs, ["upsolve_tracker.codechef_handle"]);
  assert.equal(platform.handleSlug, "upsolve_tracker.codechef_handle");
});

test("the default session is the handle from settings and the source built from them", async () => {
  const session = await build(complete()).createSessionFrom({ "upsolve_tracker.codechef_handle": "me" });
  assert.equal(session.handle, "me");
  assert.ok(session.sources instanceof FakeSources);
});

test("a session with no handle field, or no Source, is refused at the boundary", async () => {
  const NoHandle = complete();
  NoHandle.prototype.buildSession = () => ({ signedIn: true, sources: new FakeSources() });
  await assert.rejects(() => build(NoHandle).createSessionFrom({}), /codechef built a session with no handle/);

  // A plain object with the right methods is not enough: the seam every
  // platform shares is a Source, and a session that carries something else
  // has reached the site some other way.
  const NoSource = complete();
  NoSource.prototype.buildSession = () => ({ handle: "me", sources: { document() {} } });
  await assert.rejects(() => build(NoSource).createSessionFrom({}), /carries no Source/);
});

test("the default identify asks the source about the handle, and refuses a blank or unknown one", async () => {
  const platform = build(complete());
  const sources = new FakeSources();
  assert.deepEqual(await platform.verifyIdentity({ handle: "me", sources }), { username: "me", rating: 1500 });
  await assert.rejects(() => platform.verifyIdentity({ handle: "", sources }), /No CodeChef handle set/);
  await assert.rejects(() => platform.verifyIdentity({ handle: "nobody", sources }), /doesn't recognise the handle "nobody"/);
});

test("an identity with no username or a non-numeric rating is refused", async () => {
  class Blank extends FakeSources { async identity() { return { username: "", rating: 1 }; } }
  await assert.rejects(() => build(complete({ Sources: Blank })).verifyIdentity({ handle: "x", sources: new Blank() }), /no username/);
  class Weird extends FakeSources { async identity() { return { username: "me", rating: "1500" }; } }
  await assert.rejects(() => build(complete({ Sources: Weird })).verifyIdentity({ handle: "x", sources: new Weird() }), /neither a number nor null/);
});

test("the default fetchAccepted maps the source's accepted pairs through solvedKey", async () => {
  const keys = await build(complete()).fetchSolvedKeys({ handle: "me", sources: new FakeSources() }, []);
  assert.deepEqual([...keys], ["codechef:A"]);
});

test("an accepted pair with a bare null contest is refused", async () => {
  class Bare extends FakeSources { async accepted() { return [{ contest: null, problem: { index: "A" } }]; } }
  await assert.rejects(() => build(complete({ Sources: Bare })).fetchSolvedKeys({ handle: "me", sources: new Bare() }, []), /without a contest object/);
});

test("the default syncStartTimes dates from the source's contest list, and does nothing without one", async () => {
  const platform = build(complete());
  const undated = { id: "7", startTimeSeconds: null };
  assert.equal(await platform.syncStartTimes({ sources: new FakeSources() }, [undated]), 0);
  assert.equal(undated.startTimeSeconds, null);

  class Listing extends FakeSources { async contestList() { return [{ id: 7, startTimeSeconds: 1234 }]; } }
  assert.equal(await build(complete({ Sources: Listing })).syncStartTimes({ sources: new Listing() }, [undated]), 1);
  assert.equal(undated.startTimeSeconds, 1234);
});

test("estimateMissing reads the field once, fits in place, and passes a status through", async () => {
  const Fake = complete();
  const reads = [];
  Fake.prototype.readField = async ({ contest }) => { reads.push(contest.id); return { size: 1 }; };
  Fake.prototype.estimate = (contest, field) => {
    for (const problem of contest.problems) if (problem.rating === null) problem.rating = field.size * 100;
  };
  const platform = new Fake();
  platform.capabilities = { publishesTags: true, canEstimate: true };
  Platform.check(platform);

  const contest = { id: "x", problems: [{ index: "A", rating: null }, { index: "B", rating: 2000 }] };
  assert.equal(await platform.estimateMissing({ contest, session: {} }), undefined);
  assert.deepEqual(contest.problems.map((p) => p.rating), [100, 2000]);

  // Nothing unrated: no read at all.
  await platform.estimateMissing({ contest, session: {} });
  assert.deepEqual(reads, ["x"]);

  // A status from the read is the answer, and nothing is fitted.
  Fake.prototype.readField = async () => notEndedYet("no field");
  const untouched = { id: "y", problems: [{ index: "A", rating: null }] };
  assert.equal((await platform.estimateMissing({ contest: untouched, session: {} })).reason, "no field");
  assert.equal(untouched.problems[0].rating, null);
});

test("fetchContestRecord builds the stored shape from what a platform acquired", async () => {
  const result = await build(complete()).fetchContestRecord({ contestId: "X", subtype: "STARTERS", session: {} });
  assert.equal(result.status, READY);
  assert.equal(result.contest.platform, "codechef");
  assert.equal(result.contest.type, "STARTERS");
  assert.deepEqual(result.contest.problems[0].tags, [], "problem defaults are filled");
  assert.equal("context" in result.contest, false, "context is passed, never stored");
});

test("a status from fetchContest passes straight through", async () => {
  const Fake = complete();
  Fake.prototype.fetchContest = async () => notEndedYet("still running");
  const result = await build(Fake).fetchContestRecord({ contestId: "X", session: {} });
  assert.equal(result.status, notEndedYet("").status);
  assert.equal(result.reason, "still running");
});

test("a flagged failure to ask becomes sourceUnreachable; an unflagged one escapes", async () => {
  const Flagged = complete();
  Flagged.prototype.fetchContest = async () => {
    throw Object.assign(new Error("cloudflare"), { isSourceUnreachable: true });
  };
  assert.equal((await build(Flagged).fetchContestRecord({ contestId: "X", session: {} })).status, SOURCE_UNREACHABLE);

  const Bare = complete();
  Bare.prototype.fetchContest = async () => { throw new Error("layout changed"); };
  await assert.rejects(() => build(Bare).fetchContestRecord({ contestId: "X", session: {} }), /layout changed/);
});

test("an acquired contest missing its parts is refused, naming the platform", async () => {
  for (const [label, acquired] of [
    ["no id", { name: "n", problems: [], startTimeSeconds: 1, publishedDataCheckedAt: 1 }],
    ["no name", { id: "X", problems: [], startTimeSeconds: 1, publishedDataCheckedAt: 1 }],
    ["no problems array", { id: "X", name: "n", startTimeSeconds: 1, publishedDataCheckedAt: 1 }],
    ["a nameless problem", { id: "X", name: "n", problems: [{ index: "A" }], startTimeSeconds: 1, publishedDataCheckedAt: 1 }],
    ["no startTimeSeconds", { id: "X", name: "n", problems: [], publishedDataCheckedAt: 1 }],
  ]) {
    const Fake = complete();
    Fake.prototype.fetchContest = async () => acquired;
    await assert.rejects(() => build(Fake).fetchContestRecord({ contestId: "X", session: {} }), /^Error: codechef acquired/, label);
  }
});

test("describeIdentity defaults to 'Connected as', and syncMetadata to nothing", async () => {
  const platform = build(complete());
  assert.equal(platform.describeIdentity({ username: "me" }), "Connected as me.");
  assert.equal(await platform.syncMetadata({}, []), undefined);
});
