/**
 * The Platform base: what it refuses at construction, and what it checks at
 * every boundary a subclass's answer crosses.
 *
 * Each case here was confirmed by removing the check it names and watching it
 * go green — a boundary assertion that has never fired is not yet evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Platform, DESCRIPTOR_MEMBERS } from "../core/platforms/platform.js";
import { Source } from "../core/platforms/source.js";
import { atcoder } from "../core/platforms/atcoder/descriptor.js";
import { codechef } from "../core/platforms/codechef/descriptor.js";
import { READY, SOURCE_UNREACHABLE, notEndedYet } from "../core/contest-status.js";

/** A Source with a client that is never called. */
const FAKE_SOURCE = new Source({ client: { reset() {} } });

/** The smallest complete subclass, over a real descriptor. */
function complete(descriptor = codechef, overrides = {}) {
  return class Fake extends Platform {
    static settingsSection = descriptor.id === "atcoder" ? "atcoder" : "codechef";
    constructor() { super(descriptor); Object.assign(this, overrides); }
    buildSession(values) {
      return { handle: values["upsolve_tracker.codechef_handle"] ?? "me", sources: FAKE_SOURCE };
    }
    async identify() { return { username: "me", rating: 1500 }; }
    async fetchContest({ contestId }) {
      return {
        id: contestId, name: "A Contest", startTimeSeconds: 1, publishedDataCheckedAt: 2,
        problems: [{ index: "A", name: "Alpha" }],
      };
    }
    async fetchAccepted() { return [{ contest: { id: null }, problem: { index: "A" } }]; }
  };
}

// Over a descriptor that estimates, the fake has to estimate too.
function completeEstimating(descriptor) {
  const Fake = complete(descriptor);
  Fake.prototype.fill = async () => {};
  return Fake;
}

test("a descriptor missing a member is refused by name", () => {
  for (const member of DESCRIPTOR_MEMBERS) {
    const partial = { ...codechef };
    delete partial[member];
    const Fake = complete(partial);
    assert.throws(() => new Fake(), new RegExp(`missing ${member}`), member);
  }
});

test("a subclass missing a hook is refused at construction, by hook name", () => {
  for (const hook of ["buildSession", "identify", "fetchContest", "fetchAccepted"]) {
    const Fake = complete();
    delete Fake.prototype[hook];
    assert.throws(() => new Fake(), new RegExp(`must implement ${hook}\\(\\)`), hook);
  }
});

test("canEstimate and fill() are one fact, refused in both directions", () => {
  // Claims the capability, provides no estimator.
  const Claims = complete({ ...codechef, capabilities: { ...codechef.capabilities, canEstimate: true } });
  assert.throws(() => new Claims(), /declares canEstimate: true but does not implement fill/);

  // Provides an estimator, declares none.
  const Estimates = complete();
  Estimates.prototype.fill = async () => {};
  assert.throws(() => new Estimates(), /implements fill\(\) but its descriptor declares canEstimate: false/);
});

test("a settings section the schema does not declare is refused", () => {
  const Fake = complete();
  Fake.settingsSection = "nowhere";
  assert.throws(() => new Fake(), /settings section "nowhere"/);
});

test("the slugs come from the schema section, declared once", () => {
  const Fake = completeEstimating(atcoder);
  assert.deepEqual(new Fake().settingSlugs, ["upsolve_tracker.atcoder_handle"]);
});

test("a session with no handle field, or no Source, is refused at the boundary", async () => {
  const NoHandle = complete();
  NoHandle.prototype.buildSession = () => ({ signedIn: true, sources: FAKE_SOURCE });
  await assert.rejects(() => new NoHandle().createSessionFrom({}), /codechef built a session with no handle/);

  // A plain object with the right methods is not enough: the seam every
  // platform shares is a Source, and a session that carries something else
  // has reached the site some other way.
  const NoSource = complete();
  NoSource.prototype.buildSession = () => ({ handle: "me", sources: { document() {} } });
  await assert.rejects(() => new NoSource().createSessionFrom({}), /carries no Source/);
});

test("an identity with no username or a non-numeric rating is refused", async () => {
  const Blank = complete();
  Blank.prototype.identify = async () => ({ username: "", rating: 1 });
  await assert.rejects(() => new Blank().verifyIdentity({}), /no username/);

  const Weird = complete();
  Weird.prototype.identify = async () => ({ username: "me", rating: "1500" });
  await assert.rejects(() => new Weird().verifyIdentity({}), /neither a number nor null/);
});

test("fetchContestRecord builds the stored shape from what a platform acquired", async () => {
  const Fake = complete();
  const result = await new Fake().fetchContestRecord({ contestId: "X", subtype: "STARTERS", session: {} });

  assert.equal(result.status, READY);
  assert.equal(result.contest.platform, "codechef");
  assert.equal(result.contest.type, "STARTERS");
  assert.deepEqual(result.contest.problems[0].tags, [], "problem defaults are filled");
  assert.equal("context" in result.contest, false, "context is passed, never stored");
});

test("a status from fetchContest passes straight through", async () => {
  const Fake = complete();
  Fake.prototype.fetchContest = async () => notEndedYet("still running");
  const result = await new Fake().fetchContestRecord({ contestId: "X", session: {} });
  assert.equal(result.status, notEndedYet("").status);
  assert.equal(result.reason, "still running");
});

test("a flagged failure to ask becomes sourceUnreachable; an unflagged one escapes", async () => {
  const Flagged = complete();
  Flagged.prototype.fetchContest = async () => {
    throw Object.assign(new Error("cloudflare"), { isSourceUnreachable: true });
  };
  const result = await new Flagged().fetchContestRecord({ contestId: "X", session: {} });
  assert.equal(result.status, SOURCE_UNREACHABLE);

  const Bare = complete();
  Bare.prototype.fetchContest = async () => { throw new Error("layout changed"); };
  await assert.rejects(() => new Bare().fetchContestRecord({ contestId: "X", session: {} }), /layout changed/);
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
    await assert.rejects(
      () => new Fake().fetchContestRecord({ contestId: "X", session: {} }),
      /^Error: codechef acquired/,
      label,
    );
  }
});

test("an accepted pair with a bare null contest is refused", async () => {
  const Fake = complete();
  Fake.prototype.fetchAccepted = async () => [{ contest: null, problem: { index: "A" } }];
  await assert.rejects(() => new Fake().fetchSolvedKeys({}, []), /without a contest object/);
});

test("fetchSolvedKeys maps every accepted pair through the descriptor's solvedKey", async () => {
  const keys = await new (complete())().fetchSolvedKeys({}, []);
  assert.deepEqual([...keys], ["codechef:A"]);
});

test("describeIdentity defaults to 'Connected as', and syncMetadata to nothing", async () => {
  const platform = new (complete())();
  assert.equal(platform.describeIdentity({ username: "me" }), "Connected as me.");
  assert.equal(await platform.syncMetadata({}, []), undefined);
});
