/**
 * What a platform is.
 *
 * > A platform is one site the extension can track contests on. It knows how
 * > to build a session from settings, whose account that session is, what a
 * > contest holds, what the user has solved, and — where the site publishes no
 * > difficulty — how to estimate one.
 *
 * One subclass per platform, in `<platform>/platform.js`, one instance each in
 * `platforms.js`. The orchestrators (`contest-manager.js`, `progress-manager.js`,
 * the settings page) only ever call the **public** methods below; the
 * **hooks** are what a subclass implements. The base checks every shape that
 * crosses that line and names the platform when one is wrong, so a platform
 * that returns the wrong thing fails here rather than three modules later.
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
 *                                          → Set of descriptor.solvedKey values
 *   syncMetadata(session, contests, onProgress)
 *   reset(spacingMs)                      test seam
 *
 * ## Hooks — what a subclass implements
 *
 *   static settingsSection                slug of the settings section it reads
 *   buildSession(values)                  → Session          required
 *   identify(session)                     → {username, rating} required
 *   fetchContest({contestId, subtype, session, onProgress})
 *                                          → Status | Acquired required
 *   readField({contest, context, session, onProgress})
 *                                          → Status | Field | null   iff canEstimate
 *   estimate(contest, field)              pure; fills the gaps        iff canEstimate
 *   fetchAccepted(session, contests, onProgress)
 *                                          → Accepted[]       required
 *   syncMetadata(session, contests, onProgress)              optional
 *   describeIdentity(identity)                               optional
 *
 * ## Shapes
 *
 *   Session   { handle: string|null, sources: Source, ... }
 *             every read of the site goes through `session.sources`, so a
 *             fake source is injected the same way on every platform
 *   Acquired  { id, name, problems: [{index, name, ...}], startTimeSeconds,
 *               publishedDataCheckedAt, sourceId?, context? }
 *   Accepted  { contest: {id}, problem }     never a bare null contest
 *   Status    from `contest-status.js`
 *
 * `readField` is the I/O that produces what the estimator fits against, and
 * answers with a Status when it cannot — `sourceUnreachable` where the data
 * will come, `unavailable` where it never will — or null when there was simply
 * nothing to measure. `estimate` is pure over the result, so the fit tests
 * without a network stack. `estimateMissing` composes the two and is not
 * overridden.
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
import { Source } from "./source.js";

/** What every descriptor declares; `registry.js` asks for all of these. */
export const DESCRIPTOR_MEMBERS = [
  "id", "label", "shortLabel", "origin", "subtypes",
  "matchUrl", "contestUrl", "problemUrl", "sourceLabel",
  "filterGroups", "filterKey", "contestFlags", "contestLabel", "contestIdLabel",
  "solvedKey", "problemKey",
  "chartColor", "hostPermissions", "icon", "capabilities",
];

const HOOKS = ["buildSession", "identify", "fetchContest", "fetchAccepted"];

export class Platform {
  /** The settings section whose fields `createSession` reads. */
  static settingsSection = null;

  constructor(descriptor) {
    assertDescriptor(descriptor);
    this.descriptor = descriptor;
    this.id = descriptor.id;

    const name = new.target.name;
    for (const hook of HOOKS) {
      if (this[hook] === Platform.prototype[hook]) {
        throw new Error(`${name} must implement ${hook}()`);
      }
    }

    // Two declarations of one fact. Claiming the capability with no estimator
    // refuses every add; estimating without claiming it stores "???" beside
    // numbers already worked out. And the two halves come together: a field
    // nobody fits, or a fit with no field, is half an estimator.
    const reads = this.readField !== Platform.prototype.readField;
    const fits = this.estimate !== Platform.prototype.estimate;
    if (reads !== fits) {
      throw new Error(`${name} implements ${reads ? "readField() without estimate()" : "estimate() without readField()"}`);
    }
    if (reads !== descriptor.capabilities.canEstimate) {
      throw new Error(
        reads
          ? `${name} implements readField() and estimate() but its descriptor declares canEstimate: false`
          : `${name} declares canEstimate: true but implements neither readField() nor estimate()`,
      );
    }

    const section = new.target.settingsSection;
    if (!SECTIONS.some((candidate) => candidate.slug === section)) {
      throw new Error(`${name} names settings section "${section}", which schema.js does not declare`);
    }
  }

  // ── public ────────────────────────────────────────────────────────────

  /** The slugs this platform reads, from its settings section — declared once. */
  get settingSlugs() {
    const section = SECTIONS.find((s) => s.slug === this.constructor.settingsSection);
    return section.fields.map((field) => field.slug);
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
    if (!(session.sources instanceof Source)) {
      throw new Error(`${this.id} built a session that carries no Source to read the site through`);
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
    const contest = buildContestRecord(this.descriptor, { type: subtype, ...acquired });

    if (this.descriptor.capabilities.canEstimate) {
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
    return new Set(
      [...accepted].map(({ contest, problem }) => this.descriptor.solvedKey(contest, problem)),
    );
  }

  /** Fills in data that only arrives after the add. Default: nothing does. */
  async syncMetadata(_session, _contests, _onProgress) {}

  /** Test seam: resets pacing and caches between cases. */
  reset(spacingMs = 0) {
    this.sources?.reset?.(spacingMs);
  }

  // ── hooks ─────────────────────────────────────────────────────────────

  buildSession(_values) { throw new Error(`${this.id} must implement buildSession()`); }
  identify(_session) { throw new Error(`${this.id} must implement identify()`); }
  fetchContest(_args) { throw new Error(`${this.id} must implement fetchContest()`); }
  fetchAccepted(_session, _contests, _onProgress) { throw new Error(`${this.id} must implement fetchAccepted()`); }

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
 * The stored contest shape. `platform` comes from the descriptor rather than a
 * literal, and `addedAt` is stamped here so no platform decides when "now" is.
 */
export function buildContestRecord(descriptor, {
  id, sourceId, name, type, problems, publishedDataCheckedAt, startTimeSeconds,
}) {
  return {
    id,
    platform: descriptor.id,
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

function assertDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("a Platform needs a descriptor");
  }
  for (const member of DESCRIPTOR_MEMBERS) {
    if (!(member in descriptor)) {
      throw new Error(`descriptor "${descriptor.id ?? "?"}" is missing ${member}`);
    }
  }
  if (typeof descriptor.capabilities.canEstimate !== "boolean") {
    throw new Error(`descriptor "${descriptor.id}" must declare capabilities.canEstimate`);
  }
}

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
