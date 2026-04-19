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
      const response = await fetch(finalUrl);
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
