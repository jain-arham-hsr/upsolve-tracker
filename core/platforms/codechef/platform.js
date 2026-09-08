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
import { site } from "./site.js";
import { CodeChefApi, ACCEPTED, parseDifficulty, cleanTags, practiceFlag } from "./api.js";
import { CodeChefScraper } from "./scraper.js";
import {
  notEndedYet,
  notPublishedYet,
  sourceUnreachable,
  unavailable,
} from "../../contest-status.js";

/** Upper-case only: that is what separates a contest code from /problems, /ratings and the rest. */
const URL_PATTERN =
  /^https?:\/\/(?:www\.)?codechef\.com\/(?:rankings\/)?([A-Z][A-Z0-9]{2,})(?:[/?#]|$)/;

const SUBTYPES = [
  [/^START\d/, "STARTERS", "Starters"],
  [/^COOK\d/, "COOKOFF", "Cook-Off"],
  [/^LTIME\d/, "LUNCHTIME", "Lunchtime"],
];

export class CodeChef extends Platform {
  static site = site;
  static Api = CodeChefApi;
  static Scraper = CodeChefScraper;

  id = "codechef";

  label = "CodeChef";

  shortLabel = "CC";

  subtypes = [...SUBTYPES.map(([, value, label]) => ({ value, label })), { value: "OTHER", label: "Other" }];

  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    if (!match) return null;

    const contestId = match[1];
    return { contestId, subtype: subtypeFor(contestId) };
  }

  contestUrl(contest) {
    return `${this.origin}/${contest.id}`;
  }

  /** The in-contest URL, not the practice one the API's `problem_url` points at. */
  problemUrl(contest, problem) {
    return `${this.contestUrl(contest)}/problems/${problem.index}`;
  }

  /**
   * Display-only, without the division letter: a Starters problem usually
   * runs in several divisions at once, so "START252D MODSUB" claims a
   * membership that is not true. The stored id keeps the letter.
   */
  sourceLabel(contest, problem) {
    return `${withoutDivision(contest.id)} ${problem.index}`;
  }

  filterGroups = [{ key: "codechef", label: "CodeChef" }];

  filterKey() {
    return "codechef";
  }

  /** Nothing about a CodeChef contest changes how its row should be read. */
  contestFlags() {
    return [];
  }

  contestLabel() {
    return "CodeChef contest";
  }

  /** Already a code, not a number; the division comes off for the reason `sourceLabel` gives. */
  contestIdLabel(contest) {
    return withoutDivision(contest.id);
  }

  /**
   * Keyed on the problem code alone. Codes are unique site-wide, and the same
   * problem runs in every division of a Starters — solving it in Div 4 has to
   * clear it from a tracked Div 3 as well.
   */
  solvedKey(contest, problem) {
    return `codechef:${problem.index}`;
  }

  problemKey(contest, problem) {
    return this.solvedKey(contest, problem);
  }

  capabilities = {
    // Tags come back with each problem, mixed with the setter's handle and
    // the contest code; `cleanTags` strips those.
    publishesTags: true,
    // No estimator: /api/rankings/ answers 403, so there is no field to fit
    // against. A -1 or 9999 sentinel stores as null and renders "???".
    canEstimate: false,
  };

  // ── the work ──────────────────────────────────────────────────────────

  /**
   * The handle you declared, plus whoever the browser is actually signed in
   * as. Both, because they can differ — and that difference is the point.
   */
  async buildSession(values) {
    const api = CodeChefApi.fromSettings(values);
    const scraper = CodeChefScraper.fromSettings(values);
    const page = await scraper.dashboard();

    return {
      handle: values[this.handleSlug],
      api,
      scraper,
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
        built.push(await buildProblem(session.api, payload.code, problem, solved));
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

    const rows = await session.api.attemptedProblems(onProgress);
    const accepted = [];

    for (const row of rows) {
      if (Number(row?.status) !== ACCEPTED) continue;
      if (!row?.code) continue;
      accepted.push({ contest: { id: null }, problem: { index: row.code } });
    }

    return accepted;
  }

  /**
   * Two passes on different cadences, each with its own gate: whether a
   * problem reached the practice archive is re-read on **every** refresh, a
   * missing published difficulty at most weekly. They must never share a
   * gate, or the slower pass suppresses the faster.
   *
   * @returns {number} records updated, for the tests; nothing in production reads it.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    const mirrored = await refreshPracticeFlags(session, contests, onProgress);
    const rated = await syncPublishedDifficulty(session, contests, onProgress);
    return mirrored + rated;
  }
}

/** START252D → START252. Anchored on digits before the letter, so codes that simply end in one are untouched. */
function withoutDivision(contestId) {
  return String(contestId).replace(/^([A-Z]+\d+)[A-Z]$/, "$1");
}

function subtypeFor(contestId) {
  for (const [pattern, value] of SUBTYPES) {
    if (pattern.test(contestId)) return value;
  }
  return "OTHER";
}


/**
 * `/START252` is a parent with no problems of its own — and it returns an
 * empty list rather than an error. Divisions are rating-banded, so the user's
 * own rating picks the one they competed in.
 */
async function resolveDivision(contestId, session, onProgress) {
  const contest = await session.api.contest(contestId);
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
  return { code: match.contest_code, contest: await session.api.contest(match.contest_code) };
}

/**
 * Signed out, `problemsstats.solved` is an empty **array**; signed in it is an
 * **object** keyed by problem code. `Object.keys` handles both. `partially_solved`
 * is deliberately not counted.
 */
function solvedCodes(contest) {
  return new Set(Object.keys(contest?.problemsstats?.solved ?? {}));
}

async function buildProblem(api, contestCode, problem, solved) {
  const code = problem.code;

  // Only the request is guarded, and it is re-thrown flagged rather than
  // swallowed: a failed fetch is not evidence that CodeChef has no rating, and
  // a null here is indistinguishable from CodeChef answering "-1".
  let detail;
  try {
    detail = await api.problem(contestCode, code);
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

// ---------------------------------------------------------------------------
// Post-add passes
// ---------------------------------------------------------------------------

/**
 * Re-reads `is_added_to_practice` for contests that might have it wrong.
 *
 * Writes in both directions — a problem CodeChef later mirrors has to come back
 * to the queue, so this cannot be write-once the way `solved` is.
 *
 * Two reasons it runs on every refresh rather than on the weekly stamp. A
 * wrongly-flagged problem would otherwise sit out of the queue for a week; and
 * a contest added *hours* after it ends may
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
 * request per affected contest, against one per affected *problem*. `api.contest`
 * is memoised for a minute on top of that.
 *
 * Note this deliberately never re-checks a contest with nothing flagged. The
 * only thing that would find is CodeChef *removing* a problem from practice,
 * which does not happen; paying a request per contest per refresh to look for
 * it would be the sweep this client exists to avoid.
 */
async function refreshPracticeFlags(session, contests, onProgress = () => {}) {
  const pending = contests.filter((contest) =>
    contest.problems.some((problem) => problem.upsolvable === false),
  );
  if (pending.length === 0) return 0;

  let changed = 0;

  for (const contest of pending) {
    try {
      const payload = await session.api.contest(contest.id);
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

const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Asks CodeChef again about the problems it had not rated yet.
 *
 * Converges rather than settles once: a problem stored `???` gains its real
 * number on a later refresh, at which point the contest stops being asked
 * about at all. Costs a request per still-unrated problem, which is why it is
 * throttled to a week.
 *
 * @returns {number} problems updated. Nothing in production reads it; it exists
 *   so the tests can tell a real update from a no-op.
 */
async function syncPublishedDifficulty(session, contests, onProgress = () => {}) {
  const now = Date.now();
  let updated = 0;

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
        const detail = await session.api.problem(contest.id, problem.index);
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
