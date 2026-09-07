/**
 * Codeforces, gyms.
 *
 * A visible gym reads everything from the signed `contest.standings` call. A
 * gym whose standings the setter hid answers FAILED to it, and is the one
 * Codeforces path that still scrapes: the `/gym/<id>` problems page is the
 * only page those contests render, and the field is recovered from who
 * submitted, via `contest.status`.
 */
import { CodeforcesPlatform } from "../platform.js";
import { codeforcesGyms } from "./descriptor.js";
import { readField } from "./field.js";
import { GymSources } from "./sources.js";
import { sync as syncStartTimes } from "./sync/start-times.js";
import { notEndedYet } from "../../../contest-status.js";

export class CodeforcesGyms extends CodeforcesPlatform {
  static Sources = GymSources;

  constructor() {
    super(codeforcesGyms);
  }

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — the standings response, or the party handles when
   *   the standings are hidden.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { sources } = session;

    onProgress("Reading the standings…");
    let read;
    try {
      read = this.fromStandings(contestId, await sources.getContestStandings(contestId));
    } catch (error) {
      // Opens only where the add would otherwise fail outright: a gym whose
      // standings Codeforces has hidden. Anything else — a network fault, a
      // bad key — rethrows untouched, since routing around one would turn a
      // broken request into a silently shorter contest.
      if (!error.isStandingsHidden) throw error;
      read = await fromContestStatus(contestId, sources, error);
    }
    const { contestName, problems, tagsSynced, startTimeSeconds, solveCountsRead, partyHandles, finished, standings } = read;

    // A running gym has visible standings carrying partial solve counts, so
    // the estimator would fit them and store inflated difficulties — and a gym
    // is the one contest nothing ever re-rates. `finished === null` means the
    // source did not say, and proceeds: refusing on an unreadable phase would
    // make a contest unaddable for a reason we cannot state.
    if (finished === false) {
      return notEndedYet(`Gym ${contestId} is still running. It'll be added once it ends.`);
    }

    const record = {
      id: contestId,
      name: contestName,
      problems,
      publishedDataCheckedAt: tagsSynced ? Date.now() : null,
      startTimeSeconds,
    };

    // No problemset sync: gyms are absent from problemset.problems entirely.
    // Tags and published ratings came off the standings response instead.
    await syncStartTimes(session, [record], onProgress);

    return {
      ...record,
      // Passed, never stored: a whole gym's field has no business in storage.
      context: { solveCountsRead, partyHandles, standings },
    };
  }

  /**
   * A visible gym: one signed `contest.standings` call carries the name, the
   * problems with their published ratings and tags, the start time, the phase,
   * and rows enough to count solves. Verified against real gyms — 100001,
   * 102253, 702859 — so a gym add makes no HTML request unless the standings
   * are hidden.
   */
  fromStandings(contestId, standings) {
    return {
      contestName: standings?.contest?.name ?? `Gym ${contestId}`,
      problems: this.problemsFromStandings(contestId, standings),
      // The same response is the only source gyms have for tags and for the
      // difficulty Codeforces publishes.
      tagsSynced: (standings?.problems ?? []).length > 0,
      // The only place private gyms and mashups get a start time: those never
      // appear in contest.list.
      startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
      // Unconditionally true, and deliberate: counts come from the API rather
      // than a parsed totals row. Empty rows also mean an empty field, and the
      // estimator then refuses with the better sentence — "participants aren't
      // visible" — rather than a solve-count message blaming a layout change.
      solveCountsRead: true,
      partyHandles: null,
      finished: standings?.contest?.phase ? standings.contest.phase === "FINISHED" : null,
      // Carried, never stored: `field.js` measures the field from these rows.
      standings,
    };
  }

  readField(args) {
    return readField(args);
  }

  /**
   * Only start times. A gym's rating is inherited from an already-rated
   * archive problem, so unlike Codeforces' editable tags it never appears
   * later, and re-checking would cost one `contest.standings` per gym per
   * refresh forever.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await syncStartTimes(session, contests, onProgress);
  }
}

/**
 * A gym whose standings Codeforces has hidden, rebuilt from `contest.status`.
 *
 * Both usual sources are gone at once: the standings page has no table and
 * `contest.standings` answers FAILED. The problems page still renders and is
 * the authority on what the contest contains — deriving the list from
 * submissions would silently drop any problem nobody attempted. The
 * submissions supply everything else.
 *
 * @param {Error} standingsError - what the standings call threw, so a failure
 *   here can name the original cause rather than replacing it.
 */
async function fromContestStatus(contestId, sources, standingsError) {
  const page = await sources.problemsPage(contestId);

  // Never fall back to a submission-derived list: it would look like a
  // shorter contest rather than a failure.
  if (!page) {
    throw new Error(
      `Gym ${contestId} has its standings hidden, and its problems page couldn't be read ` +
        `either, so there's nothing left to build the contest from. (${standingsError.message})`,
    );
  }

  const derived = GymSources.summariseSubmissions(await sources.contestSubmissions(contestId));

  const problems = page.problems.map((problem) => {
    const meta = derived.problemMeta.get(problem.index);
    // Codeforces publishes a difficulty for the problems it recognises here —
    // the same quantity the estimator approximates — so prefer it.
    const rating = meta?.rating ?? null;
    return {
      ...problem,
      rating,
      ratingSource: rating === null ? null : "official",
      officialSolves: derived.solveCounts[problem.index] ?? 0,
      solved: false,
      tags: meta?.tags ?? [],
    };
  });

  return {
    // A display fallback is the platform's to choose; a scraper never invents one.
    contestName: page.contestName ?? `Contest ${contestId}`,
    problems,
    // Tags come from the same place they do on a visible gym.
    tagsSynced: derived.problemMeta.size > 0,
    startTimeSeconds: derived.startTimeSeconds,
    // With no official submissions at all, every count is zero — which is
    // indistinguishable from "nobody solved anything", and would send every
    // problem to the top of the estimator's range rather than the floor. So
    // the counts are usable only where somebody official competed.
    solveCountsRead: derived.partyHandles.length > 0,
    partyHandles: derived.partyHandles,
    // No standings to ask, so the sidebar says whether it has finished.
    finished: page.finished,
  };
}
