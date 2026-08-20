/**
 * Orchestrates adding a contest, and nothing else.
 *
 * Everything site-specific — auth, fetching, rating, solved history — lives
 * behind the platform adapter. This file only decides *which* platform, and
 * what to do with what comes back.
 */
import { LocalDB } from "./services/storage.js";
import { matchContestUrl } from "./platforms/registry.js";
import { getAdapter } from "./platforms/adapters.js";
import {
  getEffectiveRatings,
  storeFetchedRatings,
} from "./services/user-ratings.js";

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
    await ensureUserRating(platform.id, adapter, session);

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
 * Makes sure we know the user's rating on this platform before their first
 * refresh.
 *
 * Without it, a fresh install adds a contest and every row shows an em dash
 * for solve chance until the first sync — the queue is ordered, but by the
 * fallback rather than by anything meaningful.
 *
 * Only fetched when the platform is absent entirely. A stored null means "we
 * asked and there was no rating", which is an answer and not worth re-asking
 * on every add. Failure is non-fatal: ordering degrades to native ratings,
 * which is not worth losing a contest over.
 */
async function ensureUserRating(platformId, adapter, session) {
  if (typeof adapter.fetchUserRating !== "function") return;

  const known = await getEffectiveRatings();
  if (platformId in known) return;

  try {
    await storeFetchedRatings({
      [platformId]: await adapter.fetchUserRating(session),
    });
  } catch (error) {
    console.warn(`[Contest Manager] ${platformId} rating lookup failed:`, error.message);
  }
}
