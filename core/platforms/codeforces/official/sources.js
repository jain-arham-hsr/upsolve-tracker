/**
 * Everything the official platform reads from Codeforces, beyond what
 * `codeforces/sources.js` already covers.
 *
 * An official add is pure signed JSON API, which is why this folder has no
 * `scrapers/`: nothing here reads markup. Endpoints: `contest.ratingChanges`,
 * `problemset.problems`, `contest.list`, and the deliberately unsigned
 * `contest.standings`.
 */
import { CodeforcesSources } from "../sources.js";
import { withTtlCache } from "../../../services/ttl-cache.js";

/**
 * problemset.problems is ~2 MB and an add reads it twice: once to ask whether
 * Codeforces has published the contest, once to apply the ratings it carries.
 * Short-lived on purpose — it is a publication check, and a stale "not
 * published" would strand a contest for the length of the window.
 */
const PROBLEMSET_TTL_MS = 60 * 1000;

export class OfficialSources extends CodeforcesSources {
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
    const url = `${this.baseUrl}contest.standings?contestId=${encodeURIComponent(contestId)}`;
    const data = await this.json(url);

    if (data.status !== "OK") {
      throw new Error(data.comment || "Codeforces API Error");
    }
    return data.result;
  }

  /** Contest metadata in bulk, ~400 KB. Official rounds only. */
  async contestList() {
    return this._callMethod("contest.list", {});
  }

  /** The entire public problemset, ~2 MB, memoised for a minute. */
  async problemsetProblems() {
    return OfficialSources.#problemset("", this);
  }

  /** Test seam, and the way a retry gets a genuinely fresh read. */
  static clearProblemsetCache() {
    OfficialSources.#problemset.clear();
  }

      /** Test seam: the problemset memo and the shared client. */
  static reset(spacingMs = 0) {
    OfficialSources.#problemset.clear();
    CodeforcesSources.reset(spacingMs);
  }
}
