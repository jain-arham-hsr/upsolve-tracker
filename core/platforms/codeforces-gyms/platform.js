/**
 * Codeforces, gyms.
 *
 * A visible gym reads everything from the signed `contest.standings` call. A
 * gym whose standings the setter hid answers FAILED to it, and is the one
 * Codeforces path that still scrapes: the `/gym/<id>` problems page is the
 * only page those contests render, and the field is recovered from who
 * submitted, via `contest.status`.
 */
import { Platform } from "../platform.js";
import { codeforcesGyms } from "./descriptor.js";
import * as identity from "./identity.js";
import * as submissions from "./submissions.js";
import { fill } from "./estimator.js";
import { readSolveStats } from "./sources.js";
import { syncStartTimes } from "./sync/start-times.js";
import { notEndedYet } from "../../contest-status.js";

export class CodeforcesGyms extends Platform {
  static settingsSection = "codeforces";

  constructor() {
    super(codeforcesGyms);
  }

  buildSession(values) {
    return identity.createSessionFrom(values);
  }

  identify(session) {
    return identity.verifyIdentity(session);
  }

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — the standings response, or the party handles when
   *   the standings are hidden.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { sources } = session;

    onProgress("Reading the standings…");
    const {
      contestName,
      problems,
      tagsSynced,
      startTimeSeconds,
      solveCountsRead,
      partyHandles,
      finished,
      standings,
    } = await readSolveStats(contestId, sources);

    // A running gym has visible standings carrying partial solve counts, so
    // the estimator would fit them and store inflated difficulties — and a gym
    // is the one contest nothing ever re-rates. `finished === null` means the
    // source did not say, and proceeds: refusing on an unreadable phase would
    // make a contest unaddable for a reason we cannot state.
    if (finished === false) {
      return notEndedYet(`Gym ${contestId} is still running. It'll be added once it ends.`);
    }

    const record = {
      id: contestId,
      name: contestName,
      problems,
      publishedDataCheckedAt: tagsSynced ? Date.now() : null,
      startTimeSeconds,
    };

    // No problemset sync: gyms are absent from problemset.problems entirely.
    // Tags and published ratings came off the standings response instead.
    await syncStartTimes(sources, [record], onProgress);

    return {
      ...record,
      // Passed, never stored: a whole gym's field has no business in storage.
      context: { solveCountsRead, partyHandles, standings },
    };
  }

  fill(args) {
    return fill(args);
  }

  fetchAccepted(session, contests, onProgress) {
    return submissions.fetchAccepted(session, contests, onProgress);
  }

  /**
   * Only start times. A gym's rating is inherited from an already-rated
   * archive problem, so unlike Codeforces' editable tags it never appears
   * later, and re-checking would cost one `contest.standings` per gym per
   * refresh forever.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await syncStartTimes(session.sources, contests, onProgress);
  }
}
