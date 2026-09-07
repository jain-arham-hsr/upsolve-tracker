/**
 * The signed Codeforces API — what both Codeforces platforms read through.
 *
 * `CodeforcesSources` holds the key pair, signs each call (SHA-512 over
 * `rand/method?sortedParams#secret`) and reads the methods both platforms use.
 * Each platform's own `sources.js` extends it with the methods only it calls,
 * so a signing fix lands in one place and `tests/platforms/codeforces/sources.test.js` pins
 * the string that is hashed.
 *
 * One instance per key pair, not one per platform: `identity` builds it from
 * settings, and Settings builds a second to check credentials you have typed
 * but not saved. Both share the client below, so neither gets a fresh
 * allowance.
 */
import { Source } from "../source.js";
import { createSiteClient } from "../../services/site-client.js";

/**
 * The one client for every signed call, on both platforms.
 *
 * Through `services/site-client.js` like every other platform, with two
 * deliberate parameters: a direct `fetchImpl`, since the API works anonymously
 * and is never challenged, so routing it through a tab would add a dependency
 * it does not need; and `refusal: () => null`, since this API does not refuse
 * at the transport — a bad key comes back as a 200 with `status: "FAILED"`,
 * which `_callMethod` reads.
 *
 * `budget` rather than a bare pacer: two platforms each honouring a 2 s gap
 * would serve one request per second to codeforces.com. Naming a shared budget
 * makes every client on this host queue as one.
 */
const ORIGIN = "https://codeforces.com";

/** The API publishes a rate limit; two seconds keeps every add inside it. */
const GAP_MS = 2000;

const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: GAP_MS, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

export class CodeforcesSources extends Source {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: ORIGIN });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = `${ORIGIN}/api/`;
  }

  /** The whole account's submissions, in one call. */
  async userStatus(handle) {
    return this._callMethod("user.status", { handle, from: 1, count: 1000 });
  }

  /** @param {string[]} handles */
  async usersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

  /**
   * Test seam for the shared client. Takes a spacing because proving the API
   * is paced needs an observable gap.
   */
  static reset(spacingMs = 0) {
    signed.reset(spacingMs);
  }

  /**
   * Applies the tags and the rating Codeforces attaches to a contest's
   * problems, off a `contest.standings` response.
   *
   * On an official round this is the only source that reports a shared
   * Div. 1 / Div. 2 problem's rating under this contest's own index; on a gym
   * about a third of problems carry a rating inherited from the archive.
   *
   * @returns {boolean} whether the API answered with problems at all, which
   *   is what `publishedDataCheckedAt` records.
   */
  static applyStandingsProblemData(standings, problems) {
    const apiProblems = standings?.problems;
    if (!apiProblems?.length) return false;

    const byIndex = new Map(
      apiProblems.map((problem) => [problem.index, problem]),
    );
    problems.forEach((problem) => {
      const published = byIndex.get(problem.index);
      problem.tags = published?.tags ?? [];

      if (typeof published?.rating === "number") {
        problem.rating = published.rating;
        problem.ratingSource = "official";
      }
    });

    return true;
  }

  /** In-contest solves per problem, from the rows, ghosts excluded. */
  static populateSolveCounts(standings, problems) {
    if (!standings?.rows?.length) return;

    const validRows = standings.rows.filter((row) => !row.party.ghost);
    const solveCountMap = {};

    validRows.forEach((row) => {
      row.problemResults.forEach((result, i) => {
        const index = problems[i]?.index;
        if (!index) return;
        if (result.bestSubmissionTimeSeconds != null) {
          solveCountMap[index] = (solveCountMap[index] ?? 0) + 1;
        }
      });
    });

    problems.forEach((problem) => {
      problem.officialSolves = solveCountMap[problem.index] ?? 0;
    });
  }

  /** Signs and issues one API call; a FAILED status becomes the comment Codeforces gave. */
  async _callMethod(methodName, params) {
    const time = Math.floor(Date.now() / 1000);
    const rand = Math.floor(100000 + Math.random() * 900000).toString();

    const authParams = { ...params, apiKey: this.apiKey, time };
    const queryString = Object.keys(authParams)
      .sort()
      .map((key) => `${key}=${authParams[key]}`)
      .join("&");

    // rand/methodName?sortedParams#secret — the secret signs the request and
    // never travels with it.
    const hashHex = await this._sha512(`${rand}/${methodName}?${queryString}#${this.apiSecret}`);
    const apiSig = `${rand}${hashHex}`;

    const finalUrl = `${this.baseUrl}${methodName}?${queryString}&apiSig=${apiSig}`;

    try {
      const data = await this.json(finalUrl);
      if (data.status !== "OK") {
        throw new Error(data.comment || "Codeforces API Error");
      }
      return data.result;
    } catch (error) {
      console.error(`CF API ${methodName} failed:`, error);
      throw error;
    }
  }

  async _sha512(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
