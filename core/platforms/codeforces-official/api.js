/**
 * The Codeforces API client, official half.
 *
 * ## Two copies of this file, deliberately
 *
 * `codeforces-official/` and `codeforces-gyms/` are separate platforms with no
 * shared folder between them, so each carries its own client — trimmed to the
 * endpoints it actually calls, which is why neither is the whole of what they
 * were split from. Here: `user.status`, `user.info`, `contest.list`,
 * `contest.ratingChanges`, `problemset.problems`, and the deliberately
 * unsigned `getPublicContestStandings`.
 *
 * What they genuinely share is `_callMethod` and its SHA-512 signing, and that
 * is the one duplication here with a real failure mode: a fix applied to one
 * file only. `tests/codeforces-api.test.js` pins the two against each other for
 * exactly that reason.
 *
 * They must **not** get separate request budgets, which is what
 * `budget: "codeforces-api"` below prevents — two clients each honouring a 2 s
 * gap would serve one request per second to codeforces.com.
 */
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
// `budget` rather than a bare pacer, because Codeforces is two platforms —
// official and gyms — each of which gets its own copy of this client. Two
// clients each honouring a 2 s gap would serve one request per second to
// codeforces.com; naming a shared budget makes them queue as one.
const paced = createPacer({ gapMs: 2000, budget: "codeforces-api" });

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
   * Standings for an **official** contest, fetched without signing.
   *
   * ## Why this cannot go through `_callMethod`
   *
   * Codeforces answers a non-gym `contest.standings` only for *"anonymous GET
   * requests with no extra parameters"* — and `apiKey` and `time`, which
   * `_callMethod` always appends, are extra parameters. A signed request is
   * refused with that exact complaint, independently of whether the key is
   * valid. So this is a bare GET on purpose, not an oversight; signing it would
   * break it.
   *
   * The same rule forbids trimming the response: `count`, `from`, `handles`,
   * `showUnofficial` and `participantTypes` are all rejected, verified across
   * five contests. A Div. 2 round is ~8.5 MB, and there is no smaller shape —
   * we want seven problem objects and must accept eleven thousand rows to get
   * them. **Read what is needed and drop the reference**; this must not be
   * retained.
   *
   * ## Why it is worth the bytes
   *
   * `problemset.problems` lists each problem once, under the contest it
   * originated in. A Div. 1 / Div. 2 pair shares problems, and the shared ones
   * are filed under Div. 1 only — so Round 1079's Div. 2 (2197) lists just A
   * and B, while C–F live under 2196 with Div. 1 indices. Looking them up by
   * `contestId-index` finds nothing and the estimator then rates problems
   * Codeforces has already rated, storing numbers up to 100 off.
   *
   * Nothing exposes that pairing: not the API — the contest and problem objects
   * carry no such field — and not the HTML, where the contest page, the problem
   * statement and the standings page never mention the twin's id. Matching on
   * start time is unsound (13% of same-start groups are unrelated contests, such
   * as ICPC problem sets), and matching on problem name is unsound too (contest
   * 100 also has a "Friendly Numbers").
   *
   * This response sidesteps all of it: asked about 2197 it returns that
   * contest's own indices with the correct published ratings attached, because
   * a rating belongs to the problem rather than to the contest. No inference.
   */
  async getPublicContestStandings(contestId) {
    const url = `${this.baseUrl}contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const response = await paced(url);
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /**
   * Contest metadata (including startTimeSeconds) in bulk, ~400 KB.
   *
   * Official rounds only — the gym list is a separate call, and lives in the
   * sibling platform's client. The `gym` parameter this used to take is gone
   * with the branch that chose it.
   */
  async getContestList() {
    return this._callMethod("contest.list", {});
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
