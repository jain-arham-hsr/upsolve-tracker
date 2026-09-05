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
 *
 * This module is Codeforces-only. It keys on bare `contestId-index`, so it
 * must be handed Codeforces contests exclusively — see contestsOnPlatform in
 * platforms/registry.js. Another platform's ids live in a different namespace
 * and would match the wrong problems.
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
  // A record with no `type` is a caller bug, not a contest that isn't official
  // — and answering `false` for it is the shape of failure this guard exists to
  // stop. `codeforces/problems.js` once handed this a freshly-built record
  // before the trunk had stamped `type` on it, so every official add silently
  // skipped its published ratings and stored estimates instead. Nothing threw,
  // no test failed, and the numbers were merely wrong. Fail loudly instead, the
  // same rule `platformOf()` follows for a record with no `platform`.
  if (typeof contest.type !== "string") {
    throw new Error(
      `Codeforces problemset sync got a contest with no type (id ${contest.id}). ` +
        `Whatever built it is not producing a complete record.`,
    );
  }
  if (contest.type !== "OFFICIAL") return false;

  // Pre-timestamp records used a boolean; treat those as synced long ago.
  const syncedAt = contest.publishedDataCheckedAt ?? null;
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
    contest.publishedDataCheckedAt = now;
  });

  console.log(
    `[Problemset] Synced ${pending.length} contest(s); ${ratingsApplied} rating(s) replaced with published values.`,
  );
  return pending.length;
}

/**
 * Whether Codeforces has published this contest's problems yet.
 *
 * The publication check for an official round, and the whole of it: problems
 * enter the problemset already rated, so "present" and "rated" arrive together
 * — 1,965 of 2,005 contests are fully rated, one is partly, and the 39 with
 * nothing rated are April Fools and Testing Rounds that were never going to be.
 * A contest present but unrated is therefore a permanent oddity rather than a
 * stage on the way, which is why absence is the only question worth asking.
 *
 * Gyms are absent from the problemset entirely and must never be asked.
 */
export async function isInProblemset(cfService, contestId) {
  const problemset = await cfService.getProblemsetProblems();
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some(
    (problem) => String(problem.contestId) === wanted,
  );
}
