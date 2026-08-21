/**
 * A paced fetch: requests queue behind one another with a minimum gap.
 *
 * Each platform makes its own, so their budgets are independent. HttpClient's
 * counter is a single static shared by everything, which meant Codeforces
 * traffic could trigger a cooldown on an unrelated site's request.
 *
 * Requests queue through a promise chain rather than each checking the clock.
 * The latter looks equivalent but lets concurrent callers all read the same
 * timestamp, wait the same interval and then fire together — the exact burst
 * the pacing exists to prevent.
 */
export function createPacer({ minGapMs, credentials = "omit" }) {
  let lastRequestAt = 0;
  let gap = minGapMs;
  let chain = Promise.resolve();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const paced = (url, init = {}) => {
    const result = chain.then(async () => {
      const wait = lastRequestAt + gap - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      return fetch(url, { credentials, ...init });
    });

    // Keep the chain alive on failure, or one error stalls everything behind it.
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  /** Test seam. Production keeps the configured gap. */
  paced.setSpacing = (ms) => {
    gap = ms;
  };

  paced.reset = () => {
    lastRequestAt = 0;
    chain = Promise.resolve();
  };

  return paced;
}
