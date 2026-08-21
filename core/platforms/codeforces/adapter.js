/**
 * Builds a complete contest record from Codeforces.
 *
 * This is the whole Codeforces acquisition pipeline — signed API plus
 * standings scrape plus the Elo estimator — behind one call. It used to sit
 * inline in contest-manager.js, which meant the orchestrator knew Codeforces'
 * response shapes. A second platform implements this same signature with a
 * completely different body; nothing above it changes.
 *
 * Returns a record whose problems all carry `rating`, `ratingSource`, `tags`
 * and `officialSolves`. A problem may still have `rating: null` if nothing
 * could rate it — deciding whether that is acceptable is the caller's job
 * (see `capabilities.allowsPartialRatings`).
 */
import { estimateProblemRating } from "../../rating-estimator.js";
import {
  getOfficialRatingDist,
  getGymRatingDist,
  distributionSize,
} from "../../get-rating-distribution.js";
import { getProblemStats } from "../../get-prob-stats.js";
import { syncOfficialProblemData } from "../../problemset-sync.js";
import { syncStartTimes } from "../../start-time-service.js";
import { CodeforcesService } from "../../services/codeforces-service.js";
import { loadCredentials } from "../../services/secure-store.js";
import { codeforces } from "./descriptor.js";

/**
 * Everything Codeforces needs to talk to its API: a signed service and the
 * handle whose submissions define "solved".
 *
 * Auth is per-platform — AtCoder needs only a handle, CodeChef reads both
 * from the page — so the orchestrator never sees a key or secret.
 *
 * @throws when the extension hasn't been configured yet.
 */
export async function createSession() {
  const [settings, { apiKey, apiSecret }] = await Promise.all([
    chrome.storage.local.get("upsolve_tracker.handle"),
    loadCredentials(),
  ]);

  if (!apiKey || !apiSecret) {
    throw new Error(
      "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
    );
  }

  return {
    service: new CodeforcesService(apiKey, apiSecret),
    handle: settings["upsolve_tracker.handle"],
  };
}

/**
 * The set of solved keys for this user, from their accepted submissions.
 *
 * Reads Codeforces' own submission shape (`verdict`, `problem.contestId`),
 * which is why it lives here rather than in a shared module.
 *
 * `contests` is unused: user.status returns the whole history in one call.
 * CodeChef answers per contest and does need it.
 */
export async function fetchSolvedKeys(session, _contests, onProgress = () => {}) {
  onProgress("Checking your submissions…");
  const submissions = await session.service.getUserStatus(session.handle);
  return new Set(
    submissions
      .filter((submission) => submission.verdict === "OK")
      .map((submission) =>
        codeforces.solvedKey(
          { id: submission.problem.contestId },
          { index: submission.problem.index },
        ),
      ),
  );
}


export async function fetchContestRecord({
  contestId,
  subtype,
  session,
  onProgress = () => {},
}) {
  const { service } = session;
  const type = subtype === "OFFICIAL" ? "contest" : "gym";

  onProgress("Reading the standings…");
  const { contestName, problems, tagsSynced, startTimeSeconds, solveCountsRead } =
    await getProblemStats(type, contestId, service);

  const contest = {
    id: contestId,
    platform: "codeforces",
    name: contestName,
    type: subtype,
    problems,
    tagsSyncedAt: tagsSynced ? Date.now() : null,
    startTimeSeconds,
    addedAt: Date.now(),
  };

  // Codeforces' own ratings are the same quantity the estimator approximates,
  // so take them where they exist. For a rated official contest this leaves
  // nothing to estimate, and the scraped solve counts stop mattering.
  await syncOfficialProblemData(service, [contest], onProgress);

  const needsEstimate = problems.filter((problem) => problem.rating === null);

  // Only now is it knowable whether the unreadable totals row actually
  // matters. Estimating from counts we failed to parse would silently invent
  // ratings, so refuse instead.
  if (needsEstimate.length > 0 && !solveCountsRead) {
    throw new Error(
      `Couldn't read the solve counts for ${type} ${contestId}, and ${needsEstimate.length} ` +
        `problem(s) have no published rating to fall back on. Codeforces may have changed ` +
        `its standings layout.`,
    );
  }

  if (needsEstimate.length > 0) {
    await estimateMissingRatings({
      contestId,
      type,
      service,
      needsEstimate,
      onProgress,
    });
  }

  await syncStartTimes(service, [contest], onProgress);

  return contest;
}

async function estimateMissingRatings({
  contestId,
  type,
  service,
  needsEstimate,
  onProgress,
}) {
  onProgress("Measuring the field…");

  let distribution = { strata: [] };
  if (type === "contest") {
    distribution = await getOfficialRatingDist(service, contestId, onProgress);
    // An empty ratingChanges means the round isn't rated yet — the freshly
    // finished contest you most want to upsolve. Fall back to the standings.
    if (distributionSize(distribution) === 0) {
      distribution = await getGymRatingDist(service, contestId);
    }
  } else {
    distribution = await getGymRatingDist(service, contestId);
  }

  console.log(
    `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
      `representing ~${Math.round(
        distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
      )}.`,
  );

  if (distributionSize(distribution) === 0) return;

  onProgress("Estimating problem ratings…");
  needsEstimate.forEach((problem) => {
    problem.rating = estimateProblemRating(distribution, problem.officialSolves);
    if (problem.rating !== null) problem.ratingSource = "estimated";
  });
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

/**
 * Confirms the stored handle is a real account, and returns it along with the
 * rating — both come from the one `user.info` call, so verifying costs nothing
 * beyond what fetching the rating already did.
 *
 * Note `user.status?handle=X` returns X's submissions no matter whose key
 * signs the request, so an unchecked handle silently yields someone else's
 * history. Hence this runs before anything reads solved status.
 *
 * @throws when no handle is set, or Codeforces does not know it.
 */
export async function verifyIdentity(session) {
  if (!session?.handle) {
    throw new Error("No Codeforces handle set. Add one in Settings.");
  }

  // The API answers a bad handle with a FAILED status, which the service turns
  // into a throw — so an unknown handle never reaches the next line.
  const users = await session.service.getUsersInfo([session.handle]);
  const user = users?.[0];

  if (!user?.handle) {
    throw new Error(`Codeforces doesn't recognise the handle "${session.handle}".`);
  }

  // Take Codeforces' own casing, so "Tourist" and "tourist" don't read as two
  // different accounts on the next comparison.
  return {
    username: user.handle,
    rating: typeof user.rating === "number" ? user.rating : null,
  };
}
