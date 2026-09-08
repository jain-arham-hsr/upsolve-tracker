/**
 * Codeforces' gyms — everything under `/gym/<id>`.
 *
 * A visible gym reads everything from the signed `contest.standings` call. A
 * gym whose standings the setter hid answers FAILED to it, and is the one
 * Codeforces path that can read a page: the `/gym/<id>` problems page is the
 * only page those contests render, and the field is recovered from who
 * submitted, via `contest.status`. See the official platform for why the two
 * are platforms rather than subtypes.
 */
import { Platform } from "../../platform.js";
import { site } from "../site.js";
import { CodeforcesSources } from "../sources.js";
import { estimate } from "../estimator.js";
import { notEndedYet, unavailable } from "../../../contest-status.js";
import { fullField, distributionSize } from "../../../rating-models/rating-distribution.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)/i;

export class CodeforcesGyms extends Platform {
  static site = site;
  static Sources = CodeforcesSources;

  id = "codeforces-gyms";

  label = "Codeforces Gyms";

  shortLabel = "CF";

  subtypes = [{ value: "GYM", label: "Gym" }];

  /** `/contest/<id>` falls through to the official platform. */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    return match ? { contestId: match[1], subtype: "GYM" } : null;
  }

  contestUrl(contest) {
    return `${this.origin}/gym/${contest.id}`;
  }

  /** Display-only, e.g. "Gym 104123A". */
  sourceLabel(contest, problem) {
    return `Gym ${contest.id}${problem.index}`;
  }

  filterGroups = [{ key: "codeforces-gyms", label: "Codeforces Gyms" }];

  filterKey() {
    return "codeforces-gyms";
  }

  /** Worth labelling: a gym is off the public problemset, mostly estimated, with no editorial. */
  contestFlags() {
    return ["Gym"];
  }

  contestLabel() {
    return "Gym contest";
  }

  capabilities = {
    // Gyms sit outside CF's taxonomy and their tags are usually bare, but the
    // vocabulary exists — they come off the standings response.
    publishesTags: true,
    canEstimate: true,
  };

  // ── the work ──────────────────────────────────────────────────────────

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
      read = this.fromStandings(contestId, await sources.contestStandings(contestId));
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
    await this.syncStartTimes(session, [record], onProgress);

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
      problems: CodeforcesSources.problemsFrom(contestId, standings),
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
      // Carried, never stored: `readField` measures the field from these rows.
      standings,
    };
  }

  /**
   * A gym's field arrives whole: 5–76 parties in one `contest.standings`
   * response, so there is nothing to sample — and far too few to sample from,
   * which is why a gym estimate is so much noisier than an official one. When
   * the standings are hidden the field is recovered from who submitted; that
   * field is narrower, but a party that entered and submitted nothing solved
   * nothing either, so the counts stay consistent with it.
   *
   * @returns {Promise<object>} the distribution, or `unavailable` — a gym with
   *   no measurable field never gains one, so it refuses rather than waits.
   */
  async readField({ contest, context, session, onProgress = () => {} }) {
    const { solveCountsRead, partyHandles, standings } = context;
    const gaps = contest.problems.filter((problem) => problem.rating === null).length;

    // Unreachable today — gym counts come from the API, not a parsed totals
    // row — and kept deliberately: the alternative is estimating from counts
    // that were never read, which invents ratings silently.
    if (!solveCountsRead) {
      return unavailable(
        `Couldn't read the solve counts for gym ${contest.id}, and ${gaps} ` +
          `problem(s) have no published rating to fall back on.`,
      );
    }

    onProgress("Measuring the field…");

    const distribution = partyHandles
      ? await fieldFromParties(session.sources, partyHandles)
      : await fieldFromStandings(session.sources, contest.id, standings);

    console.log(
      `[Codeforces] Distribution: ${distributionSize(distribution)} competitors read, ` +
        `representing ~${Math.round(
          distribution.strata.reduce((sum, s) => sum + s.ratings.length * s.scale, 0),
        )}.`,
    );

    // Permanent: private or empty standings do not become visible later.
    if (distributionSize(distribution) === 0) {
      return unavailable(
        `Couldn't rate gym ${contest.id}: its participants aren't visible, so ` +
          `there is no field to measure against.`,
      );
    }

    return distribution;
  }

  /** Gyms are a separate list from official rounds. */
  contestList(session) {
    return session.sources.contestList({ gym: true });
  }

  /**
   * The bulk `contest.list?gym=true` first, then one `contest.standings` each
   * for whatever it did not cover. Private gyms and mashups (the 6xxxxx ids)
   * never appear in the list; most are dated at add time from the standings
   * already in hand, and this covers the rest.
   */
  async syncStartTimes(session, contests, onProgress = () => {}) {
    const pending = contests.filter((contest) => !contest.startTimeSeconds);
    if (pending.length === 0) return 0;

    let resolved = await super.syncStartTimes(session, contests, onProgress);

    const gyms = pending.filter((contest) => !contest.startTimeSeconds);
    for (const [index, contest] of gyms.entries()) {
      // Deliberately slow — the API pacer spaces these — so it counts itself off.
      onProgress(`Dating gym ${index + 1} of ${gyms.length}…`);
      try {
        const standings = await session.sources.contestStandings(contest.id);
        const startTime = standings?.contest?.startTimeSeconds;
        if (startTime) {
          contest.startTimeSeconds = startTime;
          resolved++;
        }
      } catch (error) {
        console.warn(`[Codeforces] Gym ${contest.id} standings failed:`, error.message);
      }
    }

    return resolved;
  }

  /**
   * Only start times. A gym's rating is inherited from an already-rated
   * archive problem, so unlike Codeforces' editable tags it never appears
   * later, and re-checking would cost one `contest.standings` per gym per
   * refresh forever.
   */
  async syncMetadata(session, contests, onProgress = () => {}) {
    await this.syncStartTimes(session, contests, onProgress);
  }

  estimate(contest, field) {
    return estimate(contest, field);
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

  const derived = CodeforcesSources.summariseSubmissions(await sources.contestSubmissions(contestId));

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

/** `standings` is the response the add already paid for; the hidden path has none. */
async function fieldFromStandings(sources, contestId, prefetched) {
  try {
    const standings = prefetched ?? (await sources.contestStandings(contestId));

    if (!standings?.rows?.length) {
      console.warn(`[Codeforces] Standings API returned empty for ${contestId}.`);
      return fullField([]);
    }

    return fullField(
      await sources.partyRatings(
        standings.rows.map((row) => row.party.members.map((m) => m.handle)),
      ),
    );
  } catch (error) {
    console.warn(`[Codeforces] Standings method failed for ${contestId}:`, error.message);
    return fullField([]);
  }
}

async function fieldFromParties(sources, partyHandles) {
  if (!partyHandles?.length) return fullField([]);

  try {
    return fullField(await sources.partyRatings(partyHandles));
  } catch (error) {
    console.warn(`[Codeforces] Submission-derived field failed:`, error.message);
    return fullField([]);
  }
}
