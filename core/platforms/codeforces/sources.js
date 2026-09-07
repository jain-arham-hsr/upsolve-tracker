/**
 * The signed Codeforces API — what both Codeforces platforms read through.
 *
 * `CodeforcesSources` holds the key pair, signs each call (SHA-512 over
 * `rand/method?sortedParams#secret`) and reads the methods both platforms use.
 * Each platform's own `sources.js` extends it with the methods only it calls,
 * so a signing fix lands in one place and `tests/codeforces-api.test.js` pins
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
const signed = createSiteClient({
  fetchImpl: (...args) => fetch(...args),
  pacer: { gapMs: 2000, budget: "codeforces-api", credentials: "omit" },
  refusal: () => null,
});

export class CodeforcesSources extends Source {
  constructor(apiKey, apiSecret) {
    super({ client: signed, origin: "https://codeforces.com" });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = "https://codeforces.com/api/";
  }

  /** The whole account's submissions, in one call. */
  async getUserStatus(handle) {
    return this._callMethod("user.status", { handle, from: 1, count: 1000 });
  }

  /** @param {string[]} handles */
  async getUsersInfo(handles) {
    return this._callMethod("user.info", { handles: handles.join(";") });
  }

  /**
   * Test seam for the shared client. Takes a spacing because proving the API
   * is paced needs an observable gap.
   */
  static reset(spacingMs = 0) {
    signed.reset(spacingMs);
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
