/**
 * What problems a Codeforces contest holds, and everything Codeforces itself
 * publishes about them.
 *
 * The whole acquisition pipeline — signed API plus standings scrape — behind one
 * call. It used to sit inline in contest-manager.js, which meant the
 * orchestrator knew Codeforces' response shapes.
 *
 * Estimation is deliberately *not* here: what this cannot rate is left as
 * `rating: null` and handed to `estimator.js`, so the two concerns can be read
 * apart. Every gate, though, does live here — the trunk should not learn that
 * this platform has five of them and AtCoder two.
 */
import { readSolveStats } from "./solve-stats.js";
import { syncOfficialProblemData, isInProblemset } from "./problemset-sync.js";
import { syncStartTimes } from "./start-times.js";
import { notEndedYet, notPublishedYet, sourceUnreachable } from "../../contest-status.js";

/**
 * @returns a contest-status when a gate fires, otherwise the raw record plus a
 *   `context` the estimator needs — which is also how the standings response
 *   reaches it without being fetched twice.
 */
export async function fetchContest(options) {
  try {
    return await acquire(options);
  } catch (error) {
    // Cloudflare challenged us. That is a failure to *ask*, not an answer — so
    // it waits and retries on the next refresh rather than failing the add and
    // making the user notice and click again. `unavailable` would be wrong:
    // the challenge clears on its own.
    if (error?.isSourceUnreachable) return sourceUnreachable(error.message);
    throw error;
  }
}

async function acquire({ contestId, subtype, session, onProgress = () => {} }) {
  const { service } = session;
  const type = subtype === "OFFICIAL" ? "contest" : "gym";

  // problemset.problems is where Codeforces publishes an official contest's
  // problems, and it publishes them already rated — a contest present but
  // unrated is a permanent oddity, not a stage it passes through. So its
  // absence is the whole "not published yet" question for an official round,
  // answered in one cached call before any scraping happens.
  //
  // Gyms are never in the problemset at all, so they must skip this: the same
  // check would make every gym unaddable.
  if (subtype === "OFFICIAL") {
    onProgress("Checking whether Codeforces has published it…");
    const published = await isInProblemset(service, contestId);
    if (!published) {
      return notPublishedYet(
        `Codeforces hasn't published contest ${contestId} yet. It'll be added ` +
          `on a refresh once it appears.`,
      );
    }
  }

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
  } = await readSolveStats(type, contestId, service);

  // A running gym has visible standings carrying partial solve counts, so the
  // estimator would fit them and store inflated difficulties — and a gym is the
  // one contest nothing ever re-rates, so those would be permanent. An official
  // round cannot reach here while running: it would not be in the problemset.
  //
  // `finished === null` means the source didn't say, and must proceed: refusing
  // on an unreadable phase would make a contest unaddable for a reason we
  // cannot state.
  if (subtype === "GYM" && finished === false) {
    return notEndedYet(
      `Gym ${contestId} is still running. It'll be added once it ends.`,
    );
  }

  const record = {
    id: contestId,
    name: contestName,
    // `type` is load-bearing here, not decoration. `problemset-sync.js#needsSync`
    // gates on `contest.type !== "OFFICIAL"` and `start-times.js` splits its
    // lookups by it, so a record without it silently skips both: an official
    // contest would keep `rating: null`, the estimator would then run on
    // problems Codeforces had already rated, and the queue would store
    // estimates — mean error ~211 — in place of published numbers.
    type: subtype,
    problems,
    publishedDataCheckedAt: tagsSynced ? Date.now() : null,
    startTimeSeconds,
  };

  // Codeforces' own ratings are the same quantity the estimator approximates,
  // so take them where they exist. For a rated official contest this leaves
  // nothing to estimate, and the scraped solve counts stop mattering.
  await syncOfficialProblemData(service, [record], onProgress);
  await syncStartTimes(service, [record], onProgress);

  return {
    ...record,
    // `standings` is passed, never stored: it is a whole contest's field — a
    // gym's, or ~8.5 MB of an official round's — and the built contest is what
    // gets written to chrome.storage. Both types carry it now, so neither has
    // to fetch the same response twice to measure the field.
    context: { type, subtype, solveCountsRead, partyHandles, standings },
  };
}

/**
 * Fills in metadata that arrives after a contest is added: published tags and
 * ratings, and start times. Both no-op once everything is resolved, so a
 * settled queue costs nothing.
 *
 * Contests must already be filtered to this platform — both helpers match on
 * bare contest ids.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  await syncOfficialProblemData(session.service, contests, onProgress);
  await syncStartTimes(session.service, contests, onProgress);
}
