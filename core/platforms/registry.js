/**
 * The platform registry: one instance per platform, and every question that
 * depends on *where a contest came from* — URLs, keys, labels, capabilities.
 *
 * A platform is its own descriptor: the class declares `id`, `matchUrl`,
 * `solvedKey` and the rest beside the work it does, so this is the one module
 * that enumerates platforms. Adding a site means adding its instances here;
 * nothing else should branch on which platform a contest came from.
 *
 * Every lookup **throws** on a record with no `platform`, or one naming a
 * platform this build does not know. There is deliberately no fallback: a
 * default would file a malformed record under Codeforces and key it as
 * `undefined:1993`, and an unknown id means data from a newer version.
 */
import { Platform } from "./platform.js";
import { CodeforcesOfficial } from "./codeforces/official/platform.js";
import { CodeforcesGyms } from "./codeforces/gyms/platform.js";
import { AtCoder } from "./atcoder/platform.js";
import { CodeChef } from "./codechef/platform.js";

const PLATFORMS = [
  new CodeforcesOfficial(),
  new CodeforcesGyms(),
  new AtCoder(),
  new CodeChef(),
].map(Platform.check);
const BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

export function listPlatforms() {
  return [...PLATFORMS];
}

/**
 * Every site once, in platform order, with the platforms it registers.
 *
 * The stats view keys on sites: one account, one rating scale, one tag
 * vocabulary, one identity colour. Codeforces' two platforms are one site.
 */
export function listSites() {
  const sites = new Map();
  for (const platform of PLATFORMS) {
    const site = platform.site;
    if (!sites.has(site.id)) sites.set(site.id, { ...site, platforms: [] });
    sites.get(site.id).platforms.push(platform);
  }
  return [...sites.values()];
}

/** The site a stored contest record belongs to. */
export function siteOf(contest) {
  return platformOf(contest).site;
}

/**
 * @param {string} [id]
 * @returns {object} The platform. Throws for a missing id as well as an
 *   unknown one — see above for why neither may be defaulted.
 */
export function getPlatform(id) {
  const platform = BY_ID.get(id);
  if (!platform) throw new Error(`Unknown platform: ${id}`);
  return platform;
}

/** The platform a stored contest record belongs to. */
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
  // platformOf validates: a record with no platform, or an unknown one, is
  // malformed, and a key like "undefined:1993" would be stored happily.
  return `${platformOf(contest).id}:${String(contest?.id)}`;
}

export function makeContestKey(platformId, contestId) {
  // getPlatform validates, for the same reason contestKey does: a caller that
  // omits the platform would otherwise mint "undefined:1000".
  return `${getPlatform(platformId).id}:${String(contestId)}`;
}

/**
 * The subset of `contests` belonging to one platform.
 *
 * Per-platform sync passes (`syncStartTimes`, `syncPublishedData`) are
 * Codeforces implementations, not generic services — handing them another
 * platform's contests would have them match on bare contest ids across
 * namespaces. Callers filter first.
 */
export function contestsOnPlatform(contests, platformId) {
  return (contests ?? []).filter(
    (contest) => contest?.platform === platformId,
  );
}

/** Every filter group, flattened, in platform order. */
export function listFilterGroups() {
  return PLATFORMS.flatMap((platform) => platform.filterGroups ?? []);
}

/**
 * Filter groups kept under their platform, so the control can render a header
 * with nested rows without knowing any platform's name.
 *
 * A platform contributing one group is a single row; one contributing several
 * — only Codeforces, splitting Official from Gym — gets a header plus nested
 * rows. Nobody wants five AtCoder rows for its contest families.
 */
export function listFilterPlatforms() {
  return PLATFORMS.map((platform) => ({
    platform,
    groups: platform.filterGroups ?? [],
  })).filter((entry) => entry.groups.length > 0);
}

/** Which chip a contest belongs to. */
function contestFilterKey(contest) {
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

/**
 * Finds a tracked contest by the id a URL carried.
 *
 * Matches the stored id **or** the `sourceId` it was added from: CodeChef
 * parent contests resolve to a division, so `/START252` is stored as
 * `START252D`, and a bare key comparison would report it as untracked.
 *
 * @returns {object|null}
 */
export function findTrackedContest(contests, platformId, contestId) {
  const key = makeContestKey(platformId, contestId);

  return (
    (contests ?? []).find((contest) => {
      if (!contest) return false;
      if (contestKey(contest) === key) return true;
      return (
        contest.sourceId != null &&
        makeContestKey(contest.platform, contest.sourceId) === key
      );
    }) ?? null
  );
}
