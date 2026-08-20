/**
 * Client for the AtCoder Problems API (kenkoooo).
 *
 * AtCoder publishes no API of its own, and its standings JSON needs a login
 * cookie, so this community service is the data source for everything: problem
 * lists, difficulty, contest dates and solved history.
 *
 * Three constraints shape this file:
 *
 *  - **Etiquette, not rate limits.** The published guidance is "sleep for more
 *    than 1 second between accesses" with no numeric limit, so requests are
 *    spaced rather than bucketed.
 *  - **The resources are large** — contest-problem.json alone is ~3 MB parsed,
 *    and all four together are ~5 MB. That is why they are cached in memory
 *    for the session rather than in chrome.storage.local, whose default quota
 *    is 10 MB and which the queue itself needs.
 *  - **Endpoints get retired.** The documented `atcoder-api/results?user=`
 *    returns 404 today; the v3 route replaced it. Failures must be loud at add
 *    time rather than silently producing an empty contest.
 */

const BASE = "https://kenkoooo.com/atcoder";
const RESOURCE_TTL_MS = 15 * 60 * 1000;
const MIN_GAP_MS = 1100;

/** The v3 submissions endpoint returns at most this many rows per call. */
const PAGE_SIZE = 500;

/** Backstop against a pagination bug turning into an unbounded loop. */
const MAX_PAGES = 200;

let lastRequestAt = 0;
let minGapMs = MIN_GAP_MS;
const cache = new Map();

/**
 * Requests queue behind one another rather than each checking the clock.
 * Reading `lastRequestAt` at call time looks equivalent but isn't: four
 * concurrent calls would all see the same value, all wait the same amount and
 * then fire together, which is precisely the burst the spacing exists to
 * avoid.
 */
let chain = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function spacedFetch(url, init = {}) {
  const result = chain.then(async () => {
    const wait = lastRequestAt + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    // No credentials: this is a third-party service and has no business
    // receiving any cookie of the user's.
    return fetch(url, { ...init, credentials: "omit" });
  });

  // Keep the chain alive even when a request fails, or one error would stall
  // every later request behind it.
  chain = result.then(
    () => {},
    () => {},
  );
  return result;
}

/**
 * Fetches a static resource, revalidating with its ETag once the cached copy
 * is stale. A 304 keeps the parsed body and resets the clock.
 */
async function getResource(path) {
  const url = `${BASE}/resources/${path}`;
  const entry = cache.get(url);

  if (entry && Date.now() - entry.fetchedAt < RESOURCE_TTL_MS) {
    return entry.body;
  }

  const headers = entry?.etag ? { "If-None-Match": entry.etag } : {};
  const response = await spacedFetch(url, { headers });

  if (response.status === 304 && entry) {
    entry.fetchedAt = Date.now();
    return entry.body;
  }

  if (!response.ok) {
    throw new Error(
      `AtCoder Problems returned ${response.status} for ${path}. The service may be down, ` +
        `or the endpoint may have been retired.`,
    );
  }

  const body = await response.json();
  cache.set(url, {
    body,
    etag: response.headers.get("ETag"),
    fetchedAt: Date.now(),
  });
  return body;
}

/**
 * Everything needed to describe a contest.
 *
 * `contest-problem.json` is not optional: a problem can belong to several
 * contests — 1,906 of 9,383 do — and `problems.json` only records the one it
 * debuted in. Reading the latter alone under-reports a rerun contest badly
 * (one daily-training round lists 4 problems instead of 9).
 */
export async function getResources() {
  const [problems, contests, contestProblems, models] = await Promise.all([
    getResource("problems.json"),
    getResource("contests.json"),
    getResource("contest-problem.json"),
    getResource("problem-models.json"),
  ]);
  return { problems, contests, contestProblems, models };
}

/**
 * Task ids the user has an accepted submission for.
 *
 * Pages by advancing `from_second`. Two hazards, both silent: stopping early
 * leaves solved problems sitting in the queue forever, and advancing past a
 * timestamp skips every submission sharing that second. So the cursor moves to
 * the newest timestamp seen — not past it — and the loop ends when a page
 * brings nothing new, with ids deduplicated across the overlap.
 */
export async function getAcceptedProblemIds(handle) {
  const accepted = new Set();
  const seenIds = new Set();
  let fromSecond = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${BASE}/atcoder-api/v3/user/submissions` +
      `?user=${encodeURIComponent(handle)}&from_second=${fromSecond}`;

    const response = await spacedFetch(url);
    if (!response.ok) {
      throw new Error(
        `AtCoder Problems returned ${response.status} for your submissions. ` +
          `Check the handle in Settings.`,
      );
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    let fresh = 0;
    let newest = fromSecond;

    for (const row of rows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        fresh++;
        if (row.result === "AC") accepted.add(row.problem_id);
      }
      if (row.epoch_second > newest) newest = row.epoch_second;
    }

    // A short page is the last page.
    if (rows.length < PAGE_SIZE) break;
    // No new ids means the cursor cannot advance — stop rather than spin.
    if (fresh === 0) break;

    fromSecond = newest;
  }

  return accepted;
}

/** Test seam: drops the in-memory resource cache and resets pacing. */
export function clearResourceCache() {
  cache.clear();
  lastRequestAt = 0;
  chain = Promise.resolve();
}

/**
 * Test seam. Production always uses MIN_GAP_MS; tests set 0 so the suite does
 * not spend real seconds observing an etiquette rule it isn't exercising.
 */
export function setRequestSpacing(ms) {
  minGapMs = ms;
}
