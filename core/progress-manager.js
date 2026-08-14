import { CodeforcesService } from "./services/codeforces-service.js";
import { LocalDB } from "./services/storage.js";
import { loadCredentials } from "./services/secure-store.js";
import { syncOfficialTags } from "./tag-service.js";

/**
 * Fetches all accepted submissions for a user and returns them as a Set
 * of "contestId-index" keys for fast lookup.
 * @param {CodeforcesService} cfService
 * @param {string} handle
 * @returns {Promise<Set<string>>}
 */
export async function buildSolvedKeys(cfService, handle) {
  const submissions = await cfService.getUserStatus(handle);
  return new Set(
    submissions
      .filter((s) => s.verdict === "OK")
      .map((s) => `${s.problem.contestId}-${s.problem.index}`),
  );
}

/**
 * Reconciles local contest data with Codeforces submission history.
 * Updates the 'solved' status for individual problems and removes
 * contests that are 100% completed.
 * * @returns {Promise<Object[]>} List of {type, id} for contests removed.
 */
export async function updateSolvedStatus() {
  // 1. Fetch credentials from storage
  const [storageSettings, { apiKey, apiSecret }] = await Promise.all([
    chrome.storage.local.get("cf_trainer.handle"),
    loadCredentials(),
  ]);

  const handle = storageSettings["cf_trainer.handle"];

  // Exit if credentials haven't been set up yet
  if (!handle || !apiKey || !apiSecret) {
    console.warn("[Progress Manager] Missing API credentials. Skipping sync.");
    return [];
  }

  // 2. Initialize service and fetch solved keys
  const cfService = new CodeforcesService(apiKey, apiSecret);
  const solvedKeys = await buildSolvedKeys(cfService, handle);

  // 3. Update the Queue
  const trackedContests = await LocalDB.getTrackedContests();

  // Backfill tags for contests queued before tags were captured. No-ops once
  // everything is tagged, so it only costs a request on the first refresh.
  await syncOfficialTags(cfService, trackedContests);
  const updatedContests = [];
  const removedDetails = [];

  for (const contest of trackedContests) {
    let allSolved = true;

    // Update the 'solved' boolean for every problem in the contest
    contest.problems.forEach((prob) => {
      // Check if problem is in the latest "OK" submissions
      if (solvedKeys.has(`${contest.id}-${prob.index}`)) {
        prob.solved = true;
      }

      // If any problem remains unsolved, the contest isn't finished
      if (!prob.solved) {
        allSolved = false;
      }
    });

    if (allSolved) {
      // Contest is finished: Capture details for the UI alert and exclude from update
      removedDetails.push({
        type: contest.type === "OFFICIAL" ? "Official contest" : "Gym contest",
        id: contest.id,
      });
    } else {
      // Contest still has pending problems: Keep it in the list
      updatedContests.push(contest);
    }
  }

  // 4. Persist the updated state to Local Storage
  await LocalDB.saveTrackedContests(updatedContests);

  return removedDetails;
}
