/**
 * What CodeChef's payloads mean: the difficulty sentinels, the tag noise, the
 * status map, and the practice-mirror flag. Pure; `platform.js` decides with
 * them.
 */

/**
 * `difficulty_rating` arrives as a string and uses two out-of-band values:
 * `-1` for "not rated" (74% of the catalogue) and `9999` for a handful more.
 * Both must become null. `9999` is especially dangerous — it is also the
 * queue's own sort-last sentinel, so passing it through would look like a
 * legitimate, very hard problem.
 */
const NOT_RATED = new Set([-1, 9999]);

/** Setter handles and contest codes get tagged alongside real topics. */
const TAG_NOISE = /^(?:start|cook|ltime|snck)\d+$|_adm$/i;

/**
 * Accepted, from the practice bundle's own status map:
 * `{0: Unattempted, 1: Accepted, 2: Partially Correct, 3: Wrong Answer, …}`.
 *
 * Match this value explicitly rather than "anything but 0" — `solved` is sticky
 * and never cleared, so a false positive hides a problem permanently while a
 * false negative costs one refresh. `2` is Partially Correct and is excluded for
 * the same reason `partially_solved` always was.
 *
 * Here because both halves of the platform need it: `fetchContest`
 * reads it off the contest payload and `fetchAccepted` off the practice
 * listing. Duplicating a magic number across the two is how they drift.
 */
export const ACCEPTED = 1;

export function parseDifficulty(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || NOT_RATED.has(value)) return null;
  return value;
}

export function cleanTags(detail, contestCode) {
  const raw = [...(detail?.user_tags ?? []), ...(detail?.computed_tags ?? [])];
  const seen = new Set();

  return raw.filter((tag) => {
    if (typeof tag !== "string") return false;
    const trimmed = tag.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === contestCode.toLowerCase()) return false;
    if (TAG_NOISE.test(trimmed)) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Some old problems were never mirrored into CodeChef's practice archive.
 * `START32C/problems/MAXTHEMIN` still shows its statement inside the contest,
 * but `/problems/MAXTHEMIN` 404s — and a contest stops accepting submissions
 * when it ends, so there is nowhere left to submit it. It is dead work, and
 * because `solved` is only ever set true nothing would ever clear it from the
 * queue.
 *
 * `is_added_to_practice` on the contest payload answers this exactly, and comes
 * free — `fetchContestRecord` already has that payload in hand. Two nearby
 * fields do **not** answer it, so don't reach for them again: `problem_url` is
 * `/problems/MAXTHEMIN` even for the problem that 404s there, and
 * `is_direct_submittable` is false for everything when signed out, since it
 * tracks login state rather than mirroring.
 *
 * The key is written only when the answer is no. Absent means upsolvable, which
 * is every problem on Codeforces and AtCoder — both serve their whole history
 * from a stable per-contest route.
 */
export function practiceFlag(problem) {
  return problem?.is_added_to_practice === false ? { upsolvable: false } : {};
}
