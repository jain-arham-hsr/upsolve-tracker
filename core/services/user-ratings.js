/**
 * Your rating on each platform — the second input the queue's ordering needs.
 *
 * This matters more than any single problem's difficulty: a problem's rating
 * misplaces one row, but your rating misplaces that platform's **entire
 * block** relative to every other. So the rules here are conservative.
 *
 *  - A failed lookup **keeps the previous value**. Clearing it would silently
 *    re-sort everything from that site to the bottom of the queue.
 *  - Nothing is ever defaulted. Unknown stays null, and the queue shows those
 *    rows with an em dash rather than inventing a probability.
 *
 * Ratings are fetched as part of verifying who the account belongs to (see
 * platform-identity.js), so they arrive with an identity attached rather than
 * floating free.
 */
import { listSites } from "../platforms/registry.js";

const AUTO_KEY = "upsolve_tracker.platform_ratings";

/** @returns {Promise<Record<string, number|null>>} platform id → your rating. */
export async function getEffectiveRatings() {
  const stored = await chrome.storage.local.get({ [AUTO_KEY]: {} });
  return stored[AUTO_KEY] ?? {};
}

/**
 * Records freshly fetched ratings, leaving any platform that failed alone.
 *
 * @param {Record<string, number|null>} fetched - only platforms that answered
 */
export async function storeFetchedRatings(fetched) {
  if (!fetched || Object.keys(fetched).length === 0) return;

  const stored = await chrome.storage.local.get({ [AUTO_KEY]: {} });
  const next = { ...stored[AUTO_KEY] };

  for (const [platformId, rating] of Object.entries(fetched)) {
    // A null here means "asked and got no answer" — an unrated account, say.
    // Recording it is right; it is not the same as failing to ask.
    next[platformId] = typeof rating === "number" ? rating : null;
  }

  await chrome.storage.local.set({ [AUTO_KEY]: next });
}

/**
 * Which sites' ratings moved between two readings of the stored ratings, so the
 * shell can say why the queue just re-ordered. Without it a contest rating
 * update silently reshuffles a whole platform's block, which reads as a bug.
 *
 * Per **site**, not per platform: Codeforces' platforms share one account
 * and one rating, and reporting it twice would read as two changes.
 *
 * Only a number becoming a different number counts. A first rating had no
 * earlier order to change, and a null is an account with no rating at all.
 *
 * @returns {{label: string, from: number, to: number}[]}
 */
function describeRatingChanges(before, after) {
  const changes = [];

  for (const site of listSites()) {
    const moved = site.platforms
      .map((platform) => ({ from: before?.[platform.id], to: after?.[platform.id] }))
      .find(({ from, to }) => typeof from === "number" && typeof to === "number" && from !== to);

    if (moved) changes.push({ label: site.label, ...moved });
  }

  return changes;
}

/**
 * The status-strip sentence for `describeRatingChanges`, or null when nothing
 * moved. One wording for the refresh and the add alike.
 */
export async function ratingChangeMessage(before) {
  const after = await getEffectiveRatings();
  const changes = describeRatingChanges(before, after);
  if (changes.length === 0) return null;

  return changes
    .map(({ label, from, to }) => `${label} rating change detected (${from} → ${to}). Queue reordered.`)
    .join(" · ");
}

export const RATING_KEYS = { AUTO_KEY };
