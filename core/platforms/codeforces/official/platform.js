/**
 * Codeforces' official rounds — everything under `/contest/<id>`.
 *
 * A platform of its own rather than a subtype of one Codeforces platform: an
 * official round is read entirely from the JSON API and touches no HTML,
 * while a gym can need a page. The class answers "which am I", so nothing
 * downstream branches on it. What the two share is the site, in `../site.js`,
 * and the account, which the base handles through `../api.js`.
 *
 * One unsigned `contest.standings` call carries the contest name, the
 * problems in order with their published ratings and tags, the start time,
 * and rows enough to count in-contest solves — and to measure the field when
 * nothing else can.
 */
import { Platform } from "../../platform.js";
import { site } from "../site.js";
import { CodeforcesApi, problemsFrom, applyStandingsProblemData, distributionSize } from "../api.js";
import { estimate } from "../estimator.js";
import { notPublishedYet } from "../../../contest-status.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/contest\/(\d+)/i;

export class CodeforcesOfficial extends Platform {
  static site = site;
  static Api = CodeforcesApi;

  id = "codeforces-official";

  label = "Codeforces Official";

  shortLabel = "CF";

  /** One subtype, always; `contest.type` keeps the value it has always stored. */
  subtypes = [{ value: "OFFICIAL", label: "Official" }];

  /** `/gym/<id>` falls through to the gyms platform; the path segment is the whole difference. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    return match ? { contestId: match[1], subtype: "OFFICIAL" } : null;
  }

  contestUrl(contest) {
    return `${this.origin}/contest/${contest.id}`;
  }

  /** Display-only, e.g. "Official 2193A". */
  sourceLabel(contest, problem) {
    return `Official ${contest.id}${problem.index}`;
  }

  /**
   * One of Codeforces' three filter rows. The label names the platform because
   * the filter is a flat list: a row has to stand on its own.
   */
  filterGroups = [{ key: "codeforces-official", label: "Codeforces Official" }];

  filterKey() {
    return "codeforces-official";
  }

  /**
   * Both Codeforces values are drawn: with only "Gym" labelled, an unlabelled
   * row reads as missing data rather than as an official round.
   */
  contestFlags() {
    return ["Official"];
  }

  contestLabel() {
    return "Official contest";
  }

  capabilities = {
    // problemset.problems carries tags, and covers every official problem.
    publishesTags: true,
    // The participant field is readable, so a gap left after the estimator has
    // run is a bug worth refusing on, not a problem the site has not rated.
    canEstimate: true,
  };

  // ── the work ──────────────────────────────────────────────────────────

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — which is how the standings response reaches it
   *   without being fetched twice.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { api } = session;

    // problemset.problems is where Codeforces publishes an official contest's
    // problems, so its absence is the whole "not published yet" question,
    // answered in one cached call before anything expensive happens. There is
    // no equivalent gate on a gym: gyms are absent from the problemset
    // entirely, which is why the two pipelines are two classes.
    onProgress("Checking whether Codeforces has published it…");
    if (!inProblemset(await api.problemsetProblems(), contestId)) {
      return notPublishedYet(
        `Codeforces hasn't published contest ${contestId} yet. It'll be added ` +
          `on a refresh once it appears.`,
      );
    }

    // One unsigned call carries the name, the problems with their published
    // ratings and tags, the start time, and rows enough to count solves. It is
    // the only thing that reports a shared Div. 1 / Div. 2 problem's rating
    // under this contest's own index. Failure is hard: it is the only source
    // of the roster, and it is flagged so the add waits rather than refuses.
    onProgress("Reading the standings…");
    const standings = await api.publicContestStandings(contestId);
    const problems = problemsFrom(contestId, standings);

    // A running round cannot reach here — it would not be in the problemset —
    // so unlike a gym this needs no phase check of its own.
    const record = {
      id: contestId,
      name: standings?.contest?.name ?? `Contest ${contestId}`,
      problems,
      // Stamped, not null: every rating and tag the standings carry is already
      // applied. A round Codeforces has not rated yet stores estimates and is
      // settled later by `syncPublishedData`.
      publishedDataCheckedAt: Date.now(),
      startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
    };

    await this.syncStartTimes(session, [record], onProgress);

    return {
      ...record,
      // Passed, never stored: ~8.5 MB of one round's field. The estimator
      // measures the field from these rows rather than fetching them again.
      // `solveCountsRead` is true unconditionally: counts come from rows or
      // not at all, and there is no totals row left to misparse.
      context: { solveCountsRead: true, standings },
    };
  }

  /**
   * The official field, read by `api.js#officialField`: `contest.ratingChanges`
   * when the round is rated, else the standings rows the add already holds,
   * sampled and resolved through `user.info`.
   *
   * @returns {Promise<object|null>} the distribution, or null when there was
   *   nothing to measure — a transient failure the general gap policy handles,
   *   unlike a gym's, which is permanent.
   */
  async readField({ contest, context, session, onProgress = () => {} }) {
    onProgress("Measuring the field…");

    // `context.standings` was fetched for the roster and carried here, so the
    // field is measured from rows already in memory, not a second ~8.5 MB request.
    const distribution = await session.api.officialField(contest.id, context.standings, onProgress);

    console.log(
      `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
        `representing ~${Math.round(
          distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
        )}.`,
    );

    return distributionSize(distribution) === 0 ? null : distribution;
  }

  /**
   * Published tags and ratings, and start times. Both no-op once everything
   * is resolved, so a settled queue costs nothing.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await syncPublishedData(session, contests, onProgress);
    await this.syncStartTimes(session, contests, onProgress);
  }

  estimate(contest, field) {
    return estimate(contest, field);
  }
}



/**
 * Whether Codeforces has published this contest's problems yet — the
 * publication gate, and only that. Present does not mean rated: 41 of 2,007
 * contests in the problemset have no rated problem, and the newest are
 * ordinary recent rounds still waiting on Codeforces. A contest that is
 * present but unrated stores with estimates and is settled later. Gyms are
 * absent from the problemset entirely and are never asked.
 */
function inProblemset(problemset, contestId) {
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some((problem) => String(problem.contestId) === wanted);
}

// ---------------------------------------------------------------------------
// Re-asking Codeforces for what it has published since a contest was added
// ---------------------------------------------------------------------------

/**
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
 * Falls back to `addedAt` when the start time is missing: `fetchContest` takes
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
export async function syncPublishedData(session, contests, onProgress = () => {}) {
  const now = Date.now();
  const pending = contests.filter((contest) => needsSync(contest, now));
  if (pending.length === 0) return 0;

  onProgress("Fetching problem tags and ratings…");

  let updated = 0;
  for (const contest of pending) {
    try {
      const standings = await session.api.publicContestStandings(contest.id);
      // The same applier the add path uses, so the two cannot disagree about
      // what "published" means or which fields it sets.
      applyStandingsProblemData(standings, contest.problems);
      contest.publishedDataCheckedAt = now;
      updated++;
    } catch (error) {
      // Nice-to-have data; never let it break a sync or a contest add. The stamp
      // is deliberately not written on failure, so the contest is asked again on
      // the next refresh rather than waiting out another week.
      console.warn(
        `[Codeforces] contest.standings failed for ${contest.id}:`,
        error.message,
      );
    }
  }

  console.log(
    `[Codeforces] Re-asked ${updated} of ${pending.length} contest(s).`,
  );
  return updated;
}
