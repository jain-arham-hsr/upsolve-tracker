/**
 * What the two Codeforces platforms share: one account.
 *
 * One handle, one key pair, one settings section — and one submission stream.
 * `user.status` carries no gym/official marker, so each platform reads the
 * same stream and stamps its own `solvedKey` prefix on it; `applySolvedStatus`
 * looks up by the prefix of the platform that owns the contest, so the second
 * read is load-bearing rather than waste.
 *
 * Whose account this is: Codeforces is asked *about* a handle, and
 * `user.status?handle=X` returns X's submissions whoever's key signs the
 * request. There is no "who am I" endpoint, so the handle is verified to
 * exist, not to be yours; the changed-identity path in
 * `services/platform-identity.js` is what contains a wrong one.
 *
 * What each platform adds is the acquisition — an official round is pure
 * JSON, a gym is the one Codeforces path that can scrape — and the Source
 * class it reads through, named in `static Sources`.
 */
import { Platform } from "../platform.js";
import { estimate } from "./estimator.js";

const HANDLE_KEY = "upsolve_tracker.handle";

export class CodeforcesPlatform extends Platform {
  static settingsSection = "codeforces";

  /** The `CodeforcesSources` subclass a session of this platform reads through. */
  static Sources = null;

  constructor(descriptor) {
    super(descriptor);
    if (typeof new.target.Sources !== "function") {
      throw new Error(`${new.target.name} must name its Sources class`);
    }
  }

  /** @throws when the extension has not been configured yet. */
  buildSession(values) {
    const apiKey = values.api_key;
    const apiSecret = values.api_secret;

    if (!apiKey || !apiSecret) {
      throw new Error(
        "No API key set yet. Open Settings and add your Codeforces handle, key and secret.",
      );
    }

    return {
      sources: new this.constructor.Sources(apiKey, apiSecret),
      handle: values[HANDLE_KEY],
    };
  }

  /**
   * Confirms the handle is a real account and returns it with the rating —
   * both from the one `user.info` call, so verifying costs nothing extra.
   *
   * @throws when no handle is set, or Codeforces does not know it.
   */
  async identify(session) {
    if (!session?.handle) {
      throw new Error("No Codeforces handle set. Add one in Settings.");
    }

    // A bad handle comes back FAILED, which the source turns into a throw.
    const users = await session.sources.getUsersInfo([session.handle]);
    const user = users?.[0];

    if (!user?.handle) {
      throw new Error(`Codeforces doesn't recognise the handle "${session.handle}".`);
    }

    return {
      // Codeforces' own casing, so "Tourist" over "tourist" is not a new account.
      username: user.handle,
      rating: typeof user.rating === "number" ? user.rating : null,
    };
  }

  /** Both platforms fit the same quantity; only how the field is read differs. */
  estimate(contest, field) {
    return estimate(contest, field);
  }

  /** `contests` is unused: `user.status` returns the whole history in one call. */
  async fetchAccepted(session, _contests, onProgress = () => {}) {
    onProgress("Checking your submissions…");
    const submissions = await session.sources.getUserStatus(session.handle);

    return submissions
      .filter((submission) => submission.verdict === "OK")
      .map((submission) => ({
        contest: { id: submission.problem.contestId },
        problem: { index: submission.problem.index },
      }));
  }
}
