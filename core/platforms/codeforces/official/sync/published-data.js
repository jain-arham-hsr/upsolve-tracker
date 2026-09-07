/**
 * Re-asking Codeforces for what it has published since a contest was added.
 *
 * A round added in the days after it ends carries **estimates**: Codeforces
 * rates its problems later, and tags are editable after the fact. Something has
 * to come back and replace those, or the queue keeps sorting by a number that
 * is a mean 211 out.
 *
 * ## Why this reads the standings and not `problemset.problems`
 *
 * The problemset is far cheaper — ~2.3 MB in one request covering every stale
 * contest at once, against ~6.5 MB of `contest.standings` per contest. It was
 * the wrong trade anyway, because the cheap request cannot answer the question.
 *
 * `problemset.problems` files each problem under the contest it **originated**
 * in, so a Div. 1 / Div. 2 pair has its shared problems listed under Div. 1
 * only. Matching on `contestId-index` then finds nothing for them. Round 1116's
 * Div. 2 (2256) is a plain example: the problemset gives A and B, while the
 * standings give all six under 2256's own indices. Across the site, 282 of 936
 * finished Div. 2 rounds have exactly two problems in the problemset — the
 * distribution is bimodal, a spike at two and then five to seven, which is the
 * paired-round signature.
 *
 * So for roughly a third of Div. 2 rounds the problemset could never supply most
 * of the ratings, and those contests stayed incomplete — which meant they were
 * re-fetched every week, forever, without ever resolving.
 *
 * The two sources do **not** differ in timing, which is worth recording so it is
 * not re-tested: sampled at the same moment, a round unrated in one is unrated
 * in the other, and a rated one carries identical values in both. The difference
 * is coverage alone.
 */
import { CodeforcesSources } from "../../sources.js";

/** How long before a contest with missing data is worth asking about again. */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long after a round ran we stop asking at all.
 *
 * This is what makes the re-check terminate. Codeforces rates a round within
 * days; anything still unrated six weeks later never will be — an ICPC
 * challenge, a Kotlin Heroes practice round, the H-series of a marathon. Without
 * a cutoff those stay incomplete and are re-fetched weekly for the life of the
 * queue, which is the sweep this codebase argues against everywhere else.
 *
 * Measured from when the contest **ran**, deliberately, not from when it was
 * added or last looked at. A stamp that moves every time we look can never bound
 * anything; the run date is fixed, so a contest provably leaves the rotation and
 * never re-enters it.
 */
const STOP_CHECKING_AFTER_MS = 6 * 7 * 24 * 60 * 60 * 1000;

/**
 * When the contest ran, in **milliseconds**.
 *
 * `startTimeSeconds` is epoch *seconds* while every other timestamp on a record
 * is milliseconds, so this conversion is the whole reason the helper exists —
 * comparing the two directly puts the cutoff out by a factor of 1000 and reads
 * as every contest being either permanently in scope or permanently out of it.
 *
 * Falls back to `addedAt` when the start time is missing: `contestFromStandings` takes
 * it from the standings with `?? null`, so it is usual but not guaranteed, and a
 * contest we cannot date is better bounded by when it was added than not bounded
 * at all.
 */
function ranAtMs(contest) {
  return contest.startTimeSeconds != null
    ? contest.startTimeSeconds * 1000
    : (contest.addedAt ?? 0);
}

/**
 * Codeforces publishes a problem's rating days after its round, and tags are
 * editable after the fact, so a contest added straight after it finished will be
 * carrying estimates and possibly bare tags. Re-asking lets those settle into
 * real values — while something is actually missing, not more than weekly, and
 * not once the round is old enough that nothing more is coming.
 */
function needsSync(contest, now) {
  // **This used to gate on `contest.type !== "OFFICIAL"`, and that gate is now
  // the folder.** Only official contests reach this module, so a gym can no
  // longer arrive here at all.
  //
  // Worth recording why the gate was dangerous rather than merely redundant.
  // The add once handed this a freshly-built record before `type` had been
  // stamped on it, so the comparison answered "not official", every official add
  // silently skipped its published ratings, and estimates with a mean error of
  // ~211 were stored in their place. Nothing threw, no test failed, and the
  // numbers were merely wrong. A structural gate cannot fail that way — there is
  // no field left to read incorrectly.
  if (now - ranAtMs(contest) > STOP_CHECKING_AFTER_MS) return false;

  const incomplete = contest.problems.some(
    (prob) => !prob.tags?.length || prob.ratingSource !== "official",
  );
  if (!incomplete) return false;

  return now - (contest.publishedDataCheckedAt ?? 0) > RECHECK_AFTER_MS;
}

/**
 * Applies published tags and ratings to contests still missing them.
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * A published rating replaces an estimate: it is the same quantity, measured
 * rather than inferred. `ratingSource` records which one a problem is on.
 *
 * **No per-refresh cap**, unlike AtCoder's `syncMetadata`, and that is a decision
 * rather than an omission: a cap interacts badly with the cutoff. With several
 * stale contests and an infrequent refresher, a capped rotation gives each
 * contest one look every few refreshes, and a contest that loses that race ages
 * past six weeks and is dropped *before* it ever converged — the exact failure
 * this re-check exists to prevent. The weekly gate and the six-week window bound
 * the work between them.
 *
 * @returns {Promise<number>} How many contests were updated.
 */
export async function sync(session, contests, onProgress = () => {}) {
  const now = Date.now();
  const pending = contests.filter((contest) => needsSync(contest, now));
  if (pending.length === 0) return 0;

  onProgress("Fetching problem tags and ratings…");

  let updated = 0;
  for (const contest of pending) {
    try {
      const standings = await session.sources.getPublicContestStandings(contest.id);
      // The same applier the add path uses, so the two cannot disagree about
      // what "published" means or which fields it sets.
      CodeforcesSources.applyStandingsProblemData(standings, contest.problems);
      contest.publishedDataCheckedAt = now;
      updated++;
    } catch (error) {
      // Nice-to-have data; never let it break a sync or a contest add. The stamp
      // is deliberately not written on failure, so the contest is asked again on
      // the next refresh rather than waiting out another week.
      console.warn(
        `[Published Sync] contest.standings failed for ${contest.id}:`,
        error.message,
      );
    }
  }

  console.log(
    `[Published Sync] Re-asked ${updated} of ${pending.length} contest(s).`,
  );
  return updated;
}
