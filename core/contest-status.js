/**
 * What an adapter is allowed to answer when asked for a contest.
 *
 * Every `fetchContestRecord` returns exactly one of these. That closedness is
 * the point: before it, an adapter could return a contest, throw a *flagged*
 * error, or throw a bare `Error` with arbitrary prose — and the orchestrator
 * could classify the first two and only shrug at the third. CodeChef fell
 * through that gap entirely, failing hard where it should have waited, because
 * nothing said what an adapter owed.
 *
 * ## The naming rule
 *
 * **A fact must imply the same policy on every platform. If it doesn't, the
 * fact is too coarse.**
 *
 * There used to be one fact — "couldn't rate this contest" — covering both a
 * round whose standings had not settled (*the data is coming*) and a private
 * gym whose field will never be visible (*the data will never exist*). Those
 * need opposite handling, so a `mayBeUnpublished(subtype)` capability existed
 * purely to tell them apart afterwards, using the contest's subtype as a proxy.
 * Splitting the fact removed the need for the proxy, and the capability with
 * it. Resist re-merging them: the moment one status means different things on
 * different platforms, per-platform policy creeps back in.
 *
 * ## The two rules this vocabulary serves
 *
 * 1. The contest isn't ready → wait and retry, except where waiting is futile.
 * 2. The contest is ready but a problem has no rating → "???", and only on a
 *    platform with no estimator, and only once the site has had time to publish
 *    one. Never "we couldn't find out", and never "not yet".
 *
 * Rule 2 lives in `contest-manager.js` against `capabilities.canEstimate`,
 * because it applies to a contest that was fetched successfully. The "not yet"
 * half is the same gate: while the contest is younger than the platform's
 * `capabilities.ratingGraceMs`, a missing rating is `notPublishedYet` and waits
 * like any other, so a site that rates within days is not read as saying there
 * is no rating at all.
 */

/** The contest was read; `contest` holds the stored-shape record. */
export const READY = "ready";

/** Still running. Its results are partial, so anything derived would be wrong. */
export const NOT_ENDED_YET = "notEndedYet";

/** Finished, but the platform has not published what we need. It will. */
export const NOT_PUBLISHED_YET = "notPublishedYet";

/** We failed to ask — network, 403, 404, anything. Not "there is no answer". */
export const SOURCE_UNREACHABLE = "sourceUnreachable";

/** The source will never produce this. Waiting cannot help. */
export const UNAVAILABLE = "unavailable";

export const ready = (contest) => ({ status: READY, contest });
export const notEndedYet = (reason) => ({ status: NOT_ENDED_YET, reason });
export const notPublishedYet = (reason) => ({ status: NOT_PUBLISHED_YET, reason });
export const sourceUnreachable = (reason) => ({ status: SOURCE_UNREACHABLE, reason });
export const unavailable = (reason) => ({ status: UNAVAILABLE, reason });

/**
 * Whether this status is worth retrying on a later refresh.
 *
 * A property of the fact, not a per-platform decision — which is exactly what
 * the naming rule above buys. `unavailable` is the only failure that is not
 * worth retrying, and `retryWaitingContests` drops an entry that returns it.
 */
export function shouldWait(status) {
  return (
    status === NOT_ENDED_YET ||
    status === NOT_PUBLISHED_YET ||
    status === SOURCE_UNREACHABLE
  );
}

/** Guards against a typo'd status silently reading as an unknown failure. */
export function isKnownStatus(status) {
  return (
    status === READY ||
    status === UNAVAILABLE ||
    shouldWait(status)
  );
}
