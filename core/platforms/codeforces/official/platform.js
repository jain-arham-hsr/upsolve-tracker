/**
 * Codeforces, official rounds.
 *
 * The whole acquisition path touches no HTML. One unsigned `contest.standings`
 * call carries the contest name, the problems in order with their published
 * ratings and tags, the start time, and rows enough to count in-contest solves
 * — and to measure the field when nothing else can.
 */
import { CodeforcesPlatform } from "../platform.js";
import { codeforcesOfficial } from "./descriptor.js";
import { readField } from "./field.js";
import { OfficialSources } from "./sources.js";
import { sync as syncPublishedData } from "./sync/published-data.js";
import { sync as syncStartTimes } from "../sync/start-times.js";
import { notPublishedYet } from "../../../contest-status.js";

export class CodeforcesOfficial extends CodeforcesPlatform {
  static Sources = OfficialSources;

  constructor() {
    super(codeforcesOfficial);
  }

  /**
   * @returns a status when a gate fires, otherwise the record plus a `context`
   *   the estimator needs — which is how the standings response reaches it
   *   without being fetched twice.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    const { sources } = session;

    // problemset.problems is where Codeforces publishes an official contest's
    // problems, so its absence is the whole "not published yet" question,
    // answered in one cached call before anything expensive happens. There is
    // no equivalent gate on a gym: gyms are absent from the problemset
    // entirely, which is why the two pipelines are two classes.
    onProgress("Checking whether Codeforces has published it…");
    if (!inProblemset(await sources.problemsetProblems(), contestId)) {
      return notPublishedYet(
        `Codeforces hasn't published contest ${contestId} yet. It'll be added ` +
          `on a refresh once it appears.`,
      );
    }

    // One unsigned call carries the name, the problems with their published
    // ratings and tags, the start time, and rows enough to count solves. It is
    // the only thing that reports a shared Div. 1 / Div. 2 problem's rating
    // under this contest's own index. Failure is hard: it is the only source
    // of the roster, and it is flagged so the add waits rather than refuses.
    onProgress("Reading the standings…");
    const standings = await sources.publicContestStandings(contestId);
    const problems = this.problemsFromStandings(contestId, standings);

    // A running round cannot reach here — it would not be in the problemset —
    // so unlike a gym this needs no phase check of its own.
    const record = {
      id: contestId,
      name: standings?.contest?.name ?? `Contest ${contestId}`,
      problems,
      // Stamped, not null: every rating and tag the standings carry is already
      // applied. A round Codeforces has not rated yet stores estimates and is
      // settled later by `sync/published-data.js`.
      publishedDataCheckedAt: Date.now(),
      startTimeSeconds: standings?.contest?.startTimeSeconds ?? null,
    };

    await syncStartTimes(session, [record], onProgress);

    return {
      ...record,
      // Passed, never stored: ~8.5 MB of one round's field. The estimator
      // measures the field from these rows rather than fetching them again.
      // `solveCountsRead` is true unconditionally: counts come from rows or
      // not at all, and there is no totals row left to misparse.
      context: { solveCountsRead: true, standings },
    };
  }

  readField(args) {
    return readField(args);
  }

  /**
   * Published tags and ratings, and start times. Both no-op once everything
   * is resolved, so a settled queue costs nothing.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await syncPublishedData(session, contests, onProgress);
    await syncStartTimes(session, contests, onProgress);
  }
}

/**
 * Whether Codeforces has published this contest's problems yet — the
 * publication gate, and only that. Present does not mean rated: 41 of 2,007
 * contests in the problemset have no rated problem, and the newest are
 * ordinary recent rounds still waiting on Codeforces. A contest that is
 * present but unrated stores with estimates and is settled later. Gyms are
 * absent from the problemset entirely and are never asked.
 */
function inProblemset(problemset, contestId) {
  const wanted = String(contestId);
  return (problemset?.problems ?? []).some((problem) => String(problem.contestId) === wanted);
}
