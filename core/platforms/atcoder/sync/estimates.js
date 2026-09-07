/**
 * Rates contests that were added without a readable field — added signed
 * out, say. Difficulty never changes once a contest has ended, so a rated
 * contest is never re-read.
 *
 * Capped at one contest per refresh: a standings payload is around a
 * megabyte, and a contest that can never be rated would otherwise levy that
 * cost forever. Longest-unasked first is what makes the cap safe — sliced in
 * stored order, the first unrated contest was retried every refresh and
 * everything behind it never. The Codeforces re-check has no cap,
 * deliberately: it has a six-week cutoff instead, and a cap on top of a
 * cutoff starves.
 */
import { readField } from "../field.js";
import { estimate } from "../estimator.js";

const MAX_PER_SYNC = 1;

/** @returns {Promise<number>} problems that gained a difficulty */
export async function sync(session, contests, onProgress = () => {}) {
  const unrated = contests
    .filter((contest) => contest.problems.some((problem) => problem.rating === null))
    .sort((a, b) => (a.publishedDataCheckedAt ?? 0) - (b.publishedDataCheckedAt ?? 0));

  if (unrated.length === 0) return 0;

  let resolved = 0;
  for (const contest of unrated.slice(0, MAX_PER_SYNC)) {
    const before = contest.problems.filter((p) => p.rating !== null).length;

    // The same read-then-fit the base runs at add time; a failed read answers
    // with a status and leaves the contest for the next refresh.
    const field = await readField({ contest, session, onProgress });
    if (!field?.status && field != null) estimate(contest, field);

    // Stamped on the attempt, not on success: stamping only on success would
    // leave a contest that can never be rated first in the sort forever.
    contest.publishedDataCheckedAt = Date.now();

    resolved += contest.problems.filter((p) => p.rating !== null).length - before;
  }

  if (resolved > 0) {
    console.log(`[AtCoder] ${resolved} problem(s) gained an estimated difficulty.`);
  }
  return resolved;
}
