/**
 * Codeforces' group contests — everything under `/group/<group>/contest/<id>`.
 *
 * A platform of its own because the API cannot see these contests at all.
 * Measured with a member's signed key against group contest 719724:
 * `contest.standings` and `contest.status` both answer "Contest with id 719724
 * not found", and `asManager` is refused as managers-only. That takes out the
 * whole gym pipeline, hidden-standings fallback included, since both of its
 * sources are API calls. Only `user.status` sees the contest — it carries the
 * member's own submissions under the contest's id — so solves clear through
 * the base's default like any other Codeforces platform.
 *
 * So the contest is read from its pages, through a codeforces.com tab, which
 * carries the membership: the problems page for the problem list, and the
 * standings for everything else — the contest's name, whether it has ended,
 * who competed and how many solved each problem. The problems page cannot
 * answer the first two: its sidebar header is the group's name, and where a
 * gym's sidebar shows the phase a group contest's shows the viewer's role. Nothing publishes a rating or a tag for these problems — they are
 * the group's own, not archive problems — so every rating is estimated.
 */
import { Platform } from "../../platform.js";
import { site } from "../site.js";
import { CodeforcesApi, summariseSubmissions, distributionSize } from "../api.js";
import { CodeforcesScraper } from "../scraper.js";
import { estimate } from "../estimator.js";
import { notEndedYet, unavailable } from "../../../contest-status.js";

const URL_PATTERN = /^https?:\/\/(?:www\.)?codeforces\.com\/group\/[^/]+\/contest\/(\d+)/i;

export class CodeforcesGroupContests extends Platform {
  static site = site;
  static Api = CodeforcesApi;
  static Scraper = CodeforcesScraper;

  id = "codeforces-group-contests";

  label = "Codeforces Group Contests";

  shortLabel = "CF";

  subtypes = [{ value: "GROUP", label: "Group contest" }];

  /**
   * Only the id is taken: the group's own path is read off the contest's page
   * at add time, and kept on each problem as its `url`.
   */
  matchUrl(url) {
    const match = typeof url === "string" ? url.match(URL_PATTERN) : null;
    return match ? { contestId: match[1], subtype: "GROUP" } : null;
  }

  /**
   * The group's own path, from a stored problem link. `/gym/<id>` does
   * redirect to the group contest, but nothing below it does —
   * `/gym/<id>/standings` lands on the contest's dashboard — so a link is
   * only trusted as the page served it. The site's `problemUrl` builds on
   * this, so problem links follow.
   */
  contestUrl(contest) {
    const url = contest.problems?.find((problem) => problem.url)?.url;
    return url ? url.replace(/\/problem\/[^/]+\/?$/, "") : `${this.origin}/gym/${contest.id}`;
  }

  /** Display-only, e.g. "Group 719724A". */
  sourceLabel(contest, problem) {
    return `Group ${contest.id}${problem.index}`;
  }

  filterGroups = [{ key: "codeforces-group-contests", label: "Codeforces Group Contests" }];

  filterKey() {
    return "codeforces-group-contests";
  }

  /** Worth labelling: every rating here is estimated, from a field of one group. */
  contestFlags() {
    return ["Group"];
  }

  contestLabel() {
    return "Group contest";
  }

  capabilities = {
    // No source carries tags for a group's own problems.
    publishesTags: false,
    canEstimate: true,
  };

  // ── the work ──────────────────────────────────────────────────────────

  /**
   * @returns a status when a gate fires, otherwise the record plus the parties
   *   the estimator measures, carried in `context` and never stored.
   */
  async fetchContest({ contestId, session, onProgress = () => {} }) {
    // `/gym/<id>` redirects to the group contest's dashboard, which is also
    // its problems page — and the one page whose links say where everything
    // else is.
    onProgress("Reading the problems page…");
    const page = await session.scraper.problemsPage(contestId);
    // Never a guessed list: a contest that merely looks short is worse than a refusal.
    if (!page) {
      throw new Error(`Couldn't read the problems page of group contest ${contestId}.`);
    }
    if (!page.standingsPath) {
      throw new Error(
        `The page of group contest ${contestId} links no standings to read` +
          (page.pageTitle ? ` (page title "${page.pageTitle}").` : "."),
      );
    }

    onProgress("Reading the standings…");
    // Throws naming the page when one is unreadable, which is a layout change.
    const standings = await session.scraper.standingsPage(page.standingsPath);

    // A running contest's standings carry partial counts, and nothing ever
    // re-rates a group contest.
    if (!standings.ended) {
      return notEndedYet(`Group contest ${contestId} is still running. It'll be added once it ends.`);
    }

    // The two pages must describe the same contest. A problem with no count
    // would be estimated from a zero it never had.
    const missing = page.problems.filter((problem) => !(problem.index in standings.solveCounts));
    if (missing.length > 0) {
      throw new Error(
        `The standings of group contest ${contestId} have no column for ` +
          `${missing.map((problem) => problem.index).join(", ")}.`,
      );
    }

    return {
      id: contestId,
      // Never the problems page's name, which on a group contest is the group's.
      name: standings.contestName ?? `Group contest ${contestId}`,
      problems: page.problems.map(({ index, name, url }) => ({
        index,
        name,
        // Stored, unlike a gym's: the group's own path, which no id rebuilds,
        // and what `contestUrl` reads it back from.
        // Scraped and rendered as a link, so only ever one on this site.
        url: url?.startsWith(`${this.origin}/`) ? url : undefined,
        officialSolves: standings.solveCounts[index],
      })),
      // Nothing is published later, so there is nothing to re-check.
      publishedDataCheckedAt: Date.now(),
      startTimeSeconds: await startTimeFromOwnSubmissions(contestId, session),
      context: { parties: standings.parties },
    };
  }

  /**
   * The field is the standings' parties, rated through `user.info` — the same
   * path a hidden-standings gym takes from its submissions. Whole, since a
   * group's field is small enough to rate outright.
   */
  async readField({ contest, context, session, onProgress = () => {} }) {
    onProgress("Measuring the field…");
    const distribution = await session.api.partyField(context.parties);

    // Permanent: a finished contest's standings do not gain participants.
    if (distributionSize(distribution) === 0) {
      return unavailable(
        `Couldn't rate group contest ${contest.id}: its standings list no ` +
          `participants to measure against.`,
      );
    }
    return distribution;
  }

  /**
   * Nothing to do. Group contests appear in no contest list, so the base's
   * default would fetch one on every refresh and never find them. The add
   * dates a contest from the user's own submissions or not at all, and an
   * undated one sorts to the bottom.
   */
  async syncStartTimes() {
    return 0;
  }

  estimate(contest, field) {
    return estimate(contest, field);
  }
}

/**
 * The start time, from the user's own in-contest submissions — the one API
 * response that sees a group contest. Contestant rows only: a virtual entry
 * carries its own start. Null when the user did not compete, and a failed
 * call is not worth failing the add over: the date only orders the list.
 */
async function startTimeFromOwnSubmissions(contestId, session) {
  try {
    const own = (await session.api.userStatus(session.handle)).filter(
      (submission) =>
        String(submission?.problem?.contestId) === String(contestId) &&
        submission.author?.participantType === "CONTESTANT",
    );
    return summariseSubmissions(own).startTimeSeconds;
  } catch (error) {
    console.warn(`[Codeforces] Couldn't date group contest ${contestId}:`, error.message);
    return null;
  }
}
