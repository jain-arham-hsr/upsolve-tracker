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
import { syncOfficialTags } from "./tag-service.js";
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
    const { contestName, problems, tagsSynced, startTimeSeconds } =
      await getProblemStats(type, contestId, cfService);

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
      problems.forEach((problem) => {
        if (problem.rating === null) {
          problem.rating = estimateProblemRating(
            distribution,
            problem.officialSolves,
          );
        }
      });
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

    console.table(problems);

    // --- RESTORED YOUR STRICT VALIDATION ---
    const allRated = problems.every((problem) => problem.rating !== null);

    const contestData = {
      id: contestId,
      name: contestName,
      type: type === "contest" ? "OFFICIAL" : "GYM",
      problems,
      tagsSyncedAt: tagsSynced ? Date.now() : null,
      startTimeSeconds,
      addedAt: Date.now(),
    };

    await syncOfficialTags(cfService, [contestData], onProgress);
    await syncStartTimes(cfService, [contestData], onProgress);

    if (allRated) {
      onProgress("Saving to your queue…");
      await LocalDB.addTrackedContest(contestData);
    } else {
      console.warn("[Contest Manager] Skipping storage. Missing ratings.");
      const missing = problems.filter((problem) => problem.rating === null);
      throw new Error(
        distributionSize(distribution) === 0
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
