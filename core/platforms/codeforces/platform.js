/**
 * Codeforces: one account, two platforms.
 *
 * `CodeforcesPlatform` is what the two share — one handle, one key pair, one
 * settings section, and one submission stream. `user.status` carries no
 * gym/official marker, so each platform reads the same stream and stamps its
 * own `solvedKey` prefix on it; `applySolvedStatus` looks up by the prefix of
 * the platform that owns the contest, so the second read is load-bearing.
 *
 * Whose account this is: Codeforces is asked *about* a handle, and
 * `user.status?handle=X` returns X's submissions whoever's key signs the
 * request. There is no "who am I" endpoint, so the handle is verified to
 * exist, not to be yours; the changed-identity path in
 * `services/platform-identity.js` is what contains a wrong one.
 *
 * `CodeforcesOfficial` reads a round entirely from the JSON API and touches no
 * HTML. `CodeforcesGyms` reads a visible gym from the signed API too, and is
 * the one path that can scrape: a gym whose standings the setter hid answers
 * FAILED, and the `/gym/<id>` problems page is the only page it still renders.
 */
import { Platform } from "../platform.js";
import { codeforcesOfficial, codeforcesGyms } from "./descriptor.js";
import { CodeforcesSources, OfficialSources, GymSources } from "./sources.js";
import { estimate, stratifyRows } from "./estimator.js";
import { notPublishedYet, notEndedYet, unavailable } from "../../contest-status.js";
import { fullField, distributionSize } from "../../rating-models/rating-distribution.js";
import { computeTeamRating } from "../../rating-models/team-rating.js";

const HANDLE_KEY = "upsolve_tracker.handle";

class CodeforcesPlatform extends Platform {
  static settingsSection = "codeforces";

  /** The `CodeforcesSources` subclass a session of this platform reads through. */
  static Sources = null;

  constructor(descriptor) {
    super(descriptor);
    if (typeof new.target.Sources !== "function") {
      throw new Error(`${new.target.name} must name its Sources class`);
    }
  }

  /** @throws when the extension has not been configured yet. */
  buildSession(values) {
    const apiKey = values.api_key;
    const apiSecret = values.api_secret;

    if (!apiKey || !apiSecret) {
      throw new Error(
        "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
      );
    }

    return {
      sources: new this.constructor.Sources(apiKey, apiSecret),
      handle: values[HANDLE_KEY],
    };
  }

  /**
   * Confirms the handle is a real account and returns it with the rating —
   * both from the one `user.info` call, so verifying costs nothing extra.
   *
   * @throws when no handle is set, or Codeforces does not know it.
   */
  async identify(session) {
    if (!session?.handle) {
      throw new Error("No Codeforces handle set. Add one in Settings.");
    }

    // A bad handle comes back FAILED, which the source turns into a throw.
    const users = await session.sources.usersInfo([session.handle]);
    const user = users?.[0];

    if (!user?.handle) {
      throw new Error(`Codeforces doesn't recognise the handle "${session.handle}".`);
    }

    return {
      // Codeforces' own casing, so "Tourist" over "tourist" is not a new account.
      username: user.handle,
      rating: typeof user.rating === "number" ? user.rating : null,
    };
  }

  /**
   * The problems a `contest.standings` response describes, in the stored shape:
   * blank, then Codeforces' published ratings and tags applied, then in-contest
   * solves counted from the rows. Both platforms start here; what differs is
   * what each does when the call fails.
   *
   * @throws flagged `isSourceUnreachable` when the response names no problems —
   *   there is nothing to store, and an unreachable API is a reason to retry.
   */
  problemsFromStandings(contestId, standings) {
    const problems = (standings?.problems ?? []).map((problem) => ({
      index: problem.index,
      name: problem.name,
      rating: null,
      ratingSource: null,
      officialSolves: 0,
      solved: false,
      tags: [],
    }));

    if (problems.length === 0) {
      throw Object.assign(
        new Error(`Codeforces returned no problems for ${contestId}, so there is nothing to store.`),
        { isSourceUnreachable: true },
      );
    }

    CodeforcesSources.applyStandingsProblemData(standings, problems);
    CodeforcesSources.populateSolveCounts(standings, problems);
    return problems;
  }

  /**
   * Fills `contest.startTimeSeconds`, which orders the contest list, from the
   * bulk `contest.list` each platform's Source answers with its own list.
   * Contest ids are not chronological (2205 ran a day before 2200). A finished
   * contest's start time never changes, so there is no re-check; ordering is
   * cosmetic, so a failed list never breaks a sync or an add.
   *
   * @returns {Promise<number>} contests dated
   */
  async syncStartTimes(session, contests, onProgress = () => {}) {
    const pending = contests.filter((contest) => !contest.startTimeSeconds);
    if (pending.length === 0) return 0;

    onProgress("Looking up contest dates…");

    const startTimes = new Map();
    try {
      const list = await session.sources.contestList();
      for (const contest of list ?? []) {
        if (contest.startTimeSeconds) startTimes.set(String(contest.id), contest.startTimeSeconds);
      }
    } catch (error) {
      console.warn("[Codeforces] contest.list failed:", error.message);
      return 0;
    }

    let resolved = 0;
    for (const contest of pending) {
      const startTime = startTimes.get(String(contest.id));
      if (startTime) {
        contest.startTimeSeconds = startTime;
        resolved++;
      }
    }

    console.log(`[Codeforces] Resolved ${resolved} of ${pending.length} contest(s).`);
    return resolved;
  }

  /** Both clients are module-level, so the seam is static on the Sources class. */
  reset(spacingMs = 0) {
    this.constructor.Sources.reset(spacingMs);
  }

  /** Both platforms fit the same quantity; only how the field is read differs. */
  estimate(contest, field) {
    return estimate(contest, field);
  }

  /** `contests` is unused: `user.status` returns the whole history in one call. */
  async fetchAccepted(session, _contests, onProgress = () => {}) {
    onProgress("Checking your submissions…");
    const submissions = await session.sources.userStatus(session.handle);

    return submissions
      .filter((submission) => submission.verdict === "OK")
      .map((submission) => ({
        contest: { id: submission.problem.contestId },
        problem: { index: submission.problem.index },
      }));
  }
}
// ---------------------------------------------------------------------------
// Official rounds
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Gyms
// ---------------------------------------------------------------------------

export class CodeforcesGyms extends CodeforcesPlatform {
  static Sources = GymSources;

  constructor() {
    super(codeforcesGyms);
  }

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — the standings response, or the party handles when
   *   the standings are hidden.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { sources } = session;

    onProgress("Reading the standings…");
    let read;
    try {
      read = this.fromStandings(contestId, await sources.contestStandings(contestId));
    } catch (error) {
      // Opens only where the add would otherwise fail outright: a gym whose
      // standings Codeforces has hidden. Anything else — a network fault, a
      // bad key — rethrows untouched, since routing around one would turn a
      // broken request into a silently shorter contest.
      if (!error.isStandingsHidden) throw error;
      read = await fromContestStatus(contestId, sources, error);
    }
    const { contestName, problems, tagsSynced, startTimeSeconds, solveCountsRead, partyHandles, finished, standings } = read;

    // A running gym has visible standings carrying partial solve counts, so
    // the estimator would fit them and store inflated difficulties — and a gym
    // is the one contest nothing ever re-rates. `finished === null` means the
    // source did not say, and proceeds: refusing on an unreadable phase would
    // make a contest unaddable for a reason we cannot state.
    if (finished === false) {
      return notEndedYet(`Gym ${contestId} is still running. It'll be added once it ends.`);
    }

    const record = {
      id: contestId,
      name: contestName,
      problems,
      publishedDataCheckedAt: tagsSynced ? Date.now() : null,
      startTimeSeconds,
    };

    // No problemset sync: gyms are absent from problemset.problems entirely.
    // Tags and published ratings came off the standings response instead.
    await this.syncStartTimes(session, [record], onProgress);

    return {
      ...record,
      // Passed, never stored: a whole gym's field has no business in storage.
      context: { solveCountsRead, partyHandles, standings },
    };
  }

  /**
   * A visible gym: one signed `contest.standings` call carries the name, the
   * problems with their published ratings and tags, the start time, the phase,
   * and rows enough to count solves. Verified against real gyms — 100001,
   * 102253, 702859 — so a gym add makes no HTML request unless the standings
   * are hidden.
   */
  fromStandings(contestId, standings) {
    return {
      contestName: standings?.contest?.name ?? `Gym ${contestId}`,
      problems: this.problemsFromStandings(contestId, standings),
      // The same response is the only source gyms have for tags and for the
      // difficulty Codeforces publishes.
      tagsSynced: (standings?.problems ?? []).length > 0,
      // The only place private gyms and mashups get a start time: those never
      // appear in contest.list.
      startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
      // Unconditionally true, and deliberate: counts come from the API rather
      // than a parsed totals row. Empty rows also mean an empty field, and the
      // estimator then refuses with the better sentence — "participants aren't
      // visible" — rather than a solve-count message blaming a layout change.
      solveCountsRead: true,
      partyHandles: null,
      finished: standings?.contest?.phase ? standings.contest.phase === "FINISHED" : null,
      // Carried, never stored: `readField` measures the field from these rows.
      standings,
    };
  }

  /**
   * A gym's field arrives whole: 5–76 parties in one `contest.standings`
   * response, so there is nothing to sample — and far too few to sample from,
   * which is why a gym estimate is so much noisier than an official one. When
   * the standings are hidden the field is recovered from who submitted; that
   * field is narrower, but a party that entered and submitted nothing solved
   * nothing either, so the counts stay consistent with it.
   *
   * @returns {Promise<object>} the distribution, or `unavailable` — a gym with
   *   no measurable field never gains one, so it refuses rather than waits.
   */
  async readField({ contest, context, session, onProgress = () => {} }) {
    const { solveCountsRead, partyHandles, standings } = context;
    const gaps = contest.problems.filter((problem) => problem.rating === null).length;

    // Unreachable today — gym counts come from the API, not a parsed totals
    // row — and kept deliberately: the alternative is estimating from counts
    // that were never read, which invents ratings silently.
    if (!solveCountsRead) {
      return unavailable(
        `Couldn't read the solve counts for gym ${contest.id}, and ${gaps} ` +
          `problem(s) have no published rating to fall back on.`,
      );
    }

    onProgress("Measuring the field…");

    const distribution = partyHandles
      ? await fieldFromParties(session.sources, partyHandles)
      : await fieldFromStandings(session.sources, contest.id, standings);

    console.log(
      `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
        `representing ~${Math.round(
          distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
        )}.`,
    );

    // Permanent: private or empty standings do not become visible later.
    if (distributionSize(distribution) === 0) {
      return unavailable(
        `Couldn't rate gym ${contest.id}: its participants aren't visible, so ` +
          `there is no field to measure against.`,
      );
    }

    return distribution;
  }

  /**
   * The bulk `contest.list?gym=true` first, then one `contest.standings` each
   * for whatever it did not cover. Private gyms and mashups (the 6xxxxx ids)
   * never appear in the list; most are dated at add time from the standings
   * already in hand, and this covers the rest.
   */
  async syncStartTimes(session, contests, onProgress = () => {}) {
    const pending = contests.filter((contest) => !contest.startTimeSeconds);
    if (pending.length === 0) return 0;

    let resolved = await super.syncStartTimes(session, contests, onProgress);

    const gyms = pending.filter((contest) => !contest.startTimeSeconds);
    for (const [index, contest] of gyms.entries()) {
      // Deliberately slow — the API pacer spaces these — so it counts itself off.
      onProgress(`Dating gym ${index + 1} of ${gyms.length}…`);
      try {
        const standings = await session.sources.contestStandings(contest.id);
        const startTime = standings?.contest?.startTimeSeconds;
        if (startTime) {
          contest.startTimeSeconds = startTime;
          resolved++;
        }
      } catch (error) {
        console.warn(`[Codeforces] Gym ${contest.id} standings failed:`, error.message);
      }
    }

    return resolved;
  }

  /**
   * Only start times. A gym's rating is inherited from an already-rated
   * archive problem, so unlike Codeforces' editable tags it never appears
   * later, and re-checking would cost one `contest.standings` per gym per
   * refresh forever.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await this.syncStartTimes(session, contests, onProgress);
  }
}

// ---------------------------------------------------------------------------
// Helpers: the account
// ---------------------------------------------------------------------------


const CHUNK = 250;

/**
 * Handles to one effective rating per party — what both fields end in. Each
 * platform decides *which* parties: an official round's from `ratingChanges`
 * or sampled standings rows, a gym's from its whole standings or from who
 * submitted. Everything below the handles is one path, so the two cannot
 * drift: the same `user.info` chunking, the same team collapsing.
 *
 * @param {string[][]} parties - member handles, one array per party
 * @returns {Promise<number[]>} one rating per party, in order
 */
async function ratePartyList(sources, parties) {
  const allHandles = [...new Set(parties.flat().filter(Boolean))];

  console.log(`[Codeforces] Found ${allHandles.length} unique handles across ${parties.length} parties.`);
  if (allHandles.length === 0) return [];

  const handleToRating = {};
  for (let i = 0; i < allHandles.length; i += CHUNK) {
    try {
      const usersInfo = await sources.usersInfo(allHandles.slice(i, i + CHUNK));
      usersInfo?.forEach((u) => {
        handleToRating[u.handle] = u.rating ?? 800;
      });
    } catch {
      console.warn(`[Codeforces] Chunk ${Math.floor(i / CHUNK) + 1} rejected. Skipping.`);
    }
  }

  // An unknown handle counts as 800 rather than dropping out, or a party whose
  // members all failed to resolve would collapse to the search's floor and drag
  // the whole field down with it.
  return parties.map((members) => {
    const ratings = members.map((handle) => handleToRating[handle] ?? 800);
    return computeTeamRating(ratings.length > 0 ? ratings : [800]);
  });
}

// ---------------------------------------------------------------------------
// Helpers: official rounds
// ---------------------------------------------------------------------------


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

// ---------------------------------------------------------------------------
// Helpers: gyms
// ---------------------------------------------------------------------------


/**
 * A gym whose standings Codeforces has hidden, rebuilt from `contest.status`.
 *
 * Both usual sources are gone at once: the standings page has no table and
 * `contest.standings` answers FAILED. The problems page still renders and is
 * the authority on what the contest contains — deriving the list from
 * submissions would silently drop any problem nobody attempted. The
 * submissions supply everything else.
 *
 * @param {Error} standingsError - what the standings call threw, so a failure
 *   here can name the original cause rather than replacing it.
 */
async function fromContestStatus(contestId, sources, standingsError) {
  const page = await sources.problemsPage(contestId);

  // Never fall back to a submission-derived list: it would look like a
  // shorter contest rather than a failure.
  if (!page) {
    throw new Error(
      `Gym ${contestId} has its standings hidden, and its problems page couldn't be read ` +
        `either, so there's nothing left to build the contest from. (${standingsError.message})`,
    );
  }

  const derived = GymSources.summariseSubmissions(await sources.contestSubmissions(contestId));

  const problems = page.problems.map((problem) => {
    const meta = derived.problemMeta.get(problem.index);
    // Codeforces publishes a difficulty for the problems it recognises here —
    // the same quantity the estimator approximates — so prefer it.
    const rating = meta?.rating ?? null;
    return {
      ...problem,
      rating,
      ratingSource: rating === null ? null : "official",
      officialSolves: derived.solveCounts[problem.index] ?? 0,
      solved: false,
      tags: meta?.tags ?? [],
    };
  });

  return {
    // A display fallback is the platform's to choose; a scraper never invents one.
    contestName: page.contestName ?? `Contest ${contestId}`,
    problems,
    // Tags come from the same place they do on a visible gym.
    tagsSynced: derived.problemMeta.size > 0,
    startTimeSeconds: derived.startTimeSeconds,
    // With no official submissions at all, every count is zero — which is
    // indistinguishable from "nobody solved anything", and would send every
    // problem to the top of the estimator's range rather than the floor. So
    // the counts are usable only where somebody official competed.
    solveCountsRead: derived.partyHandles.length > 0,
    partyHandles: derived.partyHandles,
    // No standings to ask, so the sidebar says whether it has finished.
    finished: page.finished,
  };
}

/** `standings` is the response the add already paid for; the hidden path has none. */
async function fieldFromStandings(sources, contestId, prefetched) {
  try {
    const standings = prefetched ?? (await sources.contestStandings(contestId));

    if (!standings?.rows?.length) {
      console.warn(`[Codeforces] Standings API returned empty for ${contestId}.`);
      return fullField([]);
    }

    return fullField(
      await ratePartyList(
        sources,
        standings.rows.map((row) => row.party.members.map((m) => m.handle)),
      ),
    );
  } catch (error) {
    console.warn(`[Codeforces] Standings method failed for ${contestId}:`, error.message);
    return fullField([]);
  }
}

async function fieldFromParties(sources, partyHandles) {
  if (!partyHandles?.length) return fullField([]);

  try {
    return fullField(await ratePartyList(sources, partyHandles));
  } catch (error) {
    console.warn(`[Codeforces] Submission-derived field failed:`, error.message);
    return fullField([]);
  }
}
