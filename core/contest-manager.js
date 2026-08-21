/**
 * Orchestrates adding a contest, and nothing else.
 *
 * Everything site-specific — auth, fetching, rating, solved history — lives
 * behind the platform adapter. This file only decides *which* platform, and
 * what to do with what comes back.
 */
import { LocalDB } from "./services/storage.js";
import { matchContestUrl, DEFAULT_PLATFORM_ID } from "./platforms/registry.js";
import { getAdapter } from "./platforms/adapters.js";
import { storeFetchedRatings } from "./services/user-ratings.js";
import {
  settleIdentity,
  clearSolvedForPlatform,
} from "./services/platform-identity.js";

export async function processNewContest(url, onProgress = () => {}) {
  try {
    const parsed = matchContestUrl(url);
    if (!parsed) throw new Error("Not a supported contest URL.");

    const { platform, contestId, subtype } = parsed;

    const adapter = getAdapter(platform.id);
    if (!adapter) {
      throw new Error(`${platform.label} contests aren't supported yet.`);
    }

    const session = await adapter.createSession();

    // Adding reads user-specific data too — CodeChef's problemsstats carries
    // solved status — so the identity has to be settled here as well, not just
    // on refresh.
    await establishIdentity(platform, adapter, session);

    const contest = await adapter.fetchContestRecord({
      contestId,
      subtype,
      session,
      onProgress,
    });

    const solvedKeys = await adapter.fetchSolvedKeys(session, [contest], onProgress);

    let solvedCount = 0;
    contest.problems.forEach((prob) => {
      if (solvedKeys.has(platform.solvedKey(contest, prob))) {
        prob.solved = true;
        solvedCount++;
      }
    });

    if (solvedCount === contest.problems.length && contest.problems.length > 0) {
      throw new Error(
        `All problems in ${platform.contestLabel(contest)} ${contestId} are already solved!`,
      );
    }

    // There is deliberately no default rating here. A fabricated number would
    // sort like a real one and quietly corrupt the queue's whole point.
    // Platforms that publish their own difficulty may store a contest with
    // gaps — those show as "???" and converge on a later refresh — while
    // Codeforces, where the estimator fills every gap, refuses loudly.
    const missing = contest.problems.filter((problem) => problem.rating === null);

    if (missing.length > 0 && !platform.capabilities.allowsPartialRatings) {
      console.warn("[Contest Manager] Skipping storage. Missing ratings.");
      throw new Error(
        missing.length === contest.problems.length
          ? `Couldn't rate this contest: ${platform.label} returned no participant ratings for ${contestId}. Private or unrated standings can't be measured.`
          : `Couldn't rate ${missing.length} of ${contest.problems.length} problems (${missing
              .map((p) => p.index)
              .join(", ")}), so the contest wasn't added.`,
      );
    }

    onProgress("Saving to your queue…");
    await LocalDB.addTrackedContest(contest);

    return contest;
  } catch (error) {
    console.error("[Contest Manager] Failed:", error);
    throw error;
  }
}

/**
 * Confirms whose account this is before any user-specific data is read, and
 * records the rating while it is at it. Refuses if the platform has no handle.
 *
 * Both facts come from one call, so this costs a single request — and on
 * CodeChef none at all, since the bootstrap object was already fetched to
 * create the session.
 *
 * It also removes the old first-run wrinkle: before this, ratings only arrived
 * on a refresh, so a fresh install added a contest and then showed an em dash
 * for every solve chance until the first sync.
 */
async function establishIdentity(platform, adapter, session) {
  // Fatal on purpose. You cannot add a platform's contest without its handle:
  // the contest would go in unmarked, its solved problems would never clear,
  // and it would look like the sync was merely slow. On CodeChef it is
  // stronger still — adding reads problemsstats, so the wrong account signed
  // in would write their solves onto a contest you just added.
  const identity = await adapter.verifyIdentity(session);
  const verdict = await settleIdentity(platform, identity);

  if (verdict === "changed") {
    // Stale flags belong to the previous account. Unlike the refresh, nothing
    // is held in memory here, so this reads and writes storage directly.
    const contests = await LocalDB.getTrackedContests();
    const cleared = clearSolvedForPlatform(
      contests,
      platform.id,
      DEFAULT_PLATFORM_ID,
    );
    if (cleared > 0) await LocalDB.saveTrackedContests(contests);
  }

  await storeFetchedRatings({ [platform.id]: identity.rating });
}
