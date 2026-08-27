/**
 * Rebuilding a gym from its submissions, for contests whose standings
 * Codeforces has hidden.
 *
 * A gym can be set to "Standings will not be visible as original contest".
 * When it is, both halves of the usual acquisition path are gone at once: the
 * standings page carries no table, and contest.standings answers FAILED with
 * "Standings are not available". contest.status still answers, and it carries
 * everything the standings response was being mined for — problem metadata,
 * who competed, and what they solved.
 *
 * The derivation is pure so it can be tested against a captured contest
 * without a network stack, the way applySolvedStatus is. See
 * tests/contest-status.test.js, which pins it to a real hidden-standings gym.
 */

/** Matches getContestStandings' participantTypes, so both gym paths agree. */
const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

/** contest.status pages; 10k is accepted in one request. */
const PAGE_SIZE = 10000;

/**
 * Refuse rather than walk an unbounded contest. A submission is ~400 bytes of
 * JSON, so this is already a larger response than the ~12MB standings the
 * scraper pays for on a big Div. 3.
 */
const MAX_SUBMISSIONS = 50000;

/**
 * Every submission to a contest, paged.
 *
 * @param {CodeforcesService} cfService
 * @param {string|number} contestId
 * @returns {Promise<object[]>}
 */
export async function fetchContestSubmissions(cfService, contestId) {
  const submissions = [];
  let from = 1;

  while (true) {
    const page = await cfService.getContestStatus(contestId, {
      from,
      count: PAGE_SIZE,
    });
    if (!page?.length) break;

    submissions.push(...page);
    if (page.length < PAGE_SIZE) break;

    from += PAGE_SIZE;

    // Truncating silently would understate every solve count, and an
    // understated count reads as a harder problem rather than as a failure.
    if (submissions.length >= MAX_SUBMISSIONS) {
      throw new Error(
        `Gym ${contestId} has more than ${MAX_SUBMISSIONS} submissions, which is too many to ` +
          `rebuild a hidden standings from.`,
      );
    }
  }

  return submissions;
}

/**
 * Derives everything the add path needs from a contest's submissions.
 *
 * Practice submissions are excluded throughout: they happen after the contest,
 * so counting them would overstate how many people solved a problem under
 * contest conditions, which is exactly the quantity the estimator is fitted
 * to. Ghost parties are excluded for the same reason the standings path
 * excludes them.
 *
 * @param {object[]} submissions - contest.status rows
 * @returns {{
 *   solveCounts: Record<string, number>,
 *   problemMeta: Map<string, {name: string, rating: number|null, tags: string[]}>,
 *   partyHandles: string[][],
 *   startTimeSeconds: number|null,
 *   sawOfficialSubmissions: boolean,
 * }}
 */
export function deriveContestStatusData(submissions) {
  const solvers = new Map(); // problem index -> Set of party id
  const problemMeta = new Map();
  const parties = new Map(); // party id -> string[] of handles
  const startTimes = new Map(); // startTimeSeconds -> party count

  for (const submission of submissions ?? []) {
    const problem = submission?.problem;
    const author = submission?.author;
    if (!problem?.index || !author) continue;

    // Problem metadata is worth taking from any submission, including a
    // practice one: it describes the problem, not the attempt.
    if (!problemMeta.has(problem.index)) {
      problemMeta.set(problem.index, {
        name: problem.name ?? null,
        rating: typeof problem.rating === "number" ? problem.rating : null,
        tags: problem.tags ?? [],
      });
    }

    if (!OFFICIAL_PARTICIPANT_TYPES.has(author.participantType)) continue;
    if (author.ghost) continue;

    const partyId = author.participantId;
    if (partyId == null) continue;

    if (!parties.has(partyId)) {
      parties.set(
        partyId,
        (author.members ?? []).map((member) => member.handle).filter(Boolean),
      );
      if (author.startTimeSeconds != null) {
        startTimes.set(
          author.startTimeSeconds,
          (startTimes.get(author.startTimeSeconds) ?? 0) + 1,
        );
      }
    }

    if (submission.verdict !== "OK") continue;

    // A party that solves the same problem twice still solved it once.
    if (!solvers.has(problem.index)) solvers.set(problem.index, new Set());
    solvers.get(problem.index).add(partyId);
  }

  const solveCounts = {};
  for (const [index, partySet] of solvers) solveCounts[index] = partySet.size;

  return {
    solveCounts,
    problemMeta,
    partyHandles: [...parties.values()],
    startTimeSeconds: mostCommon(startTimes),
    sawOfficialSubmissions: parties.size > 0,
  };
}

/**
 * Virtual entrants each carry their own start time, so the contest's own is
 * the one the most parties share rather than the first one seen.
 */
function mostCommon(tally) {
  let best = null;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
