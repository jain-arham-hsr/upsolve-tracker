/**
 * A paced fetch: requests queue behind one another with an enforced gap.
 *
 * This is the **only** pacing mechanism in the codebase. It used to be one of
 * two: Codeforces' standings scrape carried its own `HttpClient` with a
 * hard-coded jitter range and a periodic cooldown, and the Codeforces API was
 * paced by nothing at all — three hand-rolled `await delay(2000)` calls stood
 * in for it at the call sites that had noticed. Every knob that client
 * hard-coded is configuration here instead, so a platform states its own
 * numbers and shared code never learns which platforms exist.
 *
 * Each caller makes its own pacer, so budgets are independent by default.
 * `HttpClient`'s request counter was a single static shared by everything,
 * which meant Codeforces traffic could trip a cooldown on an unrelated site's
 * request; per-instance state makes that impossible rather than merely
 * unlikely.
 *
 * ## `budget`, for two clients that are really one site
 *
 * Independence is the right default and the wrong answer in one case: when two
 * modules talk to the **same host**. Codeforces is three platforms —
 * official, gyms and group contests — each with its own API client, and two clients each
 * honouring a 2 s gap serve one request per second to codeforces.com. That is
 * the failure per-instance state was introduced to prevent, arrived at from the
 * other direction.
 *
 * So callers may name a `budget`, and every pacer naming it shares one queue,
 * one marker and one request count. The name is supplied by the caller, so this
 * module still never learns which platforms exist. Callers that name none keep
 * private state, exactly as before.
 *
 * Requests queue through a promise chain rather than each checking the clock.
 * The latter looks equivalent but lets concurrent callers all read the same
 * timestamp, wait the same interval and then fire together — the exact burst
 * the pacing exists to prevent. `HttpClient` had a variant of that flaw: it
 * slept a random interval per call with no queue, so two concurrent callers
 * slept in parallel and then fired together. It was latent rather than live,
 * since every scrape call site is a sequential `await`.
 *
 * ## `measureFrom` is not symmetry, it is a real difference
 *
 *   - **`"start"`** waits until `previousStart + gap`, so a slow request eats
 *     into the next gap. Cheap sites where the gap is an etiquette floor.
 *   - **`"end"`** waits the full gap *after the previous request finished*,
 *     and waits it before the first request too. This is what `HttpClient`
 *     did.
 *
 * They diverge exactly when a request takes longer than the gap. Collapsing
 * them onto `"start"` would silently make the Codeforces scrape faster, and
 * those delays are what keeps the extension from being blocked — so the
 * distinction has to be stated rather than inherited.
 *
 * @param {object} options
 * @param {number|[number, number]} options.gapMs - fixed, or `[min, max]` for
 *   a jittered gap drawn per request.
 * @param {"start"|"end"} [options.measureFrom]
 * @param {{everyNth: number, gapMs: number|[number, number]}} [options.cooldown]
 *   A longer pause every Nth request, *replacing* that request's normal gap.
 * @param {"omit"|"include"|"same-origin"} [options.credentials]
 * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl]
 *   How the request is actually issued. Defaults to the global `fetch`.
 *
 *   This exists because a `fetch` from the extension's own origin is
 *   **cross-site**, so Chrome withholds cookies whose `SameSite` is unset — the
 *   default — and `credentials: "include"` does not override it. Measured: the
 *   panel's request to Codeforces arrives unauthenticated and is challenged,
 *   while the identical request issued from inside a page on that site carries
 *   the session and succeeds. Swapping the issuer is therefore the difference
 *   between reading a private gym and not.
 *
 *   It is a parameter *here*, rather than a wrapper around `paced`, because the
 *   pacing must apply either way. Wrapping would either skip the delay or
 *   double it, and these delays are what keep the extension from being blocked.
 * @param {(info: {count: number, ms: number, isCooldown: boolean}) => void} [options.onWait]
 *   Called with the chosen delay before it is served. Only the Codeforces
 *   scrape passes one; adding logging here unconditionally would put new
 *   console output on platforms that have never emitted any.
 * @param {string} [options.budget] - share one queue with every other pacer
 *   naming it. For two clients addressing one host; see above.
 */

/** Shared queues, by name. A pacer with no `budget` never appears here. */
const BUDGETS = new Map();

export function createPacer({
  gapMs,
  measureFrom = "start",
  cooldown = null,
  credentials = "omit",
  fetchImpl = null,
  onWait = null,
  budget = null,
}) {
  // `"end"` waits before the very first request; `"start"` does not. Both
  // reproduce what their callers did before this module absorbed them.
  const initialMarker = measureFrom === "end" ? null : 0;

  const fresh = () => ({ marker: initialMarker, count: 0, chain: Promise.resolve(), fixedGap: null });

  // The state, not the pacer, is what a budget shares — so two clients can keep
  // their own gaps, cooldowns and transports while queueing as one.
  if (budget && !BUDGETS.has(budget)) BUDGETS.set(budget, fresh());
  const state = budget ? BUDGETS.get(budget) : fresh();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const draw = (spec) =>
    Array.isArray(spec) ? spec[0] + Math.random() * (spec[1] - spec[0]) : spec;

  const nextDelay = () => {
    state.count++;
    if (state.fixedGap != null) return { ms: state.fixedGap, isCooldown: false };

    const isCooldown = Boolean(cooldown) && state.count % cooldown.everyNth === 0;
    return { ms: draw(isCooldown ? cooldown.gapMs : gapMs), isCooldown };
  };

  const paced = (url, init = {}) => {
    const result = state.chain.then(async () => {
      const { ms, isCooldown } = nextDelay();

      // `marker === null` only on the first request under `"end"`, where the
      // full gap is owed with nothing to measure against.
      const wait = state.marker === null ? ms : state.marker + ms - Date.now();

      if (wait > 0) {
        onWait?.({ count: state.count, ms: wait, isCooldown });
        await sleep(wait);
      }

      if (measureFrom === "start") state.marker = Date.now();
      try {
        const issue = fetchImpl ?? fetch;
        return await issue(url, { credentials, ...init });
      } finally {
        if (measureFrom === "end") state.marker = Date.now();
      }
    });

    // Keep the chain alive on failure, or one error stalls everything behind it.
    state.chain = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  /**
   * Test seam. Pins every gap, cooldowns included, so a suite does not spend
   * real seconds observing an etiquette rule it is not exercising.
   */
  paced.setSpacing = (ms) => {
    state.fixedGap = ms;
  };

  paced.reset = () => {
    state.marker = initialMarker;
    state.count = 0;
    state.chain = Promise.resolve();
  };

  return paced;
}
