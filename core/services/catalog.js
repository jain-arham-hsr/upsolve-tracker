/**
 * The shared catalog: one document per contest, with every problem's rating,
 * readable by anyone signed in and written only by the owner.
 *
 * Adding a contest is the expensive part of this extension — tens of paced
 * requests and an estimator run. The catalog lets that happen once, on the
 * owner's machine, and every other install read the result. **Nothing a
 * non-owner computes reaches it**: anyone can modify their copy, so the rules
 * refuse every catalog write from any account but the one `config/owner`
 * names, and a non-owner's install never computes a rating to offer anyway.
 *
 * A catalog record is the stored contest record minus anything about the
 * user: no `solved` flag, no `addedAt`. A problem the catalog has not rated
 * yet is stored locally with `ratingSource: "pending"` and renders "…" —
 * deliberately not "???", which means one thing only: the site says unrated.
 */
import { contestKey, platformOf } from "../platforms/registry.js";
import { firebaseFrom } from "./account.js";
import { CLOUD_KEY_PREFIX, decodeDoc, encodeDoc, fingerprint } from "./firebase.js";

/** `ratingSource` of a problem whose rating has to come from the catalog. */
export const PENDING_RATING = "pending";

/** What the owner last published, by contest key — so a refresh rewrites only what changed. */
const PUBLISHED_KEY = `${CLOUD_KEY_PREFIX}published`;

const docPath = (key) => `catalog/${key}`;

/** The shared part of a stored contest: everything except what belongs to one user. */
export function catalogRecord(contest) {
  const { addedAt: _addedAt, ...shared } = contest;
  return {
    ...shared,
    problems: contest.problems.map(({ solved: _solved, ...problem }) => problem),
  };
}

/**
 * Strips every rating from a freshly fetched contest. A non-owner's install
 * shows only what the catalog says, including ratings the site itself
 * published, so the queue reads one source rather than two that may disagree.
 * Tags are the site's description of the problem, not a rating, and stay.
 */
export function markPending(contest) {
  for (const problem of contest.problems) {
    problem.rating = null;
    problem.ratingSource = PENDING_RATING;
    problem.ratingConfidence = null;
  }
  return contest;
}

/**
 * Copies the catalog's ratings onto a tracked contest, by problem index.
 *
 * Only ratings move — never `solved`, which is the user's own, nor the list of
 * problems itself. A problem the catalog does not carry keeps whatever it had.
 *
 * @returns {boolean} whether anything changed
 */
export function applyCatalogRatings(contest, record) {
  if (!record) return false;
  const byIndex = new Map(record.problems.map((problem) => [String(problem.index), problem]));
  let changed = false;

  for (const problem of contest.problems) {
    const source = byIndex.get(String(problem.index));
    if (!source) continue;
    for (const field of ["rating", "ratingSource", "ratingConfidence", "tags"]) {
      const value = source[field] ?? (field === "tags" ? [] : null);
      if (JSON.stringify(problem[field] ?? null) !== JSON.stringify(value)) {
        problem[field] = value;
        changed = true;
      }
    }
  }
  return changed;
}

/** Whether a tracked contest still owes the catalog a rating, or holds one that may be revised. */
function wantsCatalog(contest) {
  return contest.problems.some(
    (problem) => problem.ratingSource === PENDING_RATING || problem.ratingSource === "estimated",
  );
}

/**
 * Reads the catalog records for these contest keys. A missing record is
 * simply absent from the result: the owner has not added that contest.
 *
 * @returns {Promise<Map<string, object>>}
 */
export async function lookupCatalog(keys, options = {}) {
  const firebase = await firebaseFrom(options);
  const found = new Map();
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      const record = decodeDoc(await firebase.get(docPath(key)));
      if (record) found.set(key, record);
    }),
  );
  return found;
}

/**
 * Publishes the owner's contests, writing only the ones that changed since
 * the last publish from this device. A platform that declares
 * `capabilities.publishable: false` is never published — its contests sit
 * behind a membership, and the catalog is readable by everyone.
 *
 * Only ever called in "owner" mode; the rules refuse it from anyone else
 * regardless, which is the guarantee — this check only avoids asking.
 *
 * @returns {Promise<number>} documents written
 */
export async function publishCatalog(contests, options = {}) {
  const storage = options.storage ?? globalThis.chrome.storage.local;
  const firebase = await firebaseFrom(options);

  const { [PUBLISHED_KEY]: published = {} } = await storage.get(PUBLISHED_KEY);
  const ops = [];
  const next = { ...published };

  for (const contest of contests) {
    if (!platformOf(contest).capabilities.publishable) continue;
    const key = contestKey(contest);
    const record = catalogRecord(contest);
    const print = fingerprint(record);
    if (published[key] === print) continue;
    ops.push({ set: docPath(key), data: encodeDoc(record) });
    next[key] = print;
  }

  if (ops.length === 0) return 0;
  await firebase.commit(ops);
  await storage.set({ [PUBLISHED_KEY]: next });
  return ops.length;
}

/**
 * Fills a non-owner's pending and estimated ratings from the catalog.
 *
 * Asks only about contests that want it: a contest whose every rating came
 * from the catalog as a published number has nothing left to learn, and each
 * lookup is one of the free tier's 50,000 daily reads.
 *
 * @returns {Promise<number>} contests that changed
 */
export async function refreshFromCatalog(contests, options = {}) {
  const wanting = contests.filter(wantsCatalog);
  if (wanting.length === 0) return 0;

  const records = await lookupCatalog(wanting.map(contestKey), options);
  let changed = 0;
  for (const contest of wanting) {
    if (applyCatalogRatings(contest, records.get(contestKey(contest)))) changed++;
  }
  return changed;
}
