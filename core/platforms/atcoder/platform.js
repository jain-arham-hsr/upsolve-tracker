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
import { atcoder } from "./descriptor.js";
import { sources } from "./sources.js";
import { readField } from "./field.js";
import { estimate } from "./estimator.js";
import { sync as syncEstimates } from "./sync/estimates.js";
import { notPublishedYet } from "../../contest-status.js";

const HANDLE_KEY = "upsolve_tracker.atcoder_handle";

export class AtCoder extends Platform {
  static settingsSection = "atcoder";

  constructor() {
    super(atcoder);
    this.sources = sources;
  }

  buildSession(values) {
    return { handle: values[HANDLE_KEY], sources: this.sources };
  }

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

  readField(args) {
    return readField(args);
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

  /** One pass: re-estimate what was added without a readable field. */
  syncMetadata(session, contests, onProgress = () => {}) {
    return syncEstimates(session, contests, onProgress);
  }
}
