/**
 * What the two Codeforces platforms share: one account.
 *
 * One handle, one key pair, one settings section — and one submission stream.
 * `user.status` carries no gym/official marker, so each platform reads the
 * same stream and stamps its own `solvedKey` prefix on it; `applySolvedStatus`
 * looks up by the prefix of the platform that owns the contest, so the second
 * read is load-bearing rather than waste.
 *
 * Whose account this is: Codeforces is asked *about* a handle, and
 * `user.status?handle=X` returns X's submissions whoever's key signs the
 * request. There is no "who am I" endpoint, so the handle is verified to
 * exist, not to be yours; the changed-identity path in
 * `services/platform-identity.js` is what contains a wrong one.
 *
 * What each platform adds is the acquisition — an official round is pure
 * JSON, a gym is the one Codeforces path that can scrape — and the Source
 * class it reads through, named in `static Sources`.
 */
import { Platform } from "../platform.js";
import { estimate } from "./estimator.js";
import { CodeforcesSources } from "./sources.js";
import { computeTeamRating } from "../../rating-models/team-rating.js";

const HANDLE_KEY = "upsolve_tracker.handle";

export class CodeforcesPlatform extends Platform {
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
export async function ratePartyList(sources, parties) {
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
