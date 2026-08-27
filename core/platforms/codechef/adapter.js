/**
 * The CodeChef adapter.
 *
 * No estimator: CodeChef publishes `difficulty_rating` and does so promptly —
 * Starters 252 was rated within two days of running. `/api/rankings/` is
 * CSRF-gated, but nothing here needs it.
 */
import {
  getAttemptedProblems,
  getContest,
  getDashboardHtml,
  getProblem,
} from "./api.js";
import { extractSession } from "./page-data.js";
import {
  ready,
  notEndedYet,
  notPublishedYet,
  sourceUnreachable,
  unavailable,
} from "../../contest-status.js";

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

import { readSettingsValues } from "../../services/secure-store.js";
import { codechef } from "./descriptor.js";

export const HANDLE_KEY = "upsolve_tracker.codechef_handle";

/**
 * The handle you declared, plus whoever the browser is actually signed in as.
 *
 * Both, because they can differ — and that difference is the whole point: the
 * configured handle says who this queue belongs to, and the session says whose
 * solved status the API is about to hand back.
 */
export async function createSession() {
  return createSessionFrom(await readSettingsValues(codechef));
}

/** The same session from unsaved values, so Settings can verify what you typed. */
export async function createSessionFrom(values) {
  const html = await getDashboardHtml();

  // extractSession returns null both when signed out and when the page shape
  // has changed. Either way the caller must not read an empty solved list as
  // "nothing solved".
  const page = extractSession(html);

  return {
    handle: values[HANDLE_KEY],
    signedInAs: page?.username ?? null,
    rating: page?.rating ?? null,
    signedIn: Boolean(page?.username),
  };
}

/**
 * CodeChef is the one platform where the browser session *is* the identity —
 * the other two are asked *about* a handle, whoever is signed in. Settings says
 * so in the verb, and that distinction is the adapter's to make rather than the
 * page's, or it turns back into a branch on the platform.
 */
export function describeIdentity(identity) {
  return `Signed in as ${identity.username}.`;
}

export async function fetchContestRecord({
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

  return ready({
    id: payload.code,
    platform: codechef.id,
    // A parent contest resolves to one of its divisions, so the id stored is
    // not the id the user was looking at. Remember theirs, or the add banner
    // can never tell that /START252 is already tracked as START252D.
    ...(payload.code !== contestId ? { sourceId: contestId } : {}),
    name: payload.contest.name ?? `Contest ${payload.code}`,
    type: subtype,
    problems: built,
    publishedDataCheckedAt: Date.now(),
    startTimeSeconds: payload.contest.time?.start ?? null,
    addedAt: Date.now(),
  });
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
 * 1 = Accepted, from the practice page's own status map:
 * `{0: Unattempted, 1: Accepted, 2: Partially Correct, 3: Wrong Answer, …}`.
 *
 * An explicit allow-list rather than "anything but 0". `solved` is sticky and
 * never cleared (progress-manager.js), so a false positive permanently hides a
 * problem you have not solved, while a false negative costs one refresh. And 2
 * is Partially Correct — scoring some subtasks is not finishing the problem,
 * the same call `problemsstats` already made by ignoring `partially_solved`.
 */
const ACCEPTED = 1;

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
 * Some old problems were never mirrored into CodeChef's practice archive.
 * `START32C/problems/MAXTHEMIN` still shows its statement inside the contest,
 * but `/problems/MAXTHEMIN` 404s — and a contest stops accepting submissions
 * when it ends, so there is nowhere left to submit it. It is dead work, and
 * because `solved` is only ever set true nothing would ever clear it from the
 * queue.
 *
 * `is_added_to_practice` on the contest payload answers this exactly, and comes
 * free — `fetchContestRecord` already has that payload in hand. Two nearby
 * fields do **not** answer it, so don't reach for them again: `problem_url` is
 * `/problems/MAXTHEMIN` even for the problem that 404s there, and
 * `is_direct_submittable` is false for everything when signed out, since it
 * tracks login state rather than mirroring.
 *
 * The key is written only when the answer is no. Absent means upsolvable, which
 * is every problem on Codeforces and AtCoder — both serve their whole history
 * from a stable per-contest route.
 */
function practiceFlag(problem) {
  return problem?.is_added_to_practice === false ? { upsolvable: false } : {};
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
 * Every problem this account has solved, contest or practice.
 *
 * This used to read `problemsstats.solved` per tracked contest, which only ever
 * reflects submissions made **during** the contest. CodeChef closes a contest
 * to submissions when it ends, so upsolving happens in practice — and that read
 * could never see it, leaving every CodeChef problem in the queue forever.
 *
 * Now user-wide, like Codeforces' `user.status` and AtCoder's submissions feed,
 * so `contests` is unused. It is also cheaper: a few paged requests rather than
 * one per tracked contest.
 */
export async function fetchSolvedKeys(session, _contests, onProgress = () => {}) {
  // Signed out — or signed in as somebody else — the listing answers for the
  // wrong account, and an empty answer is indistinguishable from having solved
  // nothing. Refuse, so the caller isolates the failure and leaves flags alone.
  await verifyIdentity(session);

  const rows = await getAttemptedProblems(onProgress);
  const keys = new Set();

  for (const row of rows) {
    if (Number(row?.status) !== ACCEPTED) continue;
    if (!row?.code) continue;
    // solvedKey ignores its contest argument — a CodeChef problem is identified
    // by its code alone, which is why one solve clears every tracked division.
    keys.add(codechef.solvedKey(null, { index: row.code }));
  }

  return keys;
}

/**
 * How long a contest with unrated problems waits before being asked again.
 *
 * Governs the **difficulty** re-check only. That one costs a request per
 * still-unrated problem, so it is throttled to a week — the same shape as the
 * Codeforces tag re-check. The practice re-check has its own, much faster
 * cadence and its own cost argument; see `refreshPracticeFlags`.
 */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Re-checks what only settles after a contest is added.
 *
 * Two independent passes, deliberately on different cadences: whether a problem
 * reached CodeChef's practice archive is re-read on **every** refresh, while a
 * missing published difficulty is re-read at most weekly. Sharing one gate
 * would let the slower pass suppress the faster.
 *
 * @returns {number} records updated, across both passes. Nothing in production
 *   reads it; it exists so the tests can tell a real update from a no-op.
 */
export async function syncMetadata(session, contests, onProgress = () => {}) {
  const now = Date.now();

  let updated = await refreshPracticeFlags(contests, onProgress);

  const stale = contests.filter(
    (contest) =>
      contest.problems.some((problem) => problem.rating === null) &&
      now - (contest.publishedDataCheckedAt ?? 0) > RECHECK_AFTER_MS,
  );
  if (stale.length === 0) return updated;

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
        updated++;
      } catch (error) {
        console.warn(`[CodeChef] re-check of ${problem.index} failed:`, error.message);
      }
    }
    contest.publishedDataCheckedAt = now;
  }

  return updated;
}

/**
 * Re-reads `is_added_to_practice` for contests that might have it wrong.
 *
 * Writes in both directions — a problem CodeChef later mirrors has to come back
 * to the queue, so this cannot be write-once the way `solved` is.
 *
 * Two reasons it runs on every refresh rather than on the weekly stamp. A wrongly-flagged problem would otherwise
 * sit out of the queue for a week; and a contest added *hours* after it ends may
 * plausibly report every problem as unmirrored simply because CodeChef has not
 * got to them yet, which would empty the queue for exactly the contest you most
 * want to upsolve. Per-refresh means that self-corrects on the next one.
 * (Unconfirmed: the freshest contests reachable when this was written —
 * START252D and DSAMONDAY016, four and six days old — already reported every
 * problem mirrored, so the delay could not be reproduced.)
 *
 * The cost is bounded by the selection: a contest is asked about only while it
 * still carries a flagged problem, so a fully-mirrored queue — which is the
 * normal case — costs nothing at all. Reading the **contest** payload rather
 * than the per-problem endpoint is what makes even the flagged case cheap: one
 * request per affected contest, against one per affected *problem*. `getContest`
 * is memoised for a minute on top of that.
 *
 * Note this deliberately never re-checks a contest with nothing flagged. The
 * only thing that would find is CodeChef *removing* a problem from practice,
 * which does not happen; paying a request per contest per refresh to look for
 * it would be the sweep this client exists to avoid.
 */
async function refreshPracticeFlags(contests, onProgress) {
  const pending = contests.filter((contest) =>
    contest.problems.some((problem) => problem.upsolvable === false),
  );
  if (pending.length === 0) return 0;

  let changed = 0;

  for (const contest of pending) {
    try {
      const payload = await getContest(contest.id);
      const problems = payload?.problems ?? {};

      for (const problem of contest.problems) {
        const entry = problems[problem.index];
        // A problem missing from the payload tells us nothing — keep what we
        // already knew rather than guessing it back into the queue.
        if (!entry) continue;

        const wasUpsolvable = problem.upsolvable !== false;
        const isUpsolvable = entry.is_added_to_practice !== false;
        if (wasUpsolvable === isUpsolvable) continue;

        // Deleted rather than set true, so the stored shape stays "present only
        // when it means something" — the same rule buildProblem writes under.
        if (isUpsolvable) delete problem.upsolvable;
        else problem.upsolvable = false;

        onProgress(
          isUpsolvable
            ? `${problem.index} is on practice now…`
            : `${problem.index} isn't on practice…`,
        );
        changed++;
      }
    } catch (error) {
      console.warn(
        `[CodeChef] practice re-check of ${contest.id} failed:`,
        error.message,
      );
    }
  }

  return changed;
}

/**
 * Checks the browser is signed in as the account this queue is for.
 *
 * Unlike the other two, CodeChef's data comes back for whoever holds the
 * session cookie rather than for a handle we ask about. So the configured
 * handle is the authority, and the session is checked against it.
 *
 * @throws when no handle is configured, when signed out, or — the dangerous
 *   one — when signed in as somebody else. Signing out is indistinguishable
 *   from having solved nothing, since `problemsstats.solved` is simply empty,
 *   so none of these may fall through to a caller.
 */
export async function verifyIdentity(session) {
  if (!session?.handle) {
    throw new Error("No CodeChef handle set. Add one in Settings.");
  }

  if (!session.signedIn) {
    throw new Error(
      `Not signed in to CodeChef. Sign in as ${session.handle} at codechef.com.`,
    );
  }

  if (session.signedInAs !== session.handle) {
    const error = new Error(
      `Signed in to CodeChef as ${session.signedInAs}, but this queue is for ` +
        `${session.handle}. Sign in as ${session.handle}, or change the handle in Settings.`,
    );
    // Flagged so callers can tell "the wrong account is signed in" — which
    // must always stop the operation — from "this platform isn't set up".
    error.isIdentityMismatch = true;
    throw error;
  }

  return {
    username: session.handle,
    rating: typeof session.rating === "number" ? session.rating : null,
  };
}
