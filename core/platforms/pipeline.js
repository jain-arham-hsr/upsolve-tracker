/**
 * The trunk every platform adapter is assembled from.
 *
 * Before this, each platform wrote its own `fetchContestRecord` end to end, and
 * the parts that were identical had drifted into three copies: the stored
 * contest literal, the per-problem defaults, and the solved-key mapping.
 * each platform even wrote its own `platform:` id as a string
 * literal beside a descriptor that already knew its own id.
 *
 * ## What lives here, and the rule that decides
 *
 * CLAUDE.md's naming rule — *a fact must imply the same policy on every
 * platform; if it doesn't, the fact is too coarse* — applied to steps. A step
 * belongs here only if it means the same thing everywhere. Four do:
 *
 *   1. the stored contest shape
 *   2. the per-problem defaults
 *   3. handing off to an estimator, when the platform has one
 *   4. mapping accepted problems to `descriptor.solvedKey`
 *
 * Everything else stays platform-side. **All gating lives inside
 * `problems.fetchContest`**, returned as one of the five `contest-status.js`
 * values — Codeforces has five decision points, AtCoder two, and CodeChef
 * resolves a division first, none of which the trunk should learn.
 *
 * **The gap policy is deliberately not here.** `contest-manager.js` applies it
 * against `capabilities.canEstimate`, because it concerns a contest that was
 * fetched successfully. Applying it here too would put the same decision in two
 * places, free to disagree.
 *
 * ## Enforcement is the call site
 *
 * `buildAdapter` destructures what it needs and the trunk calls
 * `problems.fetchContest(...)`. A platform missing a piece fails where the
 * contract is stated, so no manifest, validator or directory walk is needed to
 * keep the shape honest. `estimator` really is optional: CodeChef publishes
 * `difficulty_rating` and passes none.
 */
import { ready } from "../contest-status.js";

/**
 * Fill the fields every stored problem carries, without inventing any.
 *
 * `upsolvable` is passed through rather than defaulted: CodeChef writes it only
 * when the answer is *no*, and absent means upsolvable — which is every problem
 * on Codeforces and AtCoder. Writing `upsolvable: true` here would turn a
 * meaningful absence into noise on every record.
 */
export function normalizeProblem(problem) {
  const normalized = {
    ...problem,
    rating: problem.rating ?? null,
    ratingSource: problem.ratingSource ?? null,
    ratingConfidence: problem.ratingConfidence ?? null,
    officialSolves: problem.officialSolves ?? 0,
    solved: problem.solved ?? false,
    tags: problem.tags ?? [],
  };
  return normalized;
}

/**
 * The stored contest shape.
 *
 * `platform` comes from the descriptor rather than a literal, and `addedAt` is
 * stamped here so three platforms cannot disagree about when "now" is.
 * `publishedDataCheckedAt` is the caller's to supply: Codeforces stores `null`
 * when a problemset sync did not complete, which is a fact only it knows.
 */
export function buildContestRecord(descriptor, {
  id,
  sourceId,
  name,
  type,
  problems,
  publishedDataCheckedAt,
  startTimeSeconds,
}) {
  return {
    id,
    platform: descriptor.id,
    // Only when it differs — a CodeChef parent contest resolves to a division,
    // so the id stored is not the id the user navigated from, and the add banner
    // needs theirs to recognise /START252 as already tracked via START252D.
    ...(sourceId != null && sourceId !== id ? { sourceId } : {}),
    name,
    type,
    problems: problems.map(normalizeProblem),
    publishedDataCheckedAt,
    startTimeSeconds: startTimeSeconds ?? null,
    addedAt: Date.now(),
  };
}

/**
 * Compose one platform's modules into the adapter the orchestrators consume.
 *
 * @param {object} descriptor - from `registry.js`
 * @param {object} modules
 * @param {object} modules.problems     - `fetchContest`, `syncMetadata`
 * @param {object} modules.submissions  - `fetchAccepted`
 * @param {object} modules.identity     - session and identity
 * @param {object} [modules.estimator]  - `fill`, where the platform has one
 */
export function buildAdapter(descriptor, { problems, submissions, identity, estimator }) {
  return {
    createSession: identity.createSession,
    createSessionFrom: identity.createSessionFrom,
    verifyIdentity: identity.verifyIdentity,
    // Optional by design: `options/sections.js` falls back to "Connected as X"
    // when a platform does not override it.
    describeIdentity: identity.describeIdentity,

    async fetchContestRecord({ contestId, subtype, session, onProgress = () => {} }) {
      const acquired = await problems.fetchContest({
        contestId,
        subtype,
        session,
        onProgress,
      });

      // A gate fired inside the platform — it already speaks the shared
      // vocabulary, so pass it straight through rather than re-classifying.
      if (acquired?.status) return acquired;

      const contest = buildContestRecord(descriptor, { type: subtype, ...acquired });

      if (estimator) {
        // May itself refuse — Codeforces answers `unavailable` for a gym whose
        // field is not visible, which is a fact about that gym, not a gap policy.
        const verdict = await estimator.fill({
          contest,
          context: acquired.context,
          session,
          onProgress,
        });
        if (verdict?.status) return verdict;
      }

      return ready(contest);
    },

    async fetchSolvedKeys(session, contests, onProgress = () => {}) {
      const accepted = await submissions.fetchAccepted(session, contests, onProgress);
      return new Set(
        [...accepted].map(({ contest, problem }) =>
          descriptor.solvedKey(contest, problem),
        ),
      );
    },

    syncMetadata: problems.syncMetadata,
  };
}
