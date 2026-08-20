/**
 * Your rating on each platform — the second input the queue's ordering needs.
 *
 * This matters more than any single problem's difficulty: a problem's rating
 * misplaces one row, but your rating misplaces that platform's **entire
 * block** relative to every other. So the rules here are conservative.
 *
 *  - A failed lookup **keeps the previous value**. Clearing it would silently
 *    re-sort everything from that site to the bottom of the queue.
 *  - A manual override always wins. AtCoder suppresses ratings heavily for the
 *    first ~10-15 rated contests, so a strong newcomer's fetched rating is
 *    genuinely wrong and only they can say so.
 *  - Nothing is ever defaulted. Unknown stays null, and the queue shows those
 *    rows with an em dash rather than inventing a probability.
 */
const AUTO_KEY = "cf_trainer.platform_ratings";
const OVERRIDE_KEY = "cf_trainer.rating_overrides";

/** @returns {Promise<Record<string, number|null>>} override ?? fetched. */
export async function getEffectiveRatings() {
  const stored = await chrome.storage.local.get({
    [AUTO_KEY]: {},
    [OVERRIDE_KEY]: {},
  });
  return mergeRatings(stored[AUTO_KEY], stored[OVERRIDE_KEY]);
}

export function mergeRatings(auto = {}, overrides = {}) {
  const merged = { ...auto };

  for (const [platformId, value] of Object.entries(overrides)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[platformId] = value;
    }
  }
  return merged;
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

export async function getRatingOverrides() {
  const stored = await chrome.storage.local.get({ [OVERRIDE_KEY]: {} });
  return stored[OVERRIDE_KEY];
}

export async function setRatingOverride(platformId, value) {
  const overrides = await getRatingOverrides();

  if (typeof value === "number" && Number.isFinite(value)) {
    overrides[platformId] = value;
  } else {
    delete overrides[platformId];
  }

  await chrome.storage.local.set({ [OVERRIDE_KEY]: overrides });
}

export const RATING_KEYS = { AUTO_KEY, OVERRIDE_KEY };
