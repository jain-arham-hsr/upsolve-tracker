/**
 * Orchestrates adding a contest, and nothing else.
 *
 * Everything site-specific — auth, fetching, rating, solved history — lives
 * behind the platform. This file only decides *which* platform, and
 * what to do with what comes back.
 */
import { LocalDB } from "./services/storage.js";
import { matchContestUrl } from "./platforms/registry.js";
import { READY, isKnownStatus, shouldWait } from "./contest-status.js";
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

    const session = await platform.createSession();

    // Adding reads user-specific data too — CodeChef's problemsstats carries
    // solved status — so the identity has to be settled here as well, not just
    // on refresh.
    await establishIdentity(platform, session);

    const result = await platform.fetchContestRecord({
      contestId,
      subtype,
      session,
      onProgress,
    });

    // The one place a status becomes an outcome, and it consults nothing about
    // the platform. That is the property the vocabulary exists to give: a fact
    // named precisely enough implies the same policy everywhere, so there is no
    // per-platform judgement left for an adapter to make on its own — which is
    // how AtCoder used to grant itself waiting by setting the flag directly.
    if (!isKnownStatus(result?.status)) {
      throw new Error(
        `${platform.label} returned an unrecognised status for ${contestId}. ` +
          `This is a bug in its platform.`,
      );
    }
    if (result.status !== READY) {
      const error = new Error(result.reason);
      // `shouldWait` is a property of the fact. `unavailable` is the one
      // failure retrying cannot fix, so it alone reaches the user as a refusal.
      if (shouldWait(result.status)) error.isNotPublishedYet = true;
      error.contestStatus = result.status;
      throw error;
    }

    const contest = result.contest;

    const solvedKeys = await platform.fetchSolvedKeys(session, [contest], onProgress);

    let solvedCount = 0;
    contest.problems.forEach((prob) => {
      if (solvedKeys.has(platform.solvedKey(contest, prob))) {
        prob.solved = true;
        solvedCount++;
      }
    });

    if (solvedCount === contest.problems.length && contest.problems.length > 0) {
      const error = new Error(
        `All problems in ${platform.contestLabel(contest)} ${contestId} are already solved!`,
      );
      // Flagged so a waiting entry can stop waiting for a contest it will
      // never be given. Matching the sentence instead would break on a copy
      // edit and leave the entry retrying forever.
      error.isAlreadySolved = true;
      throw error;
    }

    // The gap policy. There is deliberately no default rating: a fabricated number
    // would sort like a real one and quietly corrupt the queue's whole point.
    //
    // What a gap means follows from one fact — can this platform estimate?
    // Where it can, the estimator should already have filled the gap, so one
    // left over means something broke and the contest is refused. Where it
    // cannot, the site simply has not rated that problem, and it stores as null
    // and shows "???". Deriving both from `canEstimate` is what stops the two
    // being declared separately and drifting apart.
    const missing = contest.problems.filter((problem) => problem.rating === null);

    if (missing.length > 0 && platform.capabilities.canEstimate) {
      console.warn("[Contest Manager] Skipping storage. Missing ratings.");
      // Not a waiting case. Reaching here means the platform can estimate and
      // still left a gap, which is a fault rather than a delay — an adapter
      // that knows the data is merely late says so with `notPublishedYet`
      // before ever getting this far.
      throw new Error(
        missing.length === contest.problems.length
          ? `Couldn't rate this contest: ${platform.label} produced no rating for any problem in ${contestId}.`
          : `Couldn't rate ${missing.length} of ${contest.problems.length} problems (${missing
              .map((p) => p.index)
              .join(", ")}), so the contest wasn't added.`,
      );
    }

    onProgress("Saving to your queue…");
    await LocalDB.addTrackedContest(contest);

    return contest;
  } catch (error) {
    // A contest the platform has not published yet is an expected outcome, not
    // a fault: it is caught, remembered and retried. It must not reach
    // chrome://extensions, which would collect it once per add and then again
    // on every refresh for as long as it waits, turning a working feature into
    // a growing list of entries that read as a broken extension.
    //
    // `info`, not `warn`: that page gathers **both** error *and* warning
    // levels, so downgrading to console.warn only changed the icon from a red
    // circle to a yellow triangle. console.info is still there in DevTools and
    // is not collected.
    if (error.isNotPublishedYet) {
      console.info("[Contest Manager] Not published yet:", error.message);
    } else {
      console.error("[Contest Manager] Failed:", error);
    }
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
async function establishIdentity(platform, session) {
  // Fatal on purpose. You cannot add a platform's contest without its handle:
  // the contest would go in unmarked, its solved problems would never clear,
  // and it would look like the sync was merely slow. On CodeChef it is
  // stronger still — adding reads problemsstats, so the wrong account signed
  // in would write their solves onto a contest you just added.
  const identity = await platform.verifyIdentity(session);
  const verdict = await settleIdentity(platform, identity);

  if (verdict === "changed") {
    // Stale flags belong to the previous account. Unlike the refresh, nothing
    // is held in memory here, so this reads and writes storage directly.
    const contests = await LocalDB.getTrackedContests();
    const cleared = clearSolvedForPlatform(contests, platform.id);
    if (cleared > 0) await LocalDB.saveTrackedContests(contests);
  }

  await storeFetchedRatings({ [platform.id]: identity.rating });
}
