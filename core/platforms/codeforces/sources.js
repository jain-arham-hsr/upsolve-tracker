/**
 * Everything the extension reads from Codeforces: one class, both platforms.
 *
 * The API surface: one method per route — the ones an official round needs,
 * all JSON and one deliberately unsigned; the ones a gym needs, including the
 * one page a hidden-standings gym still has to scrape — and what the account
 * needs, which is what `identity`, `accepted` and `fromSettings` answer for the
 * platforms' defaults. How a request gets there is `client.js`; what a payload
 * means is `payloads.js`.
 *
 * One instance per key pair, not one per platform: `buildSession` builds it
 * from settings, and Settings builds a second to check credentials you have
 * typed but not saved. Both share the signed client, so neither gets a fresh
 * allowance.
 */
import { Source } from "../source.js";
import { withTtlCache } from "../../services/ttl-cache.js";
import { ORIGIN, signed, html, signedUrl } from "./client.js";
import { computeTeamRating } from "../../rating-models/team-rating.js";
import { ProblemsPage } from "./scrapers/problems-page.js";

/**
 * problemset.problems is ~2 MB and an add reads it twice: once to ask whether
 * Codeforces has published the contest, once to apply the ratings it carries.
 * Short-lived on purpose — it is a publication check, and a stale "not
 * published" would strand a contest for the length of the window.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

const USERS_PER_CALL = 250;

export class CodeforcesSources extends Source {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: ORIGIN });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /** The whole account's submissions, in one call. */
  async userStatus(handle) {
    return this._callMethod("user.status", { handle, from: 1, count: 1000 });
  }

  /** @param {string[]} handles */
  async usersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

        /** Issues one signed API call; a FAILED status becomes the comment Codeforces gave. */
  async _callMethod(methodName, params) {
    try {
      const data = await this.json(await signedUrl(this, methodName, params));
      if (data.status !== "OK") {
        throw new Error(data.comment || "Codeforces API Error");
      }
      return data.result;
    } catch (error) {
      console.error(`CF API ${methodName} failed:`, error);
      throw error;
    }
  }

  // ── official rounds ───────────────────────────────────────────────────

  // One slot, not one per instance: the problemset is the same ~2 MB response
  // whoever asks, and Settings builds a second instance to check typed
  // credentials. Not `this.memo`, which is per-instance for that reason.
  static #problemset = withTtlCache(
    (_key, sources) => sources._callMethod("problemset.problems", {}),
    { ttlMs: PROBLEMSET_TTL_MS },
  );

  async contestRatingChanges(contestId) {
    return this._callMethod("contest.ratingChanges", { contestId });
  }

  /**
   * Standings for an **official** contest, fetched without signing.
   *
   * Codeforces answers a non-gym `contest.standings` only for *"anonymous GET
   * requests with no extra parameters"* — and `apiKey` and `time`, which
   * `_callMethod` always appends, are extra parameters. A signed request is
   * refused with that exact complaint whatever the key. The same rule forbids
   * trimming the response: `count`, `from`, `handles`, `showUnofficial` and
   * `participantTypes` are all rejected. A Div. 2 round is ~8.5 MB for seven
   * problem objects; read what is needed and drop the reference.
   *
   * Worth the bytes because `problemset.problems` lists each problem once,
   * under the contest it originated in — a Div. 1 / Div. 2 pair's shared
   * problems are filed under Div. 1 only — while this reports them under
   * *this* contest's indices with the published rating attached. Nothing else
   * exposes the pairing: not the API, not the HTML, and matching on start
   * time or problem name is unsound.
   */
  async publicContestStandings(contestId) {
    const url = `${ORIGIN}/api/contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const data = await this.json(url);

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /**
   * Contest metadata in bulk, ~400 KB. Official rounds by default; gyms are a
   * separate list, and private gyms and mashups (the 6xxxxx ids) are absent
   * from it entirely — those are dated from `standings.contest.startTimeSeconds`
   * at add time instead.
   */
  async contestList({ gym = false } = {}) {
    return this._callMethod("contest.list", gym ? { gym: true } : {});
  }

  /** The entire public problemset, ~2 MB, memoised for a minute. */
  async problemsetProblems() {
    return CodeforcesSources.#problemset("", this);
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    CodeforcesSources.#problemset.clear();
  }

  // ── gyms ──────────────────────────────────────────────────────────────

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
   * Every submission to a contest, paged.
   *
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

  // ── the account ───────────────────────────────────────────────────────

  /**
   * The source a session carries, from a key pair. One instance per key pair,
   * not one per platform: Settings builds a second to check credentials you
   * have typed but not saved, and both share the signed client above.
   *
   * @throws when the extension has not been configured yet.
   */
  static fromSettings(values) {
    if (!values.api_key || !values.api_secret) {
      throw new Error(
        "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
      );
    }
    return new CodeforcesSources(values.api_key, values.api_secret);
  }

  /**
   * What `user.info` says about a handle: its canonical casing and rating, or
   * null when Codeforces does not know it. Codeforces has no "who am I"
   * endpoint, so this verifies that the handle exists, not that it is yours.
   */
  async identity(handle) {
    const users = await this.usersInfo([handle]);
    const user = users?.[0];
    if (!user?.handle) return null;
    return {
      // Codeforces' own casing, so "Tourist" over "tourist" is not a new account.
      username: user.handle,
      rating: typeof user.rating === "number" ? user.rating : null,
    };
  }

  /** The accepted pairs in the whole account's `user.status`, in one call. */
  async accepted(handle) {
    const submissions = await this.userStatus(handle);
    return submissions
      .filter((submission) => submission.verdict === "OK")
      .map((submission) => ({
        contest: { id: submission.problem.contestId },
        problem: { index: submission.problem.index },
      }));
  }

  /**
   * Handles to one effective rating per party — what both platforms' fields
   * end in. Each platform decides *which* parties; everything below the
   * handles is one path, so the two cannot drift: the same `user.info`
   * chunking, the same team collapsing.
   *
   * @param {string[][]} parties - member handles, one array per party
   * @returns {Promise<number[]>} one rating per party, in order
   */
  async partyRatings(parties) {
    const allHandles = [...new Set(parties.flat().filter(Boolean))];

    console.log(`[Codeforces] Found ${allHandles.length} unique handles across ${parties.length} parties.`);
    if (allHandles.length === 0) return [];

    const handleToRating = {};
    for (let i = 0; i < allHandles.length; i += USERS_PER_CALL) {
      try {
        const usersInfo = await this.usersInfo(allHandles.slice(i, i + USERS_PER_CALL));
        usersInfo?.forEach((u) => {
          handleToRating[u.handle] = u.rating ?? 800;
        });
      } catch {
        console.warn(`[Codeforces] Chunk ${Math.floor(i / USERS_PER_CALL) + 1} rejected. Skipping.`);
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

    /** Test seam: both clients and the problemset memo. */
  static reset(spacingMs = 0) {
    CodeforcesSources.#problemset.clear();
    signed.reset(spacingMs);
    html.reset(spacingMs);
  }
}

const PAGE_SIZE = 10000;

const MAX_SUBMISSIONS = 50000;

