/**
 * Everything the gym platform reads from Codeforces, beyond what
 * `codeforces/sources.js` already covers.
 *
 * Three endpoints, in the order a gym add reaches them:
 *
 *   contest.standings   the roster, ratings, tags, times, solve counts
 *   contest.status      the same, rebuilt from submissions, when standings are hidden
 *   /gym/<id>           the definitive problem list, likewise
 *
 * Only the last reads markup, and even it just fetches the page and hands it
 * to `scrapers/problems-page.js`.
 */
import { CodeforcesSources } from "../sources.js";
import { codeforcesGyms } from "./descriptor.js";
import { createSiteClient } from "../../../services/site-client.js";
import { ProblemsPage } from "./scrapers/problems-page.js";


/**
 * The second client, for the one page this platform still reads.
 *
 * Separate from `signed` because it is a different site surface with different
 * rules: it needs the session cookie and the page transport, Cloudflare
 * challenges it, and its throttling is tuned against the live HTML rather than
 * the API's published limit.
 *
 * **Do not shorten these delays when optimising.** `measureFrom: "end"` is
 * load-bearing for the same reason: it waits the full gap after each request
 * finishes rather than letting a slow page count towards the next gap.
 * `tests/request-pacer.test.js` fails if that is collapsed.
 */
/** Tuned against the live site; do not shorten when optimising. */
const GAP_MS = [1000, 2500];
const COOLDOWN = { everyNth: 15, gapMs: [6000, 12000] };

const BLOCKED =
  "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.";

const html = createSiteClient({
  // Routed through a Codeforces tab when one is open, so the request carries the
  // session and Cloudflare sees the user rather than a stranger. Falls back to a
  // direct fetch otherwise, which still reads anything public.
  site: codeforcesGyms,
  pacer: {
    gapMs: GAP_MS,
    measureFrom: "end",
    cooldown: COOLDOWN,
    onWait: ({ count, ms, isCooldown }) => {
      const seconds = (ms / 1000).toFixed(2);
      if (isCooldown) {
        // `info`, not `warn`. chrome://extensions collects warnings alongside
        // errors, so a normal add used to file a row there every 15 requests.
        console.info(`[Codeforces] Cooldown threshold reached. Pausing for ${seconds}s…`);
      } else {
        console.log(`[Codeforces] Request ${count}: waiting ${seconds}s`);
      }
    },
  },

  /**
   * Cloudflare answers a challenge two ways, and both must be caught: a 403
   * with no useful body, or a 200 whose body is the interstitial. Measured
   * live — `cf-mitigated: challenge`, a page of scripts pointing at
   * challenges.cloudflare.com — so this is not a heuristic.
   *
   * Flagged rather than thrown bare. `contest-status.js` defines
   * `sourceUnreachable` as exactly this ("we failed to ask — network, 403,
   * anything"), but until the flag existed nothing converted the throw into
   * that status, so a challenge failed the add outright and was never retried.
   */
  refusal({ response, body }) {
    if (response.status !== 403 && !body.includes("Just a moment")) return null;
    return Object.assign(new Error(BLOCKED), { isSourceUnreachable: true });
  },
});

export class GymSources extends CodeforcesSources {
  /**
   * The one page this platform reads, through the HTML client above. A method,
   * so a test injects a page the same way it injects an API answer: by
   * assigning over the instance.
   */
  page(url) {
    return html.getDocument(url);
  }

  /** Standings for a gym, signed. */
  async contestStandings(contestId) {
    try {
      return await this._callMethod("contest.standings", {
        contestId,
        showUnofficial: true,
        participantTypes: "CONTESTANT,VIRTUAL",
      });
    } catch (error) {
      // The one place a message match is unavoidable, converted to a flag here
      // so nothing downstream matches on prose: a setter who hides a gym's
      // standings gets this exact comment and no distinct status code.
      if (/standings are not available/i.test(error.message)) {
        error.isStandingsHidden = true;
      }
      throw error;
    }
  }

  /**
   * Submissions for a contest — the only window into a gym whose standings
   * Codeforces has hidden. `contest.standings` answers FAILED for those;
   * `contest.status` still answers.
   */
  async contestStatus(contestId, { from = 1, count = 10000 } = {}) {
    return this._callMethod("contest.status", { contestId, from, count });
  }

  /**
   * Contest metadata in bulk, for gyms. Private gyms and mashups (the 6xxxxx
   * ids) are absent from this list; those are dated from
   * `standings.contest.startTimeSeconds` at add time instead.
   */
  async contestList() {
    return this._callMethod("contest.list", { gym: true });
  }

      /**
   * Every submission to a contest, paged.
   *
   * @param {GymSources} sources
   * @param {string|number} contestId
   * @returns {Promise<object[]>}
   */
  async contestSubmissions(contestId) {
    const submissions = [];
    let from = 1;

    while (true) {
      const page = await this.contestStatus(contestId, {
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
            `rebuild its standings from.`,
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
   * }}
   */
  static summariseSubmissions(submissions) {
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
    };
  }

    /**
   * A contest's own problems page, scraped: the contest name, whether it has
   * finished, and the definitive problem list — **including problems nobody
   * submitted to**, which is why the list cannot be derived from submissions.
   *
   * @returns {Promise<{contestName: string|null, problems: object[], finished: boolean|null}|null>}
   *   null when the page is not the shape the scraper knows.
   */
  async problemsPage(contestId) {
    const path = `/gym/${contestId}`;
    return ProblemsPage.scrape(await this.page(`https://codeforces.com${path}`), { contestPath: path });
  }

  /** Test seam: both clients, since a gym add may touch either. */
  static reset(spacingMs = 0) {
    html.reset(spacingMs);
    CodeforcesSources.reset(spacingMs);
  }
}

const OFFICIAL_PARTICIPANT_TYPES = new Set(["CONTESTANT", "VIRTUAL"]);

const PAGE_SIZE = 10000;

const MAX_SUBMISSIONS = 50000;


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
