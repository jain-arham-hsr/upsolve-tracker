/**
 * Start times for gyms: the bulk `contest.list?gym=true` first, then one
 * `contest.standings` each for whatever it did not cover. Private gyms and
 * mashups (the 6xxxxx ids) never appear in the list; most are dated at add
 * time from the standings already in hand, and this covers the rest.
 */
import { sync as fromList } from "../../sync/start-times.js";

export async function sync(session, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) => !contest.startTimeSeconds);
  if (pending.length === 0) return 0;

  let resolved = await fromList(session, contests, onProgress);

  const gyms = pending.filter((contest) => !contest.startTimeSeconds);
  for (const [index, contest] of gyms.entries()) {
    // Deliberately slow — the API pacer spaces these — so it counts itself off.
    onProgress(`Dating gym ${index + 1} of ${gyms.length}…`);
    try {
      const standings = await session.sources.getContestStandings(contest.id);
      const startTime = standings?.contest?.startTimeSeconds;
      if (startTime) {
        contest.startTimeSeconds = startTime;
        resolved++;
      }
    } catch (error) {
      console.warn(`[Start Times] Gym ${contest.id} standings failed:`, error.message);
    }
  }

  return resolved;
}
