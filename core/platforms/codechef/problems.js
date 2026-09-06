/**
 * What problems a CodeChef contest holds, and what they are worth.
 *
 * No estimator here: CodeChef publishes `difficulty_rating` and does so
 * promptly — Starters 252 was rated within two days of running. `/api/rankings/`
 * is CSRF-gated, but nothing here needs it.
 *
 * Costs one request for the contest plus **one per problem** — difficulty and
 * tags appear on no bulk or contest-level response, signed in or not. That is
 * ~9 for a Starters division, still fewer than a Codeforces add.
 */
import { getContest, getProblem, ACCEPTED } from "./api.js";
import { parseDifficulty, cleanTags, syncPublishedDifficulty } from "./sync/published-data.js";
import { practiceFlag, refreshPracticeFlags } from "./sync/practice-flags.js";
import {
  notEndedYet,
  notPublishedYet,
  sourceUnreachable,
  unavailable,
} from "../../contest-status.js";

export async function fetchContest({
  contestId,
  subtype,
  session,
  onProgress = () => {},
}) {
  onProgress("Reading the contest…");
  const payload = await resolveDivision(contestId, session, onProgress);
  if (payload.status) return payload;

  // CodeChef reports its own clock alongside the contest's end, so this asks
  // *its* time rather than ours — a skewed local clock cannot mis-decide it.
  // Free: the payload is already in hand. Without this the problems are listed
  // during the contest and the add succeeds against in-contest data.
  const time = payload.contest.time ?? {};
  if (time.current != null && time.end != null && time.current <= time.end) {
    return notEndedYet(
      `"${payload.code}" is still running. It'll be added once it ends.`,
    );
  }

  const problems = Object.values(payload.contest.problems ?? {});
  if (problems.length === 0) {
    // Previously a bare throw, which is why CodeChef never joined the waiting
    // mechanism at all: unflagged, it failed hard where AtCoder waits.
    return notPublishedYet(
      `CodeChef hasn't listed the problems for "${payload.code}" yet.`,
    );
  }

  const solved = solvedCodes(payload.contest);

  const built = [];
  for (const [index, problem] of problems.entries()) {
    onProgress(`Reading problem ${index + 1} of ${problems.length}…`);
    try {
      built.push(await buildProblem(payload.code, problem, solved));
    } catch (error) {
      if (!error?.isSourceUnreachable) throw error;
      // Fail fast: the remaining requests would be spent on an add that is
      // going to be discarded. A failure here is "we couldn't ask", which must
      // never become a "???" — that would report a problem CodeChef has rated
      // as one it hasn't, and send exactly the wrong signal.
      return sourceUnreachable(
        `Couldn't reach CodeChef for every problem in "${payload.code}". ` +
          `(${error.message})`,
      );
    }
  }

  return {
    id: payload.code,
    // A parent contest resolves to one of its divisions, so the id stored is
    // not the id the user was looking at. Remember theirs, or the add banner
    // can never tell that /START252 is already tracked as START252D. The trunk
    // drops it when it matches.
    sourceId: contestId,
    name: payload.contest.name ?? `Contest ${payload.code}`,
    problems: built,
    publishedDataCheckedAt: Date.now(),
    startTimeSeconds: payload.contest.time?.start ?? null,
  };
}

/**
 * `/START252` is a parent with no problems of its own — and it returns an
 * empty list rather than an error, so it would otherwise store as an empty
 * contest. Divisions are rating-banded, so the user's own rating picks the one
 * they competed in.
 */
async function resolveDivision(contestId, session, onProgress) {
  const contest = await getContest(contestId);
  if (!contest.is_a_parent_contest) return { code: contestId, contest };

  const children = Object.values(contest.child_contests ?? {});
  if (children.length === 0) {
    return notPublishedYet(`CodeChef hasn't listed the divisions of "${contestId}" yet.`);
  }

  const codes = children.map((child) => child.contest_code).join(", ");
  const rating = session?.rating;
  if (rating == null) {
    // Needs you to choose, so retrying silently would be wrong. `unavailable`
    // carries its reason precisely so an actionable refusal needs no category
    // of its own.
    return unavailable(
      `"${contestId}" is a parent contest. Open the division you competed in ` +
        `(${codes}) and add that instead.`,
    );
  }

  const match = children.find(
    (child) =>
      rating >= (child.div?.min_rating ?? 0) &&
      rating <= (child.div?.max_rating ?? Infinity),
  );
  if (!match) {
    return unavailable(
      `Couldn't tell which division of "${contestId}" matches your rating (${rating}). ` +
        `Open one of ${codes} and add that instead.`,
    );
  }

  onProgress(`Using ${match.contest_code} (${match.div?.name ?? "your division"})…`);
  return { code: match.contest_code, contest: await getContest(match.contest_code) };
}

/**
 * Signed out, `problemsstats.solved` is an empty **array**; signed in it is an
 * **object** keyed by problem code. Object.keys handles both — array methods
 * would silently see nothing on the shape that actually carries data.
 *
 * `partially_solved` is deliberately not counted: scoring some subtasks isn't
 * finishing the problem, so it stays in the queue.
 */
function solvedCodes(contest) {
  return new Set(Object.keys(contest?.problemsstats?.solved ?? {}));
}

async function buildProblem(contestCode, problem, solved) {
  const code = problem.code;
  let rating = null;
  let tags = [];

  // Only the request is guarded, and it is re-thrown rather than swallowed.
  // Swallowing it set rating to null, which is indistinguishable from CodeChef
  // answering "-1" — so one timed-out request out of nine showed "???" for a
  // problem CodeChef *has* rated, and it stayed wrong for up to a week.
  //
  // No transient/permanent split: a 404 means "couldn't find out" just as much
  // as a 500 does, so neither may become a "???". The caller waits and retries
  // on the next refresh instead.
  let detail;
  try {
    detail = await getProblem(contestCode, code);
  } catch (error) {
    throw Object.assign(error, { isSourceUnreachable: true });
  }

  // Reached only when CodeChef answered. A -1 or 9999 sentinel here is a real
  // "this problem is unrated", which is the one thing that may become "???".
  rating = parseDifficulty(detail?.difficulty_rating);
  tags = cleanTags(detail, contestCode);

  return {
    index: code,
    name: problem.name ?? code,
    rating,
    ratingSource: rating === null ? null : "official",
    ratingConfidence: null,
    officialSolves: Number.parseInt(problem.successful_submissions, 10) || 0,
    solved: solved.has(code),
    tags,
    ...practiceFlag(problem),
  };
}

/**
 * Re-checks what only settles after a contest is added.
 *
 * Two independent passes, deliberately on different cadences and so in
 * different files: whether a problem reached CodeChef's practice archive is
 * re-read on **every** refresh, while a missing published difficulty is re-read
 * at most weekly. Sharing one gate would let the slower pass suppress the
 * faster, which is the mistake this shape exists to make impossible.
 *
 * Contests are already filtered to this platform by `progress-manager.js`.
 *
 * @returns {number} records updated, across both passes. Nothing in production
 *   reads it; it exists so the tests can tell a real update from a no-op.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  const mirrored = await refreshPracticeFlags(contests, onProgress);
  const rated = await syncPublishedDifficulty(contests, onProgress);
  return mirrored + rated;
}
