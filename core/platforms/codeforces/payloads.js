/**
 * What Codeforces' payloads mean, as the shapes the platforms store.
 *
 * Pure: a `contest.standings` or `contest.status` response in, problems or a
 * summary out. Nothing here fetches, and nothing here decides what to do with
 * the answer — `platform.js` does that. The one exception is `problemsFrom`,
 * which throws (flagged) on a standings payload that names no problems: that
 * is a fact about the payload, and both platforms would otherwise repeat it.
 */

/**
 * Applies the tags and the rating Codeforces attaches to a contest's
 * problems, off a `contest.standings` response.
 *
 * On an official round this is the only source that reports a shared
 * Div. 1 / Div. 2 problem's rating under this contest's own index; on a gym
 * about a third of problems carry a rating inherited from the archive.
 *
 * @returns {boolean} whether the API answered with problems at all, which
 *   is what `publishedDataCheckedAt` records.
 */
export function applyStandingsProblemData(standings, problems) {
  const apiProblems = standings?.problems;
  if (!apiProblems?.length) return false;

  const byIndex = new Map(
    apiProblems.map((problem) => [problem.index, problem]),
  );
  problems.forEach((problem) => {
    const published = byIndex.get(problem.index);
    problem.tags = published?.tags ?? [];

    if (typeof published?.rating === "number") {
      problem.rating = published.rating;
      problem.ratingSource = "official";
    }
  });

  return true;
}

/** In-contest solves per problem, from the rows, ghosts excluded. */
export function populateSolveCounts(standings, problems) {
  if (!standings?.rows?.length) return;

  const validRows = standings.rows.filter((row) => !row.party.ghost);
  const solveCountMap = {};

  validRows.forEach((row) => {
    row.problemResults.forEach((result, i) => {
      const index = problems[i]?.index;
      if (!index) return;
      if (result.bestSubmissionTimeSeconds != null) {
        solveCountMap[index] = (solveCountMap[index] ?? 0) + 1;
      }
    });
  });

  problems.forEach((problem) => {
    problem.officialSolves = solveCountMap[problem.index] ?? 0;
  });
}

/**
 * The problems a `contest.standings` response describes, in the stored
 * shape: blank, then Codeforces' published ratings and tags applied, then
 * in-contest solves counted from the rows.
 *
 * @throws flagged `isSourceUnreachable` when the response names no problems —
 *   there is nothing to store, and an unreachable API is a reason to retry.
 */
export function problemsFrom(contestId, standings) {
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

  applyStandingsProblemData(standings, problems);
  populateSolveCounts(standings, problems);
  return problems;
}

const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

/**
 * Derives everything the add path needs from a contest's submissions.
 *
 * Practice submissions are excluded throughout: they happen after the contest,
 * so counting them would overstate how many people solved a problem under
 * contest conditions, which is exactly the quantity the estimator is fitted
 * to. Ghost parties are excluded for the same reason the standings path
 * excludes them.
 *
 * @param {object[]} submissions - contest.status rows
 * @returns {{
 *   solveCounts: Record<string, number>,
 *   problemMeta: Map<string, {name: string, rating: number|null, tags: string[]}>,
 *   partyHandles: string[][],
 *   startTimeSeconds: number|null,
 * }}
 */
export function summariseSubmissions(submissions) {
  const solvers = new Map(); // problem index -> Set of party id
  const problemMeta = new Map();
  const parties = new Map(); // party id -> string[] of handles
  const startTimes = new Map(); // startTimeSeconds -> party count

  for (const submission of submissions ?? []) {
    const problem = submission?.problem;
    const author = submission?.author;
    if (!problem?.index || !author) continue;

    // Problem metadata is worth taking from any submission, including a
    // practice one: it describes the problem, not the attempt.
    if (!problemMeta.has(problem.index)) {
      problemMeta.set(problem.index, {
        name: problem.name ?? null,
        rating: typeof problem.rating === "number" ? problem.rating : null,
        tags: problem.tags ?? [],
      });
    }

    if (!OFFICIAL_PARTICIPANT_TYPES.has(author.participantType)) continue;
    if (author.ghost) continue;

    const partyId = author.participantId;
    if (partyId == null) continue;

    if (!parties.has(partyId)) {
      parties.set(
        partyId,
        (author.members ?? []).map((member) => member.handle).filter(Boolean),
      );
      if (author.startTimeSeconds != null) {
        startTimes.set(
          author.startTimeSeconds,
          (startTimes.get(author.startTimeSeconds) ?? 0) + 1,
        );
      }
    }

    if (submission.verdict !== "OK") continue;

    // A party that solves the same problem twice still solved it once.
    if (!solvers.has(problem.index)) solvers.set(problem.index, new Set());
    solvers.get(problem.index).add(partyId);
  }

  const solveCounts = {};
  for (const [index, partySet] of solvers) solveCounts[index] = partySet.size;

  return {
    solveCounts,
    problemMeta,
    partyHandles: [...parties.values()],
    startTimeSeconds: mostCommon(startTimes),
  };
}

/**
 * Virtual entrants each carry their own start time, so the contest's own is
 * the one the most parties share rather than the first one seen.
 */
function mostCommon(tally) {
  let best = null;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
