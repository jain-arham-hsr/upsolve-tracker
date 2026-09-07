/**
 * AtCoder's field: the contest's own standings, read whole.
 *
 * Failure here is a failure to *ask*. Standings need a session, and signed out
 * the refusal hook turns AtCoder's `/login` redirect into a throw — so the
 * contest waits and retries rather than storing a queue of "???" that a tab
 * would have filled. That is what `sourceUnreachable` is defined for, and it
 * is what lets `canEstimate` be true here without making a signed-out add fail.
 */
import { sourceUnreachable } from "../../contest-status.js";

/** @returns {Promise<object>} the standings payload, or `sourceUnreachable`. */
export async function readField({ contest, session, onProgress = () => {} }) {
  let standings;
  try {
    onProgress("Reading the standings…");
    standings = await session.sources.standings(contest.id);
  } catch (error) {
    return sourceUnreachable(
      `Couldn't read AtCoder's standings for ${contest.id}: ${error.message}. ` +
        `Open atcoder.jp in a tab and refresh — difficulty is worked out from ` +
        `the standings, which need you signed in.`,
    );
  }

  if (standings === null) {
    return sourceUnreachable(
      `AtCoder's standings for ${contest.id} were not in the expected shape, so ` +
        `there is no field to fit against yet.`,
    );
  }

  return standings;
}
