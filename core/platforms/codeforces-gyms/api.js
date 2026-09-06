/**
 * The Codeforces API client, gym half.
 *
 * ## Two copies of this file, deliberately
 *
 * `codeforces-official/` and `codeforces-gyms/` are separate platforms with no
 * shared folder between them, so each carries its own client — trimmed to the
 * endpoints it actually calls, which is why neither is the whole of what they
 * were split from. Here: `user.status`, `user.info`, `contest.list?gym=true`,
 * the signed `contest.standings`, and `contest.status` for a gym whose
 * standings Codeforces has hidden.
 *
 * What they genuinely share is `_callMethod` and its SHA-512 signing, and that
 * is the one duplication here with a real failure mode: a fix applied to one
 * file only. `tests/codeforces-signing.test.js` pins the two against each other
 * for exactly that reason.
 *
 * They must **not** get separate request budgets, which is what
 * `budget: "codeforces-api"` below prevents — two clients each honouring a 2 s
 * gap would serve one request per second to codeforces.com.
 */
import { createPacer } from "../../services/request-pacer.js";

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
// `budget` rather than a bare pacer, because Codeforces is two platforms —
// official and gyms — each of which gets its own copy of this client. Two
// clients each honouring a 2 s gap would serve one request per second to
// codeforces.com; naming a shared budget makes them queue as one.
const paced = createPacer({ gapMs: 2000, budget: "codeforces-api" });

export class CodeforcesService {
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
   * Fetches standings for a contest to extract contestant handles.
   * @param {string|number} contestId
   */
  async getContestStandings(contestId) {
    try {
      return await this._callMethod("contest.standings", {
        contestId: contestId,
        showUnofficial: true,
        participantTypes: "CONTESTANT,VIRTUAL",
      });
    } catch (error) {
      // **The one place a message match is unavoidable**, and it is converted to
      // a flag here so that nothing downstream ever matches on prose. A setter
      // who hides a gym's standings gets this exact comment and no distinct
      // status code, so Codeforces' wording is the only signal there is.
      //
      // `solve-stats.js` reads the flag to rebuild the contest from
      // `contest.status` instead. That used to be triggered by the standings
      // *page* failing to parse, which meant such a gym fetched and parsed
      // HTML purely to discover the fetch was pointless.
      if (/standings are not available/i.test(error.message)) {
        error.isStandingsHidden = true;
      }
      throw error;
    }
  }

  /**
   * Fetches submissions for a contest.
   *
   * This is the only window into a gym whose standings Codeforces has hidden:
   * contest.standings answers FAILED for those, but contest.status still
   * answers. See contest-submissions.js.
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
   * Contest metadata (including startTimeSeconds) in bulk, for gyms.
   *
   * Note private gyms and mashups (the 6xxxxx ids) are absent from this list
   * entirely; those are dated from `standings.contest.startTimeSeconds` at add
   * time instead.
   */
  async getContestList() {
    return this._callMethod("contest.list", { gym: true });
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
  paced.reset();
  paced.setSpacing(spacingMs);
}
