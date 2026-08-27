import { createPacer } from "../../services/request-pacer.js";

/**
 * problemset.problems is ~2MB and an add now reads it twice: once to ask
 * whether Codeforces has published the contest, once to apply the ratings it
 * carries. Without a cache that doubles the cost of every official add.
 * Short-lived on purpose — it is a publication check, and a stale "not
 * published" would strand a contest for the length of the TTL.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

/**
 * The signed API used to be paced by nothing at all.
 *
 * Its calls happened to be spaced out in practice, because the throttled
 * standings scrape usually ran between them — so an add never looked bursty
 * even though nothing was enforcing it. The places where no scrape sat in
 * between had each grown their own `await delay(2000)`: two in
 * rating-distribution.js, one in start-times.js. Three local patches for one
 * missing rule is what a missing rule looks like.
 *
 * Module-level, so every CodeforcesService shares one budget. Settings builds a
 * second instance through `createSessionFrom` to check credentials you have
 * typed but not saved, and that must not come with a fresh allowance.
 */
const paced = createPacer({ gapMs: 2000 });

export class CodeforcesService {
  static #problemsetCache = null;

  /**
   * @param {string} apiKey - Your CF API Key
   * @param {string} apiSecret - Your CF API Secret
   */
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = "https://codeforces.com/api/";
  }

  /**
   * Fetches the user.status (submissions) for a specific handle.
   * @param {string} handle - The CF user handle
   */
  async getUserStatus(handle) {
    const params = {
      handle: handle,
      from: 1,
      count: 1000, // You can adjust this as needed
    };

    return this._callMethod("user.status", params);
  }

  /**
   * Fetches rating changes for a specific contest.
   * @param {string|number} contestId
   */
  async getContestRatingChanges(contestId) {
    return this._callMethod("contest.ratingChanges", { contestId: contestId });
  }

  /**
   * Fetches standings for a contest to extract contestant handles.
   * @param {string|number} contestId
   */
  async getContestStandings(contestId) {
    return this._callMethod("contest.standings", {
      contestId: contestId,
      showUnofficial: true,
      participantTypes: "CONTESTANT,VIRTUAL",
    });
  }

  /**
   * Fetches submissions for a contest.
   *
   * This is the only window into a gym whose standings Codeforces has hidden:
   * contest.standings answers FAILED for those, but contest.status still
   * answers. See platforms/codeforces/contest-submissions.js.
   *
   * @param {string|number} contestId
   * @param {{from?: number, count?: number}} [page]
   */
  async getContestStatus(contestId, { from = 1, count = 10000 } = {}) {
    return this._callMethod("contest.status", {
      contestId: contestId,
      from: from,
      count: count,
    });
  }

  /**
   * Fetches contest metadata (including startTimeSeconds) in bulk.
   * @param {boolean} gym - Gym contests are a separate list from official ones.
   */
  async getContestList(gym = false) {
    return this._callMethod("contest.list", gym ? { gym: true } : {});
  }

  /**
   * Fetches the entire public problemset, which is the only bulk source of
   * problem tags. Roughly 2MB covering every official contest — cheaper than
   * contest.standings, whose response embeds every participant row (~12MB for
   * a single Div. 3).
   */
  async getProblemsetProblems() {
    const cached = CodeforcesService.#problemsetCache;
    if (cached && Date.now() - cached.at < PROBLEMSET_TTL_MS) return cached.body;

    const body = await this._callMethod("problemset.problems", {});
    CodeforcesService.#problemsetCache = { body, at: Date.now() };
    return body;
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    CodeforcesService.#problemsetCache = null;
  }

  /**
   * Fetches user info for an array of handles.
   * @param {string[]} handles
   */
  async getUsersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

  /**
   * Private helper to handle signing and fetching
   */
  async _callMethod(methodName, params) {
    const time = Math.floor(Date.now() / 1000);
    const rand = Math.floor(100000 + Math.random() * 900000).toString();

    // 1. Add authentication parameters
    const authParams = {
      ...params,
      apiKey: this.apiKey,
      time: time,
    };

    // 2. Sort parameters alphabetically by key
    const sortedKeys = Object.keys(authParams).sort();
    const queryParts = sortedKeys.map((key) => `${key}=${authParams[key]}`);
    const queryString = queryParts.join("&");

    // 3. Construct the string to hash: rand/methodName?params#secret
    const textToHash = `${rand}/${methodName}?${queryString}#${this.apiSecret}`;

    // 4. Generate SHA-512 Hash
    const hashHex = await this._sha512(textToHash);

    // 5. Build final apiSig: rand + hash
    const apiSig = `${rand}${hashHex}`;

    // 6. Execute Request
    const finalUrl = `${this.baseUrl}${methodName}?${queryString}&apiSig=${apiSig}`;

    try {
      const response = await paced(finalUrl);
      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error(data.comment || "Codeforces API Error");
      }

      return data.result;
    } catch (error) {
      console.error(`CF API ${methodName} failed:`, error);
      throw error;
    }
  }

  /**
   * Native Browser SHA-512 implementation
   */
  async _sha512(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

/**
 * Test seam. Takes a spacing for the same reason `codeforces/http.js` does:
 * proving the signed API is paced needs an observable gap, and it was paced by
 * nothing at all until recently, so that is worth an assertion of its own.
 */
export function resetApiState(spacingMs = 0) {
  CodeforcesService.clearProblemsetCache();
  paced.reset();
  paced.setSpacing(spacingMs);
}
