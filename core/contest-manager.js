/**
 * Orchestrates adding a contest, and nothing else.
 *
 * Everything site-specific — auth, fetching, rating, solved history — lives
 * behind the platform. This file only decides *which* platform, and
 * what to do with what comes back.
 */
import { LocalDB } from "./services/storage.js";
import { contestKey, makeContestKey, matchContestUrl } from "./platforms/registry.js";
import {
  READY,
  NOT_PUBLISHED_YET,
  isKnownStatus,
  shouldWait,
} from "./contest-status.js";
import { storeFetchedRatings } from "./services/user-ratings.js";
import {
  settleIdentity,
  clearSolvedForPlatform,
} from "./services/platform-identity.js";
import { ratingMode } from "./services/account.js";
import { applyCatalogRatings, lookupCatalog, markPending } from "./services/catalog.js";

/**
 * @param {string} url
 * @param {Function} [onProgress]
 * @param {{mode?: "local"|"owner"|"catalog", firebase?: object}} [options]
 *   `mode` is where ratings come from — see `account.js#ratingMode`, which
 *   supplies it when omitted. `firebase` is the test seam for catalog reads.
 */
export async function processNewContest(url, onProgress = () => {}, { mode, firebase } = {}) {
  try {
    const parsed = matchContestUrl(url);
    if (!parsed) throw new Error("Not a supported contest URL.");

    const { platform, contestId, subtype } = parsed;
    mode ??= await ratingMode();
    const fromCatalog = mode === "catalog";

    const session = await platform.createSession();

    // Adding reads user-specific data too — CodeChef's problemsstats carries
    // solved status — so the identity has to be settled here as well, not just
    // on refresh.
    await establishIdentity(platform, session);

    // In catalog mode the owner may already have done the expensive part.
    // A hit is the whole add bar solved status: no contest fetch, no field
    // read, no estimate. Presence in the catalog also answers every gate
    // `fetchContest` would have asked, since only a ready contest is published.
    const cached = fromCatalog
      ? await readCatalog(makeContestKey(platform.id, contestId), { firebase })
      : null;

    const result = cached
      ? { status: READY, contest: fromCatalogRecord(cached) }
      : await platform.fetchContestRecord({
          contestId,
          subtype,
          session,
          onProgress,
          // Catalog mode never rates locally, so the field read and the fit —
          // most of an add's requests — are skipped rather than discarded.
          estimate: !fromCatalog,
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

    if (fromCatalog && !cached) {
      // Every rating comes from the catalog in this mode, the site's own
      // published ones included, so the queue reads one source. The key is
      // asked again now that it is resolved: a CodeChef parent's URL names the
      // parent, while the catalog files the division it resolved to.
      markPending(contest);
      applyCatalogRatings(contest, await readCatalog(contestKey(contest), { firebase }));
    }

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
    //
    // None of it applies in catalog mode, where a missing rating is the catalog
    // not having this contest yet: stored pending, and filled by a refresh.
    const missing = fromCatalog
      ? []
      : contest.problems.filter((problem) => problem.rating === null);

    if (missing.length > 0) {
      if (platform.capabilities.canEstimate) {
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

      // Nested rather than `&& !canEstimate`: reaching here is a consequence of
      // the branch above not throwing, so the capability is read once.
      //
      // The site is the only source of a rating here — and a site that rates
      // promptly has not necessarily rated *yet*. A contest that has just run
      // is given its window and waits, retried by the same machinery as any
      // other waiting entry; `???` is reserved for a gap that has had time to
      // close. Without this, a timing gap is stored wearing the one meaning
      // `???` is supposed to carry: *the site says unrated*.
      const grace = platform.capabilities.ratingGraceMs ?? DEFAULT_RATING_GRACE_MS;
      if (ranWithin(contest, grace)) {
        const error = new Error(
          `${platform.label} hasn't rated ${missing.length} of ${contest.problems.length} ` +
            `problems in ${contestId} yet (${missing.map((p) => p.index).join(", ")}).`,
        );
        // The three fields the waiting machinery already reads: log it quietly
        // and remember it, keep it on retry, and let it word its own sentence.
        error.isNotPublishedYet = true;
        error.contestStatus = NOT_PUBLISHED_YET;
        error.isAwaitingRatings = true;
        throw error;
      }
      // Otherwise fall through and store: the site has had its window, so a
      // rating still missing is the site saying there isn't one.
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
 * One catalog record, or null — including when the catalog cannot be read at
 * all (signed out, offline). An add must not fail for want of a rating it
 * would only have stored as pending anyway; the next refresh asks again.
 */
async function readCatalog(key, options) {
  try {
    return (await lookupCatalog([key], options)).get(key) ?? null;
  } catch (error) {
    console.info("[Contest Manager] catalog unavailable:", error.message);
    return null;
  }
}

/** A tracked contest made from a catalog record: the shared part, plus this user's fresh state. */
function fromCatalogRecord(record) {
  return {
    ...record,
    problems: record.problems.map((problem) => ({ ...problem, solved: false })),
    addedAt: Date.now(),
  };
}

/**
 * What a platform gets when it declares no `capabilities.ratingGraceMs`.
 *
 * The fallback lives here rather than on the `Platform` base for the same
 * reason the gap policy does: a platform states a fact about its site — how
 * long that site takes to publish a rating — and this file decides what to do
 * about it. Two homes for the policy would be free to disagree.
 */
const DEFAULT_RATING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the contest ran less than `windowMs` ago.
 *
 * `startTimeSeconds` is epoch *seconds* while every other stamp on a record is
 * milliseconds. Comparing them directly dates every contest to 1970, which puts
 * the whole queue past any window and disables the wait entirely — a failure
 * with no symptom except ratings that never wait.
 *
 * There is deliberately **no `addedAt` fallback**, which is where this differs
 * from `ranAtMs` in `codeforces/official/platform.js`. That one reads a stored
 * record whose `addedAt` is fixed; this one reads a record `buildContestRecord`
 * rebuilds with `addedAt: Date.now()` on every retry, so an undateable contest
 * would read as permanently young and wait forever. A stamp that moves every
 * time we look can never bound anything, so undateable means don't wait.
 */
function ranWithin(contest, windowMs) {
  if (contest.startTimeSeconds == null) return false;
  return Date.now() - contest.startTimeSeconds * 1000 < windowMs;
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
