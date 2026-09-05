import {
  NOT_ENDED_YET,
  NOT_PUBLISHED_YET,
  SOURCE_UNREACHABLE,
} from "../contest-status.js";

/**
 * Why a contest is waiting, in the user's terms.
 *
 * Three facts wait — `notEndedYet`, `notPublishedYet` and `sourceUnreachable` —
 * and until recently only one of them could reach this code, so the sentence
 * was written for that one and hardcoded. When a Cloudflare block started
 * answering `sourceUnreachable`, a seven-month-old finished contest was told it
 * "isn't published yet", which is simply false and reads as a bug in the
 * extension rather than a hiccup at the platform.
 *
 * `contest-manager.js` has always recorded the real cause on `contestStatus`;
 * this is the thing that reads it. When a status is added, the fallback keeps
 * the sentence honest rather than confidently wrong.
 */
export function waitingExplanation(error, contestId) {
  const tail = "It'll be retried on a refresh — cancel it under Contests.";

  switch (error.contestStatus) {
    case NOT_PUBLISHED_YET:
      return `${contestId} isn't published yet. ${tail}`;
    case NOT_ENDED_YET:
      return `${contestId} hasn't finished yet. ${tail}`;
    case SOURCE_UNREACHABLE:
      // The adapter's own sentence: it is the only one that can say *what*
      // could not be reached, and for a Cloudflare block it is also the only
      // one that tells the user what to do about it.
      return `${error.message} ${tail}`;
    default:
      return `${contestId} couldn't be added yet. ${tail}`;
  }
}
