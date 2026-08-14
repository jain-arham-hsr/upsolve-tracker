import { estimateProblemRating } from "./rating-estimator.js";
import { LocalDB } from "./services/storage.js";
import { CodeforcesService } from "./services/codeforces-service.js";
import {
  getOfficialRatingDist,
  getGymRatingDist,
  distributionSize,
} from "./get-rating-distribution.js";
import { getProblemStats } from "./get-prob-stats.js";
import { buildSolvedKeys } from "./progress-manager.js";
import { loadCredentials } from "./services/secure-store.js";
import { syncOfficialProblemData } from "./problemset-sync.js";
import { syncStartTimes } from "./start-time-service.js";

export async function processNewContest(url, onProgress = () => {}) {
  try {
    const match = url.match(/(contest|gym)\/(\d+)/i);
    if (!match) throw new Error("Invalid Codeforces URL");

    const type = match[1].toLowerCase();
    const contestId = match[2];

    const [storageSettings, { apiKey, apiSecret }] = await Promise.all([
      chrome.storage.local.get("cf_trainer.handle"),
      loadCredentials(),
    ]);

    const handle = storageSettings["cf_trainer.handle"];

    if (!apiKey || !apiSecret) {
      throw new Error(
        "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
      );
    }

    const cfService = new CodeforcesService(apiKey, apiSecret);

    onProgress("Reading the standings…");
    const {
      contestName,
      problems,
      tagsSynced,
      startTimeSeconds,
      solveCountsRead,
    } = await getProblemStats(type, contestId, cfService);

    const contestData = {
      id: contestId,
      name: contestName,
      type: type === "contest" ? "OFFICIAL" : "GYM",
      problems,
      tagsSyncedAt: tagsSynced ? Date.now() : null,
      startTimeSeconds,
      addedAt: Date.now(),
    };

    // Codeforces' own ratings are the same quantity the estimator approximates,
    // so take them where they exist. For a rated official contest this leaves
    // nothing to estimate, and the scraped solve counts stop mattering.
    await syncOfficialProblemData(cfService, [contestData], onProgress);

    const needsEstimate = problems.filter(
      (problem) => problem.rating === null,
    );

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
      onProgress("Measuring the field…");
      let distribution = { strata: [] };
      if (type === "contest") {
        distribution = await getOfficialRatingDist(
          cfService,
          contestId,
          onProgress,
        );
        if (distributionSize(distribution) === 0) {
          distribution = await getGymRatingDist(cfService, contestId);
        }
      } else {
        distribution = await getGymRatingDist(cfService, contestId);
      }

      console.log(
        `[Contest Manager] Distribution: ${distributionSize(distribution)} competitors read, ` +
          `representing ~${Math.round(
            distribution.strata.reduce(
              (sum, s) => sum + s.ratings.length * s.scale,
              0,
            ),
          )}.`,
      );

      if (distributionSize(distribution) > 0) {
        onProgress("Estimating problem ratings…");
        needsEstimate.forEach((problem) => {
          problem.rating = estimateProblemRating(
            distribution,
            problem.officialSolves,
          );
          if (problem.rating !== null) problem.ratingSource = "estimated";
        });
      }
    }

    // --- REMOVED THE 1500 FALLBACK COMPLETELY ---

    onProgress("Checking your submissions…");
    const solvedKeys = await buildSolvedKeys(cfService, handle);

    let solvedCount = 0;
    problems.forEach((prob) => {
      if (solvedKeys.has(`${contestId}-${prob.index}`)) {
        prob.solved = true;
        solvedCount++;
      }
    });

    if (solvedCount === problems.length && problems.length > 0) {
      throw new Error(
        `All problems in ${type === "contest" ? "Official" : "Gym"} contest ${contestId} are already solved!`,
      );
    }

    // --- RESTORED YOUR STRICT VALIDATION ---
    const missing = problems.filter((problem) => problem.rating === null);

    await syncStartTimes(cfService, [contestData], onProgress);

    if (missing.length === 0) {
      onProgress("Saving to your queue…");
      await LocalDB.addTrackedContest(contestData);
    } else {
      console.warn("[Contest Manager] Skipping storage. Missing ratings.");
      throw new Error(
        missing.length === problems.length
          ? `Couldn't rate this contest: Codeforces returned no participant ratings for ${contestId}. Private or unrated standings can't be measured.`
          : `Couldn't rate ${missing.length} of ${problems.length} problems (${missing.map((p) => p.index).join(", ")}), so the contest wasn't added.`,
      );
    }

    return contestData;
  } catch (error) {
    console.error("[Contest Manager] Failed:", error);
    throw error;
  }
}
