/**
 * The AtCoder adapter.
 *
 * Much smaller than the Codeforces one, because AtCoder Problems publishes
 * difficulty directly: there is no standings scrape, no participant sampling
 * and no Elo estimation here. Four static JSON files and a submissions
 * endpoint cover everything.
 */
import { getResources, getAcceptedProblemIds } from "./problems-api.js";
import { atcoder } from "./descriptor.js";

export const HANDLE_KEY = "cf_trainer.atcoder_handle";

/**
 * AtCoder needs no key or secret — only a handle, to read solved history.
 * Everything else is public.
 */
export async function createSession() {
  const settings = await chrome.storage.local.get(HANDLE_KEY);
  return { handle: settings[HANDLE_KEY] };
}

export async function fetchContestRecord({
  contestId,
  subtype,
  onProgress = () => {},
}) {
  onProgress("Fetching AtCoder problem data…");
  const { problems, contests, contestProblems, models } = await getResources();

  const meta = contests.find((contest) => contest.id === contestId);
  if (!meta) {
    throw new Error(
      `AtCoder Problems doesn't list contest "${contestId}". A contest that just ` +
        `started may not be indexed yet.`,
    );
  }

  // contest-problem.json, not problems.json: a problem can belong to several
  // contests and problems.json only records its debut. Reading the latter
  // alone under-reports rerun contests by more than half.
  const entries = contestProblems.filter((row) => row.contest_id === contestId);
  if (entries.length === 0) {
    throw new Error(`AtCoder Problems lists no problems for "${contestId}" yet.`);
  }

  const problemsById = new Map(problems.map((problem) => [problem.id, problem]));

  onProgress("Reading published difficulties…");
  const built = entries
    .slice()
    .sort((a, b) => String(a.problem_index).localeCompare(String(b.problem_index)))
    .map((entry) => buildProblem(entry, problemsById, models));

  return {
    id: contestId,
    platform: atcoder.id,
    name: meta.title ?? `Contest ${contestId}`,
    type: subtype,
    problems: built,
    // AtCoder publishes no tags at all, so there is nothing to come back for.
    tagsSyncedAt: Date.now(),
    startTimeSeconds: meta.start_epoch_second ?? null,
    addedAt: Date.now(),
  };
}

function buildProblem(entry, problemsById, models) {
  const problemId = entry.problem_id;
  const model = models[problemId];

  // Difficulty is absent for problems that have never run in a rated contest,
  // and for rounds too fresh to have been modelled. Store null — the queue
  // shows "???" and a later refresh fills it in. Never substitute a number.
  const difficulty =
    typeof model?.difficulty === "number" ? model.difficulty : null;

  return {
    index: entry.problem_index,
    problemId,
    name: problemsById.get(problemId)?.name ?? problemId,
    rating: difficulty,
    ratingSource: difficulty === null ? null : "official",
    // ~11% of modelled problems are flagged low-confidence. Recording it means
    // the UI can mark them rather than presenting an estimate as measured.
    ratingConfidence: difficulty === null || !model?.is_experimental
      ? null
      : "experimental",
    officialSolves: 0,
    solved: false,
    tags: [],
  };
}

export async function fetchSolvedKeys(session, onProgress = () => {}) {
  if (!session.handle) return new Set();

  onProgress("Checking your AtCoder submissions…");
  const accepted = await getAcceptedProblemIds(session.handle);

  return new Set(
    [...accepted].map((problemId) =>
      atcoder.solvedKey({ id: null }, { problemId }),
    ),
  );
}

/**
 * Fills in difficulties that weren't published when a contest was added, and
 * any missing start time.
 *
 * Free, in request terms: problem-models.json is one of the files already
 * fetched and cached, so a settled queue costs nothing beyond that.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  const incomplete = contests.filter(
    (contest) =>
      !contest.startTimeSeconds ||
      contest.problems.some((problem) => problem.rating === null),
  );
  if (incomplete.length === 0) return 0;

  onProgress("Checking for newly published AtCoder difficulties…");
  const { contests: contestList, models } = await getResources();
  const startTimes = new Map(
    contestList.map((contest) => [contest.id, contest.start_epoch_second]),
  );

  let resolved = 0;
  for (const contest of incomplete) {
    if (!contest.startTimeSeconds && startTimes.has(contest.id)) {
      contest.startTimeSeconds = startTimes.get(contest.id);
    }

    for (const problem of contest.problems) {
      if (problem.rating !== null) continue;

      const model = models[problem.problemId];
      if (typeof model?.difficulty !== "number") continue;

      problem.rating = model.difficulty;
      problem.ratingSource = "official";
      problem.ratingConfidence = model.is_experimental ? "experimental" : null;
      resolved++;
    }
  }

  if (resolved > 0) {
    console.log(`[AtCoder] ${resolved} problem(s) gained a published difficulty.`);
  }
  return resolved;
}
