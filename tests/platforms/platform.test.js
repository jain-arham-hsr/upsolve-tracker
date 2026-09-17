/**
 * The Platform base: what the registry refuses when it checks an instance,
 * what the account defaults do through the site's API, and what the base
 * checks at every boundary a subclass's answer crosses.
 *
 * Each case here was confirmed by removing the check it names and watching it
 * go green — a boundary assertion that has never fired is not yet evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Platform, DESCRIPTOR_MEMBERS } from "../../core/platforms/platform.js";
import { Api } from "../../core/platforms/api.js";
import { Scraper } from "../../core/platforms/scraper.js";
import { getPlatform } from "../../core/platforms/registry.js";
import { READY, SOURCE_UNREACHABLE, notEndedYet } from "../../core/contest-status.js";

/** An Api that answers the account questions from a table, and never fetches. */
class FakeApi extends Api {
  static known = { me: { username: "me", rating: 1500 } };
  static solved = [{ contest: { id: null }, problem: { index: "A" } }];
  constructor() { super({ client: { reset() {} } }); }
  static fromSettings() { return new FakeApi(); }
  static reset() {}
  async identity(handle) { return FakeApi.known[handle] ?? null; }
  async accepted() { return FakeApi.solved; }
}

/** The smallest complete subclass, over CodeChef's site and settings. */
function complete({ site = getPlatform("codechef").constructor.site, Api: api = FakeApi } = {}) {
  return class Fake extends Platform {
    static site = site;
    static Api = api;
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

test("a class declaring no site or no Api cannot even be constructed", () => {
  const NoSite = complete(); NoSite.site = null;
  assert.throws(() => new NoSite(), /declares no site/);
  const NoApi = complete(); NoApi.Api = null;
  assert.throws(() => new NoApi(), /declares no Api class/);
  // A scraper is optional, but what is declared has to be a class.
  const BadScraper = complete(); BadScraper.Scraper = {};
  assert.throws(() => new BadScraper(), /Scraper that is not a class/);
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

  class Mute extends FakeApi {}
  Mute.prototype.accepted = undefined;
  assert.throws(() => build(complete({ Api: Mute })), /fetchAccepted\(\), or its API accepted\(\)/);
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

test("ratingGraceMs is optional, but a declared one must be a usable duration", () => {
  // Optional is the load-bearing half: every double in this file declares only
  // publishesTags and canEstimate, and requiring a third key would fail them
  // all for a reason that has nothing to do with what they are testing.
  assert.ok(build(complete()), "a platform declaring no window is fine");

  // `capabilities` is a class *field*, so it has to be replaced on the instance
  // — assigning to the prototype leaves the field shadowing it, and the check
  // then reads the original and passes for the wrong reason.
  const declaring = (ratingGraceMs) => {
    const instance = new (complete())();
    instance.capabilities = { publishesTags: true, canEstimate: false, ratingGraceMs };
    return instance;
  };

  assert.throws(() => Platform.check(declaring(-1)), /not a duration in ms/);
  assert.throws(() => Platform.check(declaring("a week")), /not a duration in ms/);
  assert.throws(() => Platform.check(declaring(Infinity)), /not a duration in ms/);
});

test("a window declared on a platform that estimates is refused as config that does nothing", () => {
  // `contest-manager.js` reads the window only after the canEstimate branch has
  // not thrown, so on an estimating platform it is unreachable. Declared there
  // it would look live, and a reader would reasonably expect it to be honoured.
  const Estimator = complete();
  Estimator.prototype.readField = async () => ({});
  Estimator.prototype.estimate = () => {};
  const estimator = new Estimator();
  estimator.capabilities = { publishesTags: true, canEstimate: true, ratingGraceMs: 1000 };
  assert.throws(() => Platform.check(estimator), /canEstimate: true, where it is never read/);
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
  assert.ok(session.api instanceof FakeApi);
});

test("a session with no handle field, or no Api, is refused at the boundary", async () => {
  const NoHandle = complete();
  NoHandle.prototype.buildSession = () => ({ signedIn: true, api: new FakeApi() });
  await assert.rejects(() => build(NoHandle).createSessionFrom({}), /codechef built a session with no handle/);

  // A plain object with the right methods is not enough: the seam every
  // platform shares is a Source, and a session that carries something else
  // has reached the site some other way.
  const NoApi = complete();
  NoApi.prototype.buildSession = () => ({ handle: "me", api: { json() {} } });
  await assert.rejects(() => build(NoApi).createSessionFrom({}), /carries no Api/);

  // And a scraper, where one is carried, has to be a Scraper — a plain object
  // with a `document` method would work until the first page it read.
  const BadScraper = complete();
  BadScraper.prototype.buildSession = () => ({ handle: "me", api: new FakeApi(), scraper: { document() {} } });
  await assert.rejects(() => build(BadScraper).createSessionFrom({}), /scraper is not a Scraper/);
  const NoScraper = complete();
  NoScraper.prototype.buildSession = () => ({ handle: "me", api: new FakeApi(), scraper: null });
  assert.equal((await build(NoScraper).createSessionFrom({})).scraper, null);
});

test("the default identify asks the source about the handle, and refuses a blank or unknown one", async () => {
  const platform = build(complete());
  const api = new FakeApi();
  assert.deepEqual(await platform.verifyIdentity({ handle: "me", api }), { username: "me", rating: 1500 });
  await assert.rejects(() => platform.verifyIdentity({ handle: "", api }), /No CodeChef handle set/);
  await assert.rejects(() => platform.verifyIdentity({ handle: "nobody", api }), /doesn't recognise the handle "nobody"/);
});

test("an identity with no username or a non-numeric rating is refused", async () => {
  class Blank extends FakeApi { async identity() { return { username: "", rating: 1 }; } }
  await assert.rejects(() => build(complete({ Api: Blank })).verifyIdentity({ handle: "x", api: new Blank() }), /no username/);
  class Weird extends FakeApi { async identity() { return { username: "me", rating: "1500" }; } }
  await assert.rejects(() => build(complete({ Api: Weird })).verifyIdentity({ handle: "x", api: new Weird() }), /neither a number nor null/);
});

test("the default fetchAccepted maps the source's accepted pairs through solvedKey", async () => {
  const keys = await build(complete()).fetchSolvedKeys({ handle: "me", api: new FakeApi() }, []);
  assert.deepEqual([...keys], ["codechef:A"]);
});

test("an accepted pair with a bare null contest is refused", async () => {
  class Bare extends FakeApi { async accepted() { return [{ contest: null, problem: { index: "A" } }]; } }
  await assert.rejects(() => build(complete({ Api: Bare })).fetchSolvedKeys({ handle: "me", api: new Bare() }, []), /without a contest object/);
});

test("the default syncStartTimes dates from the source's contest list, and does nothing without one", async () => {
  const platform = build(complete());
  const undated = { id: "7", startTimeSeconds: null };
  assert.equal(await platform.syncStartTimes({ api: new FakeApi() }, [undated]), 0);
  assert.equal(undated.startTimeSeconds, null);

  class Listing extends FakeApi { async contestList() { return [{ id: 7, startTimeSeconds: 1234 }]; } }
  assert.equal(await build(complete({ Api: Listing })).syncStartTimes({ api: new Listing() }, [undated]), 1);
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
