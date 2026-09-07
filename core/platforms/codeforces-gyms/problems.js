/**
 * What a Codeforces gym holds, and everything Codeforces publishes about it.
 *
 * **The only Codeforces path that scrapes.** A gym's roster has no API source:
 * `contest.standings` needs signing, and a gym whose standings Codeforces has
 * hidden answers `FAILED` to it outright. So the roster comes off the standings
 * page, with the `/gym/<id>` problems page as the fallback when even that is
 * gone.
 *
 * Estimation is deliberately *not* here: what this cannot rate is left as
 * `rating: null` and handed to `estimator.js`, so the two concerns read apart.
 * Every gate, though, does live here — the trunk should not learn that this
 * platform has gates at all.
 *
 * This and its official counterpart were one file with three `subtype` branches
 * in it, plus three more spread across the modules below. The folder answers
 * that question now, so neither pipeline asks it.
 */

import { readSolveStats } from "./sources.js";
import { syncStartTimes } from "./sync/start-times.js";
import { notEndedYet } from "../../contest-status.js";

/**
 * @returns a contest-status when a gate fires, otherwise the raw record plus a
 *   `context` the estimator needs — which is also how the standings response
 *   reaches it without being fetched twice.
 */
export async function fetchContest({ contestId, session, onProgress = () => {} }) {
  const { service } = session;

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
  } = await readSolveStats(contestId, service);

  // A running gym has visible standings carrying partial solve counts, so the
  // estimator would fit them and store inflated difficulties — and a gym is the
  // one contest nothing ever re-rates, so those would be permanent.
  //
  // `finished === null` means the source didn't say, and must proceed: refusing
  // on an unreadable phase would make a contest unaddable for a reason we
  // cannot state. There is no equivalent check on the official pipeline, which
  // is gated on the problemset instead — a running round cannot be in it.
  if (finished === false) {
    return notEndedYet(
      `Gym ${contestId} is still running. It'll be added once it ends.`,
    );
  }

  const record = {
    id: contestId,
    name: contestName,
    problems,
    publishedDataCheckedAt: tagsSynced ? Date.now() : null,
    startTimeSeconds,
  };

  // No problemset sync here: gyms are absent from problemset.problems entirely.
  // Their tags and published ratings come off the standings response instead,
  // which `solve-stats.js` has already applied by this point.
  await syncStartTimes(service, [record], onProgress);

  return {
    ...record,
    // `standings` is passed, never stored: it is a whole gym's field, and the
    // built contest is what gets written to chrome.storage.
    context: { solveCountsRead, partyHandles, standings },
  };
}

/**
 * Fills in metadata that arrives after a contest is added — here, only start
 * times. A gym's rating is inherited from an already-rated archive problem, so
 * unlike Codeforces' editable tags it never appears later, and re-checking
 * would cost one `contest.standings` per gym per refresh forever.
 *
 * Contests are already filtered to this platform by `progress-manager.js`, and
 * the helper matches on bare contest ids.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  await syncStartTimes(session.service, contests, onProgress);
}
