/**
 * Fills in what Codeforces knows about official problems that the standings
 * page doesn't carry: tags, and published difficulty ratings.
 *
 * Both come from problemset.problems — one ~2MB request covering every
 * official contest at once. The per-contest alternative (contest.standings)
 * carries the same fields but embeds every participant row, running to ~12MB
 * for a single Div. 3, so it can't be used in a loop.
 *
 * Gym problems are absent from the problemset entirely. Their tags, where they
 * exist, come from the standings response that adding a gym already fetches;
 * their ratings are always estimated.
 */

/** How long before a contest with missing data is worth asking about again. */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Codeforces publishes a problem's rating days after its round, and tags are
 * editable after the fact, so a contest added straight after it finished will
 * be carrying estimates and possibly bare tags. Re-asking lets those settle
 * into real values — but only while something is actually missing, and not
 * more than weekly, since plenty of problems never get either.
 */
function needsSync(contest, now) {
  if (contest.type !== "OFFICIAL") return false;

  // Pre-timestamp records used a boolean; treat those as synced long ago.
  const syncedAt = contest.tagsSyncedAt ?? (contest.tagsSynced ? 0 : null);
  if (syncedAt === null) return true;

  const incomplete = contest.problems.some(
    (prob) => !prob.tags?.length || prob.ratingSource !== "official",
  );
  return incomplete && now - syncedAt > RECHECK_AFTER_MS;
}

/**
 * Applies published tags and ratings to every official contest missing them.
 * Mutates the passed contests; persisting them is the caller's job.
 *
 * A published rating replaces an estimate: it's the same quantity, measured
 * rather than inferred. `ratingSource` records which one a problem is on.
 *
 * @returns {Promise<number>} How many contests were updated.
 */
export async function syncOfficialProblemData(
  cfService,
  contests,
  onProgress = () => {},
) {
  const now = Date.now();
  const pending = contests.filter((contest) => needsSync(contest, now));
  if (pending.length === 0) return 0;

  onProgress("Fetching problem tags and ratings…");

  let problemset;
  try {
    problemset = await cfService.getProblemsetProblems();
  } catch (error) {
    // Nice-to-have data; never let it break a sync or a contest add.
    console.warn("[Problemset] problemset.problems failed:", error.message);
    return 0;
  }

  const byKey = new Map(
    (problemset?.problems ?? []).map((problem) => [
      `${problem.contestId}-${problem.index}`,
      problem,
    ]),
  );

  let ratingsApplied = 0;
  pending.forEach((contest) => {
    contest.problems.forEach((prob) => {
      const published = byKey.get(`${contest.id}-${prob.index}`);
      if (!published) return;

      prob.tags = published.tags ?? prob.tags ?? [];

      if (typeof published.rating === "number") {
        if (prob.rating !== published.rating) ratingsApplied++;
        prob.rating = published.rating;
        prob.ratingSource = "official";
      }
    });
    contest.tagsSyncedAt = now;
    delete contest.tagsSynced;
  });

  console.log(
    `[Problemset] Synced ${pending.length} contest(s); ${ratingsApplied} rating(s) replaced with published values.`,
  );
  return pending.length;
}
