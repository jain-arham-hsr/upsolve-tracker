/**
 * AtCoder.
 *
 * Needs no key or secret — only a handle, which is a *parameter* to the routes
 * rather than state on the client, so one Source serves every session.
 *
 * Whose account this is: AtCoder is asked *about* a handle, so submissions are
 * the configured handle's whoever is signed in. `identify` therefore refuses a
 * mismatch only on positive evidence — the signed-in name differs — and lets a
 * signed-out session or a missing marker proceed, since adding a contest has
 * to keep working without a session.
 *
 * Solved status is read per contest. AtCoder publishes no per-user submission
 * list, so the only route to a submission is through the contest that hosted
 * it: one request per tracked contest per refresh, and a task solved in an
 * untracked contest never clears. Nothing AtCoder publishes would answer it.
 */
import { Platform } from "../platform.js";
import { site } from "./site.js";
import { AtCoderSources } from "./sources.js";
import { estimate } from "./estimator.js";
import { notPublishedYet, sourceUnreachable } from "../../contest-status.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?atcoder\.jp\/contests\/([A-Za-z0-9_-]+)/i;

/** `/contests/archive` is the contest *list*, not a contest. */
const NOT_CONTESTS = new Set(["archive"]);

const SUBTYPES = [
  [/^abc\d/i, "ABC", "ABC"],
  [/^arc\d/i, "ARC", "ARC"],
  [/^agc\d/i, "AGC", "AGC"],
  [/^ahc\d/i, "AHC", "AHC"],
];

/** A stuck contest must not cost a standings fetch on every single refresh. */
const MAX_RE_ESTIMATES_PER_SYNC = 1;

export class AtCoder extends Platform {
  static site = site;
  static Sources = AtCoderSources;

  id = "atcoder";

  label = "AtCoder";

  shortLabel = "AC";

  subtypes = [...SUBTYPES.map(([, value, label]) => ({ value, label })), { value: "OTHER", label: "Other" }];

  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;

    const contestId = match[1];
    if (NOT_CONTESTS.has(contestId.toLowerCase())) return null;
    return { contestId, subtype: subtypeFor(contestId) };
  }

  contestUrl(contest) {
    return `${this.origin}/contests/${contest.id}`;
  }

  /** The task id is the problem's identity; without it the contest is the best link, degraded not fabricated. */
  problemUrl(contest, problem) {
    if (!problem?.problemId) return this.contestUrl(contest);
    return `${this.contestUrl(contest)}/tasks/${problem.problemId}`;
  }

  /** Display-only, e.g. "ABC466 C". */
  sourceLabel(contest, problem) {
    return `${String(contest.id).toUpperCase()} ${problem.index}`;
  }

  filterGroups = [{ key: "atcoder", label: "AtCoder" }];

  filterKey() {
    return "atcoder";
  }

  /** Nothing about an AtCoder round changes how its row should be read. */
  contestFlags() {
    return [];
  }

  contestLabel() {
    return "AtCoder contest";
  }

  /** Already a code, not a number — no "#" needed to say so. */
  contestIdLabel(contest) {
    return String(contest.id);
  }

  /**
   * Keyed on the task id, not contest + index: the same problem appears in
   * several contests, and solving it once should clear it everywhere.
   */
  solvedKey(contest, problem) {
    return `atcoder:${problem?.problemId ?? `${contest.id}-${problem?.index}`}`;
  }

  problemKey(contest, problem) {
    return this.solvedKey(contest, problem);
  }

  capabilities = {
    // AtCoder publishes no problem tags at all — not "none yet", none ever —
    // so the stats panel drops its tag section rather than heading an empty one.
    publishesTags: false,
    // AtCoder publishes no difficulty either, so every rating here is fitted
    // locally over the contest's own standings. A leftover null is therefore
    // a fault, not a fact about the problem; a field that could not be read
    // is `sourceUnreachable` and waits.
    canEstimate: true,
  };

  // ── the work ──────────────────────────────────────────────────────────

  /**
   * Confirms the handle exists, reads its rating, and checks it is yours where
   * the page can say. Every page AtCoder serves carries `var userScreenName`.
   *
   * @throws when no handle is set, AtCoder has no such user, or the signed-in
   *   account contradicts the configured one.
   */
  async identify(session) {
    if (!session?.handle) {
      throw new Error("No AtCoder handle set. Add one in Settings.");
    }

    let profile;
    try {
      profile = await session.sources.profile(session.handle);
    } catch (error) {
      if (error?.status === 404) {
        throw new Error(`AtCoder has no user "${session.handle}".`);
      }
      throw error;
    }

    const { signedInAs } = profile;

    if (signedInAs && signedInAs.toLowerCase() !== session.handle.toLowerCase()) {
      // Flagged, not matched on the sentence, so a copy edit cannot change
      // which failures callers treat as fatal.
      const error = new Error(
        `Settings has the AtCoder handle "${session.handle}", but this browser is ` +
          `signed in as "${signedInAs}". Fix the handle, or the queue will track ` +
          `somebody else's progress.`,
      );
      error.isIdentityMismatch = true;
      throw error;
    }

    return {
      // AtCoder's own casing where we have it, so "Tourist" and "tourist" do
      // not read as two accounts on the next comparison.
      username: signedInAs || session.handle,
      // Null rather than a default when the page shape changes: a substituted
      // rating would mis-sort every AtCoder problem in the queue.
      rating: profile.rating,
    };
  }

  /**
   * One public page — `/contests/<id>/tasks` — carries the name, the schedule
   * and every problem with its task id. Difficulty is not here: AtCoder
   * publishes none, so `fill` fits it from the standings.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    onProgress("Reading the contest's problems…");
    const tasks = await session.sources.contestTasks(contestId);

    // Before a contest ends its task list is not public. That resolves on its
    // own once it finishes, so it waits rather than failing.
    if (tasks === null) {
      return notPublishedYet(
        `AtCoder isn't showing the problems for "${contestId}" yet. A contest that ` +
          `hasn't finished won't list them.`,
      );
    }

    return {
      id: contestId,
      name: tasks.name,
      startTimeSeconds: tasks.startTimeSeconds,
      // When this contest was last asked about — `syncMetadata` orders its
      // rotation by this, so it is stamped here and again on every attempt.
      publishedDataCheckedAt: Date.now(),
      problems: tasks.problems.map((task) => ({
        index: task.index,
        problemId: task.problemId,
        name: task.name,
        // Filled by the estimator, or left null and rendered "???".
        rating: null,
        ratingSource: null,
      })),
    };
  }

  /**
   * The contest's own standings, read whole. Failure here is a failure to
   * *ask*: standings need a session, and signed out the refusal hook turns
   * AtCoder's `/login` redirect into a throw — so the contest waits and
   * retries rather than storing a queue of "???" that a tab would have filled.
   * That is what lets `canEstimate` be true without making a signed-out add fail.
   *
   * @returns {Promise<object>} the standings payload, or `sourceUnreachable`.
   */
  async readField({ contest, session, onProgress = () => {} }) {
    let standings;
    try {
      onProgress("Reading the standings…");
      standings = await session.sources.standings(contest.id);
    } catch (error) {
      return sourceUnreachable(
        `Couldn't read AtCoder's standings for ${contest.id}: ${error.message}. ` +
          `Open atcoder.jp in a tab and refresh — difficulty is worked out from ` +
          `the standings, which need you signed in.`,
      );
    }

    if (standings === null) {
      return sourceUnreachable(
        `AtCoder's standings for ${contest.id} were not in the expected shape, so ` +
          `there is no field to fit against yet.`,
      );
    }

    return standings;
  }

  estimate(contest, field) {
    return estimate(contest, field);
  }

  /**
   * @returns {Promise<Array<{contest: object, problem: object}>>} the contest
   *   id is null because an AtCoder problem is identified by its task id alone.
   */
  async fetchAccepted(session, contests, onProgress = () => {}) {
    if (!session.handle) return [];

    const accepted = [];
    for (const [i, contest] of contests.entries()) {
      onProgress(`Checking your AtCoder submissions… (${i + 1}/${contests.length})`);

      // Deliberately not caught: signed out, this throws rather than answering
      // with an empty set. An empty answer is indistinguishable from having
      // solved nothing, and `solved` is sticky, so a swallowed failure would
      // strand the queue silently. `progress-manager` isolates the throw.
      for (const problemId of await session.sources.acceptedTaskIds(contest.id, session.handle)) {
        accepted.push({ contest: { id: null }, problem: { problemId } });
      }
    }

    return accepted;
  }

  /**
   * Rates contests that were added without a readable field — added signed
   * out, say. Difficulty never changes once a contest has ended, so a rated
   * contest is never re-read.
   *
   * Capped at one contest per refresh: a standings payload is around a
   * megabyte, and a contest that can never be rated would otherwise levy that
   * cost forever. Longest-unasked first is what makes the cap safe — sliced in
   * stored order, the first unrated contest was retried every refresh and
   * everything behind it never. The Codeforces re-check has no cap,
   * deliberately: it has a six-week cutoff instead, and a cap on top of a
   * cutoff starves.
   *
   * @returns {Promise<number>} problems that gained a difficulty
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    const unrated = contests
      .filter((contest) => contest.problems.some((problem) => problem.rating === null))
      .sort((a, b) => (a.publishedDataCheckedAt ?? 0) - (b.publishedDataCheckedAt ?? 0));

    if (unrated.length === 0) return 0;

    let resolved = 0;
    for (const contest of unrated.slice(0, MAX_RE_ESTIMATES_PER_SYNC)) {
      const before = contest.problems.filter((p) => p.rating !== null).length;

      // The same read-then-fit the base runs at add time; a failed read answers
      // with a status and leaves the contest for the next refresh.
      await this.estimateMissing({ contest, session, onProgress });

      // Stamped on the attempt, not on success: stamping only on success would
      // leave a contest that can never be rated first in the sort forever.
      contest.publishedDataCheckedAt = Date.now();

      resolved += contest.problems.filter((p) => p.rating !== null).length - before;
    }

    if (resolved > 0) {
      console.log(`[AtCoder] ${resolved} problem(s) gained an estimated difficulty.`);
    }
    return resolved;
  }
}

function subtypeFor(contestId) {
  for (const [pattern, value] of SUBTYPES) {
    if (pattern.test(contestId)) return value;
  }
  return "OTHER";
}
