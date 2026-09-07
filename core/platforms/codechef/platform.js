/**
 * CodeChef.
 *
 * The one platform where the browser session *is* the identity: the API
 * answers for whoever holds the cookie, so the configured handle is compared
 * against the signed-in account and a mismatch stops everything. `solved` is
 * only ever set true, fully-solved contests are deleted outright, and the
 * backup is written after the sync — one sync under another account
 * permanently corrupts the queue *and* overwrites the backup with it.
 *
 * No estimator: CodeChef publishes `difficulty_rating`, and promptly. An add
 * costs one request for the contest plus one per problem, since difficulty
 * and tags appear on no bulk or contest-level response.
 *
 * Solved status is read per *user*, not per contest: a contest stops
 * accepting submissions when it ends, so upsolving happens in practice, and
 * neither the contest payload nor the per-problem endpoint ever sees it.
 */
import { Platform } from "../platform.js";
import { codechef } from "./descriptor.js";
import { sources, ACCEPTED } from "./sources.js";
import { DashboardPage } from "./scrapers/page-globals.js";
import { parseDifficulty, cleanTags, syncPublishedDifficulty } from "./sync/published-data.js";
import { practiceFlag, refreshPracticeFlags } from "./sync/practice-flags.js";
import {
  notEndedYet,
  notPublishedYet,
  sourceUnreachable,
  unavailable,
} from "../../contest-status.js";

const HANDLE_KEY = "upsolve_tracker.codechef_handle";

export class CodeChef extends Platform {
  static settingsSection = "codechef";

  constructor() {
    super(codechef);
    this.sources = sources;
  }

  /**
   * The handle you declared, plus whoever the browser is actually signed in
   * as. Both, because they can differ — and that difference is the point.
   */
  async buildSession(values) {
    // Null both when signed out and when the shell no longer carries the
    // bootstrap object. Either way the caller must not read an empty solved
    // list as "nothing solved".
    const page = DashboardPage.scrape(await this.sources.dashboard());

    return {
      handle: values[HANDLE_KEY],
      sources: this.sources,
      signedInAs: page?.username ?? null,
      rating: page?.rating ?? null,
      signedIn: Boolean(page?.username),
    };
  }

  /**
   * @throws when no handle is configured, when signed out, or — the dangerous
   *   one — when signed in as somebody else. Signing out is indistinguishable
   *   from having solved nothing, so none of these may fall through.
   */
  async identify(session) {
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

  /** Here the session really is the identity, and Settings says so in the verb. */
  describeIdentity(identity) {
    return `Signed in as ${identity.username}.`;
  }

  async fetchContest({ contestId, session, onProgress = () => {} }) {
    onProgress("Reading the contest…");
    const payload = await resolveDivision(contestId, session, onProgress);
    if (payload.status) return payload;

    // CodeChef reports its own clock beside the contest's end, so this asks
    // *its* time rather than ours — a skewed local clock cannot mis-decide it.
    // Without this the problems are listed mid-contest and the add succeeds
    // against in-contest data.
    const time = payload.contest.time ?? {};
    if (time.current != null && time.end != null && time.current <= time.end) {
      return notEndedYet(`"${payload.code}" is still running. It'll be added once it ends.`);
    }

    const problems = Object.values(payload.contest.problems ?? {});
    if (problems.length === 0) {
      return notPublishedYet(`CodeChef hasn't listed the problems for "${payload.code}" yet.`);
    }

    const solved = solvedCodes(payload.contest);

    const built = [];
    for (const [index, problem] of problems.entries()) {
      onProgress(`Reading problem ${index + 1} of ${problems.length}…`);
      try {
        built.push(await buildProblem(session.sources, payload.code, problem, solved));
      } catch (error) {
        if (!error?.isSourceUnreachable) throw error;
        // Fail fast: the remaining requests would be spent on an add that is
        // going to be discarded. "We couldn't ask" must never become a "???".
        return sourceUnreachable(
          `Couldn't reach CodeChef for every problem in "${payload.code}". (${error.message})`,
        );
      }
    }

    return {
      id: payload.code,
      // A parent contest resolves to one of its divisions, so the id stored is
      // not the id the user was looking at. The base drops it when it matches.
      sourceId: contestId,
      name: payload.contest.name ?? `Contest ${payload.code}`,
      problems: built,
      publishedDataCheckedAt: Date.now(),
      startTimeSeconds: payload.contest.time?.start ?? null,
    };
  }

  /**
   * Reads the practice page's own source, `/api/list/problems?group=attempted`,
   * and keeps the rows CodeChef marks Accepted.
   *
   * The contest carries `{ id: null }`, not `null`: a CodeChef problem is
   * identified by its code alone, which is why one solve clears every tracked
   * division of the same Starters.
   */
  async fetchAccepted(session, _contests, onProgress = () => {}) {
    // The third of three identity layers, and the one that survives when the
    // callers' checks are both defeated: it makes reading another account's
    // solves impossible from *this* function. It costs nothing — the session
    // object the add already built is all it reads.
    await this.verifyIdentity(session);

    const rows = await session.sources.attemptedProblems(onProgress);
    const accepted = [];

    for (const row of rows) {
      if (Number(row?.status) !== ACCEPTED) continue;
      if (!row?.code) continue;
      accepted.push({ contest: { id: null }, problem: { index: row.code } });
    }

    return accepted;
  }

  /**
   * Two passes on different cadences, so in different files: whether a
   * problem reached the practice archive is re-read on **every** refresh, a
   * missing published difficulty at most weekly. Sharing one gate would let
   * the slower pass suppress the faster.
   *
   * @returns {number} records updated, for the tests; nothing in production reads it.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    const mirrored = await refreshPracticeFlags(session, contests, onProgress);
    const rated = await syncPublishedDifficulty(session, contests, onProgress);
    return mirrored + rated;
  }
}

/**
 * `/START252` is a parent with no problems of its own — and it returns an
 * empty list rather than an error. Divisions are rating-banded, so the user's
 * own rating picks the one they competed in.
 */
async function resolveDivision(contestId, session, onProgress) {
  const contest = await session.sources.contest(contestId);
  if (!contest.is_a_parent_contest) return { code: contestId, contest };

  const children = Object.values(contest.child_contests ?? {});
  if (children.length === 0) {
    return notPublishedYet(`CodeChef hasn't listed the divisions of "${contestId}" yet.`);
  }

  const codes = children.map((child) => child.contest_code).join(", ");
  const rating = session?.rating;
  if (rating == null) {
    // Needs you to choose, so retrying silently would be wrong.
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
  return { code: match.contest_code, contest: await session.sources.contest(match.contest_code) };
}

/**
 * Signed out, `problemsstats.solved` is an empty **array**; signed in it is an
 * **object** keyed by problem code. `Object.keys` handles both. `partially_solved`
 * is deliberately not counted.
 */
function solvedCodes(contest) {
  return new Set(Object.keys(contest?.problemsstats?.solved ?? {}));
}

async function buildProblem(sources, contestCode, problem, solved) {
  const code = problem.code;

  // Only the request is guarded, and it is re-thrown flagged rather than
  // swallowed: a failed fetch is not evidence that CodeChef has no rating, and
  // a null here is indistinguishable from CodeChef answering "-1".
  let detail;
  try {
    detail = await sources.problem(contestCode, code);
  } catch (error) {
    throw Object.assign(error, { isSourceUnreachable: true });
  }

  const rating = parseDifficulty(detail?.difficulty_rating);

  return {
    index: code,
    name: problem.name ?? code,
    rating,
    ratingSource: rating === null ? null : "official",
    ratingConfidence: null,
    officialSolves: Number.parseInt(problem.successful_submissions, 10) || 0,
    solved: solved.has(code),
    tags: cleanTags(detail, contestCode),
    ...practiceFlag(problem),
  };
}
