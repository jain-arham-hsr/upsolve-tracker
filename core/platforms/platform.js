/**
 * What a platform is.
 *
 * > A platform is one registered kind of contest on a site: it says which
 * > URLs are its contests and how they are named and keyed, builds a session
 * > from settings, verifies whose account that is, acquires a contest, reads
 * > what the user has solved, and — where the site publishes no difficulty —
 * > estimates one.
 *
 * A **site** is the host behind it: `site.js` in the site's folder is a pure
 * object every platform of that site takes on — origin, host permission, mark,
 * settings section — `api.js` is the site's JSON and `scraper.js`, where the
 * site reads pages, its HTML. AtCoder and CodeChef are a site with one
 * platform; Codeforces is a site with two.
 *
 * One subclass per platform, in `platform.js`, one instance each in
 * `registry.js`. The orchestrators and the settings page only ever call the
 * **public** methods below; the **hooks** are what a subclass implements, and
 * three of them have defaults that work through the site's API, so a
 * platform overrides them only where its site's account works differently.
 *
 * ## Describing the platform
 *
 * The members in `DESCRIPTOR_MEMBERS` — `id`, `matchUrl`, `solvedKey`,
 * `capabilities` and the rest — are declared on the class, first, in that
 * order. `registry.js` checks every instance it builds with `Platform.check`.
 *
 * ## Public — what callers use
 *
 *   createSession()                       settings → Session
 *   createSessionFrom(values)             unsaved settings → Session
 *   verifyIdentity(session)               → {username, rating}, or throws
 *   describeIdentity(identity)            how Settings names the account
 *   fetchContestRecord({contestId, subtype, session, onProgress})
 *                                          → {status, contest?} — the whole add
 *   fetchSolvedKeys(session, contests, onProgress)
 *                                          → Set of solvedKey values
 *   syncMetadata(session, contests, onProgress)
 *   reset(spacingMs)                      test seam
 *
 * ## Hooks — what a subclass implements
 *
 *   static site, static Api               the site's object and Api class      required
 *   static Scraper                        the site's Scraper class             iff it reads pages
 *   fetchContest({contestId, subtype, session, onProgress})
 *                                          → Status | Acquired                 required
 *   buildSession(values)                  → Session      default: handle + Api/Scraper.fromSettings
 *   identify(session)                     → {username, rating}
 *                                                        default: api.identity(handle)
 *   fetchAccepted(session, contests, onProgress)
 *                                          → Accepted[]  default: api.accepted(handle)
 *   readField({contest, context, session, onProgress})
 *                                          → Status | Field | null   iff canEstimate
 *   estimate(contest, field)              pure; fills the gaps       iff canEstimate
 *   syncMetadata(session, contests, onProgress)              optional
 *   syncStartTimes(session, contests, onProgress)            default: from api.contestList()
 *   describeIdentity(identity)                               optional
 *
 * ## Shapes
 *
 *   Session   { handle: string|null, api: Api, scraper: Scraper|null, ... }
 *             every read of the site goes through `session.api` or
 *             `session.scraper`, so a fake is injected the same way on
 *             every platform
 *   Acquired  { id, name, problems: [{index, name, ...}], startTimeSeconds,
 *               publishedDataCheckedAt, sourceId?, context? }
 *   Accepted  { contest: {id}, problem }     never a bare null contest
 *   Status    from `contest-status.js`
 *
 * `readField` is the I/O that produces what the estimator fits against, and
 * answers with a Status when it cannot — `sourceUnreachable` where the data
 * will come, `unavailable` where it never will — or null when there was simply
 * nothing to measure. `estimate` is pure over the result. `estimateMissing`
 * composes the two and is not overridden.
 *
 * Every gate stays inside `fetchContest`, returned as a Status; the base only
 * passes one through. The gap policy — what an unrated problem means once the
 * estimator has run — is deliberately *not* here: `contest-manager.js` applies
 * it against `capabilities.canEstimate`, and two places would be free to
 * disagree.
 */
import { getSettings } from "../settings/store.js";
import { SECTIONS } from "../settings/schema.js";
import { ready, sourceUnreachable } from "../contest-status.js";
import { Api } from "./api.js";
import { Scraper } from "./scraper.js";

/** What every platform declares, in this order, before any hook. */
export const DESCRIPTOR_MEMBERS = [
  "id", "label", "shortLabel", "origin", "subtypes",
  "matchUrl", "contestUrl", "problemUrl", "sourceLabel",
  "filterGroups", "filterKey", "contestFlags", "contestLabel", "contestIdLabel",
  "solvedKey", "problemKey",
  "chartColor", "hostPermissions", "icon", "capabilities",
];

export class Platform {
  /** The site's object: what every platform of the site takes on. */
  static site = null;

  /** The site's Api class. `fromSettings(values)` builds the instance a session carries. */
  static Api = null;

  /** The site's Scraper class, where it reads pages at all; null where it does not. */
  static Scraper = null;

  constructor() {
    const { site, Api: api, Scraper: scraper, name } = new.target;
    if (!site || typeof site !== "object") throw new Error(`${name} declares no site`);
    if (typeof api !== "function") throw new Error(`${name} declares no Api class`);
    if (scraper !== null && typeof scraper !== "function") {
      throw new Error(`${name} declares a Scraper that is not a class`);
    }
    Object.assign(this, site);
  }

  /**
   * What the registry asks of every instance it builds. Class fields
   * initialise after `super()` returns, so this cannot run in the constructor.
   */
  static check(instance) {
    const name = instance.constructor.name;
    for (const member of DESCRIPTOR_MEMBERS) {
      if (!(member in instance)) throw new Error(`${name} is missing ${member}`);
    }
    if (typeof instance.capabilities?.canEstimate !== "boolean") {
      throw new Error(`${name} must declare capabilities.canEstimate`);
    }

    // Optional, and checked only when declared: how long this site is given to
    // publish a rating before a missing one is taken at face value. Refused on
    // a platform that estimates, where `contest-manager.js` never reaches the
    // branch that reads it — a window declared there is config that looks live
    // and does nothing.
    const grace = instance.capabilities.ratingGraceMs;
    if (grace !== undefined) {
      if (!Number.isFinite(grace) || grace < 0) {
        throw new Error(`${name} declares a ratingGraceMs that is not a duration in ms`);
      }
      if (instance.capabilities.canEstimate) {
        throw new Error(
          `${name} declares ratingGraceMs but canEstimate: true, where it is never read`,
        );
      }
    }
    if (instance.fetchContest === Platform.prototype.fetchContest) {
      throw new Error(`${name} must implement fetchContest()`);
    }
    if (
      instance.fetchAccepted === Platform.prototype.fetchAccepted &&
      typeof instance.constructor.Api.prototype.accepted !== "function"
    ) {
      throw new Error(`${name} must implement fetchAccepted(), or its API accepted()`);
    }

    // Two declarations of one fact. Claiming the capability with no estimator
    // refuses every add; estimating without claiming it stores "???" beside
    // numbers already worked out. And the two halves come together: a field
    // nobody fits, or a fit with no field, is half an estimator.
    const reads = instance.readField !== Platform.prototype.readField;
    const fits = instance.estimate !== Platform.prototype.estimate;
    if (reads !== fits) {
      throw new Error(`${name} implements ${reads ? "readField() without estimate()" : "estimate() without readField()"}`);
    }
    if (reads !== instance.capabilities.canEstimate) {
      throw new Error(
        reads
          ? `${name} implements readField() and estimate() but declares canEstimate: false`
          : `${name} declares canEstimate: true but implements neither readField() nor estimate()`,
      );
    }

    if (!SECTIONS.some((section) => section.slug === instance.settingsSection)) {
      throw new Error(`${name} names settings section "${instance.settingsSection}", which schema.js does not declare`);
    }
    return instance;
  }

  // ── public ────────────────────────────────────────────────────────────

  /** The site this platform belongs to; two platforms may share one. */
  get site() {
    return this.constructor.site;
  }

  /** The slugs this platform reads, from its site's settings section — declared once. */
  get settingSlugs() {
    return this.#section.fields.map((field) => field.slug);
  }

  /** The one local field of the section: the handle. */
  get handleSlug() {
    return this.#section.fields.find((field) => field.store === "local").slug;
  }

  get #section() {
    return SECTIONS.find((section) => section.slug === this.settingsSection);
  }

  async createSession() {
    return this.createSessionFrom(await getSettings(this.settingSlugs));
  }

  /** The same session from values that have not been saved yet, for Settings. */
  async createSessionFrom(values) {
    const session = await this.buildSession(values ?? {});
    if (!session || typeof session !== "object" || !("handle" in session)) {
      throw new Error(`${this.id} built a session with no handle field`);
    }
    if (!(session.api instanceof Api)) {
      throw new Error(`${this.id} built a session that carries no Api to read the site through`);
    }
    if (session.scraper != null && !(session.scraper instanceof Scraper)) {
      throw new Error(`${this.id} built a session whose scraper is not a Scraper`);
    }
    return session;
  }

  /** @returns {Promise<{username: string, rating: number|null}>} */
  async verifyIdentity(session) {
    const identity = await this.identify(session);
    if (typeof identity?.username !== "string" || identity.username === "") {
      throw new Error(`${this.id} verified an identity with no username`);
    }
    if (identity.rating !== null && typeof identity.rating !== "number") {
      throw new Error(`${this.id} returned a rating that is neither a number nor null`);
    }
    return identity;
  }

  /** "Connected as X" where a handle is looked up; a platform whose session *is* the identity overrides. */
  describeIdentity(identity) {
    return `Connected as ${identity.username}.`;
  }

  /**
   * The whole add: acquire, build the stored record, estimate what the site
   * did not publish. Answers with one of the five statuses.
   */
  async fetchContestRecord({ contestId, subtype, session, onProgress = () => {} }) {
    // A failure to *ask* is not an answer. The platform flags it at the point
    // that knows (`isSourceUnreachable`); the status it maps to is decided once,
    // here. Anything unflagged still escapes, which keeps an unrecognised
    // exception a bug rather than a case.
    const acquired = await withSourceUnreachable(() =>
      this.fetchContest({ contestId, subtype, session, onProgress }),
    );
    if (acquired?.status) return acquired;

    assertAcquired(this.id, acquired);
    const contest = buildContestRecord(this, { type: subtype, ...acquired });

    if (this.capabilities.canEstimate) {
      const verdict = await this.estimateMissing({ contest, context: acquired.context, session, onProgress });
      if (verdict?.status) return verdict;
    }

    return ready(contest);
  }

  /**
   * Rate what the site did not publish: read the field, then fit. Runs from
   * the add and from any re-check; a contest with nothing unrated costs no
   * request at all.
   *
   * @returns {Promise<object|undefined>} a Status when the field could not be
   *   read, otherwise nothing — the problems were filled in place.
   */
  async estimateMissing({ contest, context = {}, session, onProgress = () => {} }) {
    if (!contest.problems.some((problem) => problem.rating === null)) return;

    const field = await this.readField({ contest, context, session, onProgress });
    if (field?.status) return field;
    if (field == null) return;

    onProgress("Estimating problem ratings…");
    this.estimate(contest, field);
  }

  /** @returns {Promise<Set<string>>} */
  async fetchSolvedKeys(session, contests, onProgress = () => {}) {
    const accepted = await this.fetchAccepted(session, contests, onProgress);
    assertAccepted(this.id, accepted);
    return new Set([...accepted].map(({ contest, problem }) => this.solvedKey(contest, problem)));
  }

  /** Fills in data that only arrives after the add. Default: nothing does. */
  async syncMetadata(_session, _contests, _onProgress) {}

  /** Test seam: resets the site's clients and caches between cases. */
  reset(spacingMs = 0) {
    this.constructor.Api.reset(spacingMs);
    this.constructor.Scraper?.reset(spacingMs);
  }

  // ── hooks with defaults, through the site's API ───────────────────────

  /** The handle from settings, and the API and scraper built from them. */
  buildSession(values) {
    const { Api: api, Scraper: scraper } = this.constructor;
    return {
      handle: values[this.handleSlug],
      api: api.fromSettings(values),
      scraper: scraper ? scraper.fromSettings(values) : null,
    };
  }

  /**
   * A site that is asked *about* a handle: confirm it exists and take the
   * rating it shows. A site whose session is the identity overrides.
   *
   * @throws when no handle is set, or the site does not know it.
   */
  async identify(session) {
    if (!session?.handle) {
      throw new Error(`No ${this.constructor.site.label} handle set. Add one in Settings.`);
    }
    const identity = await session.api.identity(session.handle);
    if (!identity) {
      throw new Error(`${this.constructor.site.label} doesn't recognise the handle "${session.handle}".`);
    }
    return identity;
  }

  /** A site with a per-user submission list answers in one call. */
  async fetchAccepted(session, _contests, onProgress = () => {}) {
    onProgress("Checking your submissions…");
    return session.api.accepted(session.handle);
  }

  /** The bulk contest list this platform dates contests from, where the site has one. */
  contestList(session) {
    return typeof session.api.contestList === "function" ? session.api.contestList() : null;
  }

  /**
   * Fills `contest.startTimeSeconds`, which orders the contest list, from the
   * site's bulk contest list. A finished contest's start time never changes,
   * so there is no re-check: a contest is asked about once, and only if the
   * field is missing. Ordering is cosmetic, so a failed list never breaks a
   * sync or an add.
   *
   * @returns {Promise<number>} contests dated
   */
  async syncStartTimes(session, contests, onProgress = () => {}) {
    const pending = contests.filter((contest) => !contest.startTimeSeconds);
    if (pending.length === 0) return 0;

    let list;
    try {
      onProgress("Looking up contest dates…");
      list = await this.contestList(session);
    } catch (error) {
      console.warn(`[${this.constructor.site.label}] contest list failed:`, error.message);
      return 0;
    }
    if (!list) return 0;

    const startTimes = new Map();
    for (const contest of list) {
      if (contest.startTimeSeconds) startTimes.set(String(contest.id), contest.startTimeSeconds);
    }

    let resolved = 0;
    for (const contest of pending) {
      const startTime = startTimes.get(String(contest.id));
      if (startTime) {
        contest.startTimeSeconds = startTime;
        resolved++;
      }
    }

    console.log(`[${this.constructor.site.label}] Resolved ${resolved} of ${pending.length} contest(s).`);
    return resolved;
  }

  // ── hooks without defaults ─────────────────────────────────────────────

  fetchContest(_args) { throw new Error(`${this.id} must implement fetchContest()`); }

  /** The field the estimator fits against. Only a platform with `canEstimate` overrides. */
  async readField(_args) { return null; }
  /** Fill every unrated problem from the field. Pure. Only a platform with `canEstimate` overrides. */
  estimate(_contest, _field) {}
}

// ── the stored shape ───────────────────────────────────────────────────

/**
 * Fill the fields every stored problem carries, without inventing any.
 *
 * `upsolvable` is passed through rather than defaulted: CodeChef writes it only
 * when the answer is *no*, and absent means upsolvable — which is every problem
 * on Codeforces and AtCoder. Writing `upsolvable: true` here would turn a
 * meaningful absence into noise on every record.
 */
export function normalizeProblem(problem) {
  return {
    ...problem,
    rating: problem.rating ?? null,
    ratingSource: problem.ratingSource ?? null,
    ratingConfidence: problem.ratingConfidence ?? null,
    officialSolves: problem.officialSolves ?? 0,
    solved: problem.solved ?? false,
    tags: problem.tags ?? [],
  };
}

/**
 * The stored contest shape. `platform` comes from the instance rather than a
 * literal, and `addedAt` is stamped here so no platform decides when "now" is.
 */
export function buildContestRecord(platform, {
  id, sourceId, name, type, problems, publishedDataCheckedAt, startTimeSeconds,
}) {
  return {
    id,
    platform: platform.id,
    // Only when it differs: a CodeChef parent resolves to a division, and the
    // add banner needs the id the user navigated from to recognise it.
    ...(sourceId != null && sourceId !== id ? { sourceId } : {}),
    name,
    type,
    problems: problems.map(normalizeProblem),
    publishedDataCheckedAt,
    startTimeSeconds: startTimeSeconds ?? null,
    addedAt: Date.now(),
  };
}

// ── assertions ─────────────────────────────────────────────────────────

function assertAcquired(id, acquired) {
  if (!acquired || typeof acquired !== "object") {
    throw new Error(`${id} fetched a contest but returned ${acquired}`);
  }
  if (acquired.id == null) throw new Error(`${id} acquired a contest with no id`);
  if (typeof acquired.name !== "string") throw new Error(`${id} acquired contest ${acquired.id} with no name`);
  if (!Array.isArray(acquired.problems)) {
    throw new Error(`${id} acquired contest ${acquired.id} with no problems array`);
  }
  for (const problem of acquired.problems) {
    if (problem?.index == null || typeof problem.name !== "string") {
      throw new Error(`${id} acquired contest ${acquired.id} with a problem missing its index or name`);
    }
  }
  for (const field of ["startTimeSeconds", "publishedDataCheckedAt"]) {
    if (!(field in acquired)) throw new Error(`${id} acquired contest ${acquired.id} without ${field}`);
  }
}

function assertAccepted(id, accepted) {
  if (!accepted || typeof accepted[Symbol.iterator] !== "function") {
    throw new Error(`${id} returned accepted submissions that are not iterable`);
  }
  for (const pair of accepted) {
    if (!pair?.contest || typeof pair.contest !== "object" || !pair.problem) {
      throw new Error(`${id} returned an accepted pair without a contest object and a problem`);
    }
  }
}

async function withSourceUnreachable(run) {
  try {
    return await run();
  } catch (error) {
    if (error?.isSourceUnreachable) return sourceUnreachable(error.message);
    throw error;
  }
}
