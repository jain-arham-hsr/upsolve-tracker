import { estimateProblemRating } from "./rating-estimator.js";
import { LocalDB } from "./services/storage.js";
import { CodeforcesService } from "./services/codeforces-service.js";
import {
  getOfficialRatingDist,
  getGymRatingDist,
} from "./get-rating-distribution.js";
import { getProblemStats } from "./get-prob-stats.js";
import { buildSolvedKeys } from "./progress-manager.js";
import { loadCredentials } from "./services/secure-store.js";
import { syncOfficialTags } from "./tag-service.js";

export async function processNewContest(url) {
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
      throw new Error("Missing API credentials. Please set them in Options.");
    }

    const cfService = new CodeforcesService(apiKey, apiSecret);

    const { contestName, problems, tagsSynced } = await getProblemStats(
      type,
      contestId,
      cfService,
    );

    let participantRatings = [];
    if (type === "contest") {
      participantRatings = await getOfficialRatingDist(cfService, contestId);
      if (participantRatings.length === 0) {
        participantRatings = await getGymRatingDist(cfService, contestId);
      }
    } else {
      participantRatings = await getGymRatingDist(cfService, contestId);
    }

    console.log(
      `[Contest Manager] Total rated participants found: ${participantRatings.length}`,
    );

    if (participantRatings.length > 0) {
      problems.forEach((problem) => {
        if (problem.rating === null) {
          problem.rating = estimateProblemRating(
            participantRatings,
            problem.officialSolves,
          );
        }
      });
    }

    // --- REMOVED THE 1500 FALLBACK COMPLETELY ---

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
      tagsSynced,
      addedAt: Date.now(),
    };

    await syncOfficialTags(cfService, [contestData]);

    if (allRated) {
      await LocalDB.addTrackedContest(contestData);
    } else {
      console.warn("[Contest Manager] Skipping storage. Missing ratings.");
      throw new Error(
        "Failed to estimate ratings. Check console for API errors.",
      );
    }

    return contestData;
  } catch (error) {
    console.error("[Contest Manager] Failed:", error);
    throw error;
  }
}
