/**
 * The platform registry.
 *
 * Adding a site means adding a descriptor here; nothing else should branch on
 * which platform a contest came from. Contests stored before platforms existed
 * carry no `platform` field, so every lookup falls back to Codeforces rather
 * than failing — that is the migration, and it costs nothing at read time.
 */
import { codeforces } from "./codeforces/descriptor.js";
import { atcoder } from "./atcoder/descriptor.js";
import { codechef } from "./codechef/descriptor.js";

export const DEFAULT_PLATFORM_ID = codeforces.id;

const PLATFORMS = [codeforces, atcoder, codechef];
const BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

export function listPlatforms() {
  return [...PLATFORMS];
}

/**
 * @param {string} [id]
 * @returns {object} The descriptor, or the Codeforces one for records written
 *   before `platform` existed. Throws only for an id that is present but
 *   unknown, which means data from a newer version.
 */
export function getPlatform(id) {
  if (id == null || id === "") return codeforces;
  const platform = BY_ID.get(id);
  if (!platform) throw new Error(`Unknown platform: ${id}`);
  return platform;
}

/** The descriptor for a stored contest record. */
export function platformOf(contest) {
  return getPlatform(contest?.platform);
}

/**
 * Ask every platform whether it recognises this URL.
 *
 * @param {string} url
 * @returns {{platform: object, contestId: string, subtype: string}|null}
 */
export function matchContestUrl(url) {
  for (const platform of PLATFORMS) {
    const match = platform.matchUrl(url);
    if (match) return { platform, ...match };
  }
  return null;
}

/**
 * Identity of a stored contest. Ids collide across platforms — Codeforces
 * contest 1000 and a CodeChef contest "1000" are different things — so the
 * platform has to be part of the key. Ids are stringified because imported
 * backups can carry them as numbers.
 */
export function contestKey(contest) {
  return `${contest?.platform ?? DEFAULT_PLATFORM_ID}:${String(contest?.id)}`;
}

export function makeContestKey(platformId, contestId) {
  return `${platformId ?? DEFAULT_PLATFORM_ID}:${String(contestId)}`;
}

/**
 * The subset of `contests` belonging to one platform.
 *
 * Per-platform sync helpers (problemset-sync.js, start-time-service.js) are
 * Codeforces implementations, not generic services — handing them another
 * platform's contests would have them match on bare contest ids across
 * namespaces. Callers filter first.
 */
export function contestsOnPlatform(contests, platformId) {
  return (contests ?? []).filter(
    (contest) => (contest?.platform ?? DEFAULT_PLATFORM_ID) === platformId,
  );
}

/** Every filter chip, in platform order. */
export function listFilterGroups() {
  return PLATFORMS.flatMap((platform) => platform.filterGroups ?? []);
}

/** Which chip a contest belongs to. */
export function contestFilterKey(contest) {
  return platformOf(contest).filterKey(contest);
}

/**
 * @param {object} contest
 * @param {string[]|null} selected - null or empty means no filter at all,
 *   which is deliberately different from "nothing selected shows nothing".
 */
export function matchesFilter(contest, selected) {
  if (!selected || selected.length === 0) return true;
  return selected.includes(contestFilterKey(contest));
}
