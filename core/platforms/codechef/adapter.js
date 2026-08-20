/**
 * The CodeChef adapter.
 *
 * No estimator: CodeChef publishes `difficulty_rating` and does so promptly —
 * Starters 252 was rated within two days of running. `/api/rankings/` is
 * CSRF-gated, but nothing here needs it.
 */
import { getContest, getProblem, getDashboardHtml } from "./api.js";
import { extractSession } from "./page-data.js";
import { codechef } from "./descriptor.js";

/**
 * `difficulty_rating` arrives as a string and uses two out-of-band values:
 * `-1` for "not rated" (74% of the catalogue) and `9999` for a handful more.
 * Both must become null. `9999` is especially dangerous — it is also the
 * queue's own sort-last sentinel, so passing it through would look like a
 * legitimate, very hard problem.
 */
const NOT_RATED = new Set([-1, 9999]);

/** Setter handles and contest codes get tagged alongside real topics. */
const TAG_NOISE = /^(?:start|cook|ltime|snck)\d+$|_adm$/i;

export async function createSession() {
  const html = await getDashboardHtml();
  const session = extractSession(html);

  // extractSession returns null both when signed out and when the page shape
  // has changed. Either way the caller must not read an empty solved list as
  // "nothing solved".
  return session
    ? { ...session, signedIn: true }
    : { username: null, rating: null, signedIn: false };
}

export async function fetchContestRecord({
  contestId,
  subtype,
  session,
  onProgress = () => {},
}) {
  onProgress("Reading the contest…");
  const payload = await resolveDivision(contestId, session, onProgress);

  const problems = Object.values(payload.contest.problems ?? {});
  if (problems.length === 0) {
    throw new Error(`CodeChef lists no problems for "${payload.code}".`);
  }

  const solved = solvedCodes(payload.contest);

  const built = [];
  for (const [index, problem] of problems.entries()) {
    onProgress(`Reading problem ${index + 1} of ${problems.length}…`);
    built.push(await buildProblem(payload.code, problem, solved));
  }

  return {
    id: payload.code,
    platform: codechef.id,
    // A parent contest resolves to one of its divisions, so the id stored is
    // not the id the user was looking at. Remember theirs, or the add banner
    // can never tell that /START252 is already tracked as START252D.
    ...(payload.code !== contestId ? { sourceId: contestId } : {}),
    name: payload.contest.name ?? `Contest ${payload.code}`,
    type: subtype,
    problems: built,
    tagsSyncedAt: Date.now(),
    startTimeSeconds: payload.contest.time?.start ?? null,
    addedAt: Date.now(),
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
    throw new Error(`"${contestId}" has no divisions listed.`);
  }

  const codes = children.map((child) => child.contest_code).join(", ");
  const rating = session?.rating;
  if (rating == null) {
    throw new Error(
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
    throw new Error(
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

  try {
    const detail = await getProblem(contestCode, code);
    rating = parseDifficulty(detail?.difficulty_rating);
    tags = cleanTags(detail, contestCode);
  } catch (error) {
    // A missing difficulty is recoverable — it stores as null, shows "???"
    // and is re-checked later. Failing the whole add over one problem is not.
    console.warn(`[CodeChef] ${code} details failed:`, error.message);
  }

  return {
    index: code,
    name: problem.name ?? code,
    rating,
    ratingSource: rating === null ? null : "official",
    ratingConfidence: null,
    officialSolves: Number.parseInt(problem.successful_submissions, 10) || 0,
    solved: solved.has(code),
    tags,
  };
}

function parseDifficulty(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || NOT_RATED.has(value)) return null;
  return value;
}

function cleanTags(detail, contestCode) {
  const raw = [...(detail?.user_tags ?? []), ...(detail?.computed_tags ?? [])];
  const seen = new Set();

  return raw.filter((tag) => {
    if (typeof tag !== "string") return false;
    const trimmed = tag.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === contestCode.toLowerCase()) return false;
    if (TAG_NOISE.test(trimmed)) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Solved history is per contest here, not per user: there is no endpoint that
 * answers "everything you have ever solved". So this costs one request per
 * tracked CodeChef contest.
 */
export async function fetchSolvedKeys(session, contests, onProgress = () => {}) {
  const keys = new Set();
  if (!session?.signedIn) {
    // Signed out, every contest reports an empty solved list — which reads as
    // "nothing solved" and would resurrect the whole queue. Refuse instead, so
    // the caller isolates the failure and leaves existing flags alone.
    throw new Error("Not signed in to CodeChef, so solved status can't be read.");
  }

  for (const [index, contest] of contests.entries()) {
    onProgress(`Checking CodeChef contest ${index + 1} of ${contests.length}…`);
    const payload = await getContest(contest.id);
    for (const code of solvedCodes(payload)) {
      keys.add(codechef.solvedKey(contest, { index: code }));
    }
  }

  return keys;
}

/**
 * Re-checks problems that had no published difficulty when they were added.
 *
 * Costs one request per still-unrated problem, so it is limited to contests
 * that haven't been looked at for a week — the same shape as the Codeforces
 * tag re-check.
 */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export async function syncMetadata(session, contests, onProgress = () => {}) {
  const now = Date.now();
  const stale = contests.filter(
    (contest) =>
      contest.problems.some((problem) => problem.rating === null) &&
      now - (contest.tagsSyncedAt ?? 0) > RECHECK_AFTER_MS,
  );
  if (stale.length === 0) return 0;

  let resolved = 0;
  for (const contest of stale) {
    for (const problem of contest.problems) {
      if (problem.rating !== null) continue;

      onProgress(`Re-checking ${problem.index}…`);
      try {
        const detail = await getProblem(contest.id, problem.index);
        const rating = parseDifficulty(detail?.difficulty_rating);
        if (rating === null) continue;

        problem.rating = rating;
        problem.ratingSource = "official";
        problem.tags = cleanTags(detail, contest.id);
        resolved++;
      } catch (error) {
        console.warn(`[CodeChef] re-check of ${problem.index} failed:`, error.message);
      }
    }
    contest.tagsSyncedAt = now;
  }

  return resolved;
}

/**
 * CodeChef identity is **ambient**: it comes from the browser session rather
 * than from anything configured. That is why a mismatch is treated as an
 * intruder and refused, instead of being adopted the way an edited handle is.
 */
export const identityIsAmbient = true;

/**
 * The signed-in account, from the bootstrap object createSession already read
 * — no extra request.
 *
 * @throws when signed out. Signing out is indistinguishable from having solved
 *   nothing (`problemsstats.solved` is simply empty), so this has to fail
 *   rather than let a caller read that as "nothing solved".
 */
export async function verifyIdentity(session) {
  if (!session?.signedIn || !session.username) {
    throw new Error(
      "Not signed in to CodeChef. Open codechef.com, sign in, and try again.",
    );
  }

  return {
    username: session.username,
    rating: typeof session.rating === "number" ? session.rating : null,
  };
}
