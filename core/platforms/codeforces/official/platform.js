/**
 * Codeforces, official rounds.
 *
 * The whole acquisition path touches no HTML. One unsigned `contest.standings`
 * call carries the contest name, the problems in order with their published
 * ratings and tags, the start time, and rows enough to count in-contest solves
 * — and to measure the field when nothing else can.
 */
import { CodeforcesPlatform, ratePartyList } from "../platform.js";
import { codeforcesOfficial } from "./descriptor.js";
import { OfficialSources } from "./sources.js";
import { notPublishedYet } from "../../../contest-status.js";
import { fullField, distributionSize } from "../../../rating-models/rating-distribution.js";
import { CodeforcesSources } from "../sources.js";

export class CodeforcesOfficial extends CodeforcesPlatform {
  static Sources = OfficialSources;

  constructor() {
    super(codeforcesOfficial);
  }

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — which is how the standings response reaches it
   *   without being fetched twice.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { sources } = session;

    // problemset.problems is where Codeforces publishes an official contest's
    // problems, so its absence is the whole "not published yet" question,
    // answered in one cached call before anything expensive happens. There is
    // no equivalent gate on a gym: gyms are absent from the problemset
    // entirely, which is why the two pipelines are two classes.
    onProgress("Checking whether Codeforces has published it…");
    if (!inProblemset(await sources.problemsetProblems(), contestId)) {
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
    const standings = await sources.publicContestStandings(contestId);
    const problems = this.problemsFromStandings(contestId, standings);

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
   * The official field: pre-contest ratings for everyone who entered.
   * `contest.ratingChanges` carries the whole field's `oldRating` in one
   * request; when a round is not rated yet — the freshly finished contest you
   * most want to upsolve — the standings rows the add already holds are
   * stratified and resolved through `user.info`.
   *
   * @returns {Promise<object|null>} the distribution, or null when there was
   *   nothing to measure — a transient failure the general gap policy handles,
   *   unlike a gym's, which is permanent.
   */
  async readField({ contest, context, session, onProgress = () => {} }) {
    onProgress("Measuring the field…");

    // `context.standings` was fetched for the roster and carried here, so the
    // field is measured from rows already in memory, not a second ~8.5 MB request.
    const distribution = await officialField(session.sources, contest.id, context.standings, onProgress);

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
// The field
// ---------------------------------------------------------------------------

async function officialField(sources, contestId, standings, onProgress) {
  try {
    const ratingChanges = await sources.contestRatingChanges(contestId);
    if (ratingChanges?.length > 0) {
      return fullField(ratingChanges.map((user) => user.oldRating));
    }
  } catch (error) {
    console.warn(`[Codeforces] ratingChanges failed for ${contestId}:`, error.message);
  }

  console.warn(`[Codeforces] ratingChanges empty for ${contestId}. Falling back to standings.`);
  return sampleOfficialStandings(sources, standings, onProgress);
}

async function sampleOfficialStandings(sources, standings, onProgress) {
  try {
    const { groups, total } = stratifyRows(standings?.rows);
    if (groups.length === 0) {
      console.warn("[Codeforces] Standings carried no rows to sample.");
      return fullField([]);
    }

    onProgress("Looking up competitor ratings…");

    // One lookup pass over every sampled party, then split back into strata,
    // so the rate-limited `user.info` chunking does not happen twice.
    const rated = await ratePartyList(sources, groups.flatMap((group) => group.parties));

    let offset = 0;
    const strata = [];
    for (const group of groups) {
      const ratings = rated.slice(offset, offset + group.parties.length);
      offset += group.parties.length;
      if (ratings.length > 0) strata.push({ ratings, scale: group.scale });
    }

    console.log(
      `[Codeforces] Rated ${rated.length} of ~${total} participants across ${strata.length} stratum/strata.`,
    );

    return strata.length > 0 ? { strata } : fullField([]);
  } catch (error) {
    console.warn(`[Codeforces] Standings sampling failed:`, error.message);
    return fullField([]);
  }
}

// ---------------------------------------------------------------------------
// Sampling: which standings rows the field is built from.
//
// Pure maths with no I/O: it decides which of the rows already in hand get
// resolved through `user.info`, so it lives beside its only caller.
// ---------------------------------------------------------------------------

/**
 * Characterising an official contest's field without rating all of it.
 *
 * ## Why sample at all, when the whole field is in hand
 *
 * `contest.standings` returns every row, so the *rows* are free. What is not
 * free is turning them into ratings: that costs one `user.info` call per 250
 * handles, each throttled. A Div. 3 with 15,000 entrants is ~60 throttled calls
 * — two minutes — where a sample of ~1,500 is seven.
 *
 * ## Why these strata, and not something simpler
 *
 * Standings are **rank-ordered**, so a contiguous block of rows is a narrow
 * band of near-identical ratings rather than a random slice. Picking blocks at
 * random is cluster sampling with near-total intra-cluster correlation — 20
 * blocks of 50 behaves like 20 draws, not 1,000 — and estimates land 400–800
 * points off. Spreading them evenly fixes the variance but biases estimates
 * *downward*, because a random start offset can skip the very top of the field,
 * and hard problems are decided almost entirely by the strongest few.
 *
 *   HEAD - the strongest competitors, taken in full. Small, but it decides the
 *          hard problems: when three people solve something, the answer rests
 *          entirely on how strong those three were.
 *   TAIL - everyone else, sampled at even intervals down the rank order, which
 *          covers the whole spread instead of clumping.
 *
 * **Do not replace this with a uniform random sample.** It was tried and
 * measured; `tests/platforms/codeforces/official/field.test.js` reproduces the failure so the rejected
 * design cannot quietly come back.
 *
 * ## This used to read paginated HTML
 *
 * The strata are unchanged; only the source is. It fetched ~32 standings
 * *pages* over the throttled HTML client and parsed handles out of each, which
 * is why it carried a page-count guard, a partial-last-page measurement and a
 * walk-every-page fallback — all of them consequences of pagination rather than
 * of sampling. Reading the rows the API already returned removes every one of
 * them, removes the last Cloudflare-exposed request on the official path, and
 * costs nothing extra: `fetchContest` fetches that response for the roster
 * regardless and now passes it along.
 *
 * `BLOCK` is still 50 because that is what a standings page held, and the
 * accuracy fixtures were captured against those block boundaries.
 */
const BLOCK = 50;
const HEAD_BLOCKS = 10;
const TAIL_BLOCKS = 20;

/**
 * @param {object[]} rows - `contest.standings`' rows, in rank order.
 * @returns {{ groups: Array<{parties: string[][], scale: number}>, total: number }}
 *   Each group's `scale` is how many real competitors one of its members stands
 *   for. A field small enough to take whole comes back as one group at scale 1.
 */
export function stratifyRows(rows) {
  const parties = (rows ?? []).map((row) =>
    (row?.party?.members ?? []).map((member) => member.handle).filter(Boolean),
  );

  if (parties.length === 0) return { groups: [], total: 0 };

  const blockCount = Math.ceil(parties.length / BLOCK);

  // Small enough that sampling would save nothing worth the loss of precision.
  if (blockCount <= HEAD_BLOCKS + TAIL_BLOCKS) {
    return { groups: [{ parties, scale: 1 }], total: parties.length };
  }

  const head = parties.slice(0, HEAD_BLOCKS * BLOCK);
  const tail = spreadPages(HEAD_BLOCKS + 1, blockCount, TAIL_BLOCKS).flatMap((block) =>
    parties.slice((block - 1) * BLOCK, block * BLOCK),
  );

  return {
    groups: [
      { parties: head, scale: 1 },
      { parties: tail, scale: (parties.length - head.length) / tail.length },
    ],
    total: parties.length,
  };
}

/**
 * Evenly spaced block numbers across [from, to], taken at interval midpoints so
 * the sample doesn't lean toward either end of the range.
 *
 * Still named for pages, and still exported, because `tests/platforms/codeforces/official/field.test.js`
 * is written against it directly: the accuracy claim this file rests on is only
 * meaningful if the spread is genuinely even.
 */
export function spreadPages(from, to, count) {
  const span = to - from + 1;
  if (span <= count) {
    return Array.from({ length: span }, (_, i) => from + i);
  }

  const step = span / count;
  const pages = new Set();
  for (let i = 0; i < count; i++) {
    pages.add(from + Math.min(span - 1, Math.floor(i * step + step / 2)));
  }
  return [...pages].sort((a, b) => a - b);
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
      const standings = await session.sources.publicContestStandings(contest.id);
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
