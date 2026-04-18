export class HttpClient {
  static #requestCount = 0;
  static #COOLDOWN_THRESHOLD = 15; // Trigger a long pause every 15 requests

  // Standard Jitter: 1000ms to 2500ms
  static #STANDARD_DELAY_MIN = 1000;
  static #STANDARD_DELAY_MAX = 2500;

  // Cooldown Jitter: 6000ms to 12000ms (6 to 12 seconds)
  static #COOLDOWN_DELAY_MIN = 6000;
  static #COOLDOWN_DELAY_MAX = 12000;

  /**
   * Performs a GET request with enforced pre-flight jitter
   * and periodic long cooldowns to mimic human behavior.
   * * @param {string} url - The URL to fetch.
   * @param {Object} options - Optional fetch configuration.
   * @returns {Promise<string>} The response text.
   */
  static async get(url, options = {}) {
    this.#requestCount++;

    if (this.#requestCount % this.#COOLDOWN_THRESHOLD === 0) {
      await this.#cooldownDelay();
    } else {
      await this.#jitteredDelay();
    }

    // Pass credentials: 'include' on every fetch call so session cookies are sent
    const fetchOptions = {
      ...options,
      credentials: "include",
    };

    const response = await fetch(url, fetchOptions);

    // Detect challenge pages - HTTP 403
    if (response.status === 403) {
      throw new Error(
        "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.",
      );
    }

    const text = await response.text();

    // Detect challenge pages - "Just a moment"
    if (text.includes("Just a moment")) {
      throw new Error(
        "Codeforces is blocking requests. Please visit codeforces.com in your browser and try again.",
      );
    }

    return text;
  }

  /**
   * Applies the standard randomized delay.
   */
  static async #jitteredDelay() {
    const range = this.#STANDARD_DELAY_MAX - this.#STANDARD_DELAY_MIN;
    const delay = this.#STANDARD_DELAY_MIN + Math.random() * range;
    console.log(
      `[HttpClient] Request ${this.#requestCount}: Waiting ${(delay / 1000).toFixed(2)}s`,
    );
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Applies a significantly longer delay to simulate reading or stepping away.
   */
  static async #cooldownDelay() {
    const range = this.#COOLDOWN_DELAY_MAX - this.#COOLDOWN_DELAY_MIN;
    const delay = this.#COOLDOWN_DELAY_MIN + Math.random() * range;
    console.warn(
      `[HttpClient] Cooldown threshold reached. Pausing for ${(delay / 1000).toFixed(2)}s...`,
    );
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
