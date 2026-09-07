/**
 * What an official Codeforces round holds, and everything Codeforces publishes
 * about it.
 *
 * **The whole acquisition path, and it touches no HTML.** One unsigned
 * `contest.standings` call carries the contest name, the problems in order with
 * their published ratings and tags, the start time, and rows enough to count
 * in-contest solves — and to measure the field when nothing else can.
 *
 * Estimation is deliberately *not* here: what this cannot rate is left as
 * `rating: null` and handed to `estimator.js`, so the two concerns read apart.
 * Every gate, though, does live here — the trunk should not learn that this
 * platform has gates at all.
 *
 * This and its gym counterpart were one file with three `subtype` branches in
 * it, plus three more spread across the modules below. The folder answers that
 * question now, so neither pipeline asks it.
 */


import { readSolveStats, isInProblemset } from "./sources.js";
import { syncPublishedProblemData } from "./sync/published-data.js";
import { syncStartTimes } from "./sync/start-times.js";
import { notPublishedYet } from "../../contest-status.js";

/**
 * @returns a contest-status when a gate fires, otherwise the raw record plus a
 *   `context` the estimator needs — which is also how the standings response
 *   reaches it without being fetched twice.
 */
export async function fetchContest({ contestId, session, onProgress = () => {} }) {
  const { sources } = session;

  // problemset.problems is where Codeforces publishes an official contest's
  // problems, and it publishes them already rated — a contest present but
  // unrated is a permanent oddity, not a stage it passes through. So its
  // absence is the whole "not published yet" question, answered in one cached
  // call before anything expensive happens.
  //
  // There is no equivalent gate on a gym: gyms are absent from the problemset
  // entirely, so applying this to them would make every gym unaddable. That
  // asymmetry is why the two pipelines are two files.
  onProgress("Checking whether Codeforces has published it…");
  if (!(await isInProblemset(sources, contestId))) {
    return notPublishedYet(
      `Codeforces hasn't published contest ${contestId} yet. It'll be added ` +
        `on a refresh once it appears.`,
    );
  }

  onProgress("Reading the standings…");
  const { contestName, problems, startTimeSeconds, solveCountsRead, standings } =
    await readSolveStats(contestId, sources);

  // A running round cannot reach here — it would not be in the problemset — so
  // unlike the gym pipeline this needs no phase check of its own.
  const record = {
    id: contestId,
    name: contestName,
    problems,
    // Stamped, not null. `readSolveStats` has already applied every rating and
    // tag the standings carry, so we genuinely did ask the site — and calling
    // the re-check here would re-fetch the same ~6.5 MB response to learn
    // nothing. A round Codeforces has not rated yet stores estimates and is
    // settled later by `published-sync.js`.
    publishedDataCheckedAt: Date.now(),
    startTimeSeconds,
  };

  await syncStartTimes(sources, [record], onProgress);

  return {
    ...record,
    // `standings` is passed, never stored: ~8.5 MB of one round's field, where
    // the built contest is what gets written to chrome.storage. The estimator
    // measures the field from these rows, so passing it is what stops the same
    // response being fetched a second time.
    context: { solveCountsRead, standings },
  };
}

/**
 * Fills in metadata that arrives after a contest is added: published tags and
 * ratings, and start times. Both no-op once everything is resolved, so a
 * settled queue costs nothing.
 *
 * Contests are already filtered to this platform by `progress-manager.js`, and
 * both helpers match on bare contest ids.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  await syncPublishedProblemData(session.sources, contests, onProgress);
  await syncStartTimes(session.sources, contests, onProgress);
}
