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

import { createPacer } from "../../services/request-pacer.js";

const BASE = "https://kenkoooo.com/atcoder";
const RESOURCE_TTL_MS = 15 * 60 * 1000;
const MIN_GAP_MS = 1100;

/** The v3 submissions endpoint returns at most this many rows per call. */
const PAGE_SIZE = 500;

/** Backstop against a pagination bug turning into an unbounded loop. */
const MAX_PAGES = 200;

const cache = new Map();

// Its own pacer, so AtCoder's budget is independent of the other platforms'.
const paced = createPacer({ minGapMs: MIN_GAP_MS, credentials: "omit" });

/**
 * Fetches a static resource, revalidating with its ETag once the cached copy
 * is stale. A 304 keeps the parsed body and resets the clock.
 *
 * `revalidate` skips the TTL check without skipping the ETag, and exists for
 * one caller: retrying a contest that was not indexed yet. Serving that retry
 * from a copy read minutes ago would fail on the same stale array and look
 * like the check happened, so the wait could never end inside the TTL. A
 * revalidation that finds no change costs a 304, not another 3 MB.
 */
async function getResource(path, { revalidate = false } = {}) {
  const url = `${BASE}/resources/${path}`;
  const entry = cache.get(url);

  if (!revalidate && entry && Date.now() - entry.fetchedAt < RESOURCE_TTL_MS) {
    return entry.body;
  }

  const headers = entry?.etag ? { "If-None-Match": entry.etag } : {};
  const response = await paced(url, { headers });

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
export async function getResources(options = {}) {
  const [problems, contests, contestProblems, models] = await Promise.all([
    getResource("problems.json", options),
    getResource("contests.json", options),
    getResource("contest-problem.json", options),
    getResource("problem-models.json", options),
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

    const response = await paced(url);
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
  paced.reset();
}

/**
 * Test seam. Production always uses MIN_GAP_MS; tests set 0 so the suite does
 * not spend real seconds observing an etiquette rule it isn't exercising.
 */
export function setRequestSpacing(ms) {
  paced.setSpacing(ms);
}
