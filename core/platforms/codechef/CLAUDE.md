<!-- Site notes for CodeChef. Split out of the root CLAUDE.md, which was over
     its size limit; this file is loaded when a file in this folder is read.
     Cross-site rules stay in the root. -->
# CodeChef

`core/platforms/codechef/`. No estimator here either: CodeChef publishes `difficulty_rating` and does so promptly — Starters 252 was fully rated within two days of running. `/api/rankings/` is CSRF-gated and returns 403, but nothing needs it.

CodeChef's public API was retired years ago and the site is an SPA, so the only route to its data is the same `/api/` endpoints the front end calls. **Its ToS §14 forbids crawling**, which is why `codechef/api.js` is written to be strictly user-session shaped: only the contest the user is looking at, its problems, and their own solve history; `/api/` paths only (robots.txt disallows `/problems/*`, `/status/*` and `/recent/user`); and a 403 stops and surfaces an error rather than retrying. What would make it a crawler is **enumeration** — paging the ~21,000-problem catalogue. `/api/list/problems` *is* used, but only ever scoped by `group=attempted` and behind a page cap; see below.

Four traps, all confirmed against the live API:

- **`problemsstats.solved` changes type.** Signed out it is an empty **array**; signed in it is an **object** keyed by problem code. Array methods silently see nothing on the shape that actually carries data, so read it with `Object.keys`.
- **Signed out looks identical to "solved nothing."** `fetchSolvedKeys` therefore refuses outright when `signedIn` is false, so `progress-manager` isolates the failure and leaves existing flags alone. This is the case the stickiness invariant exists for.
- **`problemsstats` cannot see an upsolve, and neither can the per-problem endpoint.** Both report only what happened *during* the contest. A contest closes to submissions when it ends, so upsolving happens in practice — see the section below, which is why solved status is no longer read per contest at all.
- **Two out-of-band difficulty values**, both arriving as strings: `-1` for unrated (74% of the catalogue) and `9999`. Both become null. `9999` is the dangerous one — it is also the queue's own sort-last sentinel, so passing it through would read as a legitimate, very hard problem. **A null does not reach storage on a contest that has just run**, though: CodeChef declares `capabilities.ratingGraceMs` of a week, so for that long an unrated problem makes the whole contest wait and retry instead of storing "???". The adapter's job is unchanged — it still reports `-1` and `9999` as null — and the decision is `contest-manager.js`'s, which is why `tests/platforms/codechef/platform.test.js` still asserts the null at adapter level while `tests/contest-gap-policy.test.js` asserts what becomes of it.
- **A failed per-problem fetch is not evidence that CodeChef has no rating.** Difficulty
  costs one request per problem, and conflating a failure with an absence stored `???` for
  problems CodeChef *had* rated. The contest waits and retries instead — the general rule at
  the top of the root `CLAUDE.md` (`???` means the site says unrated, never "we could not find out"),
  with the instance that produced it.
- **Whether a contest is still running is decided by CodeChef's clock, not yours.** The
  payload lists the problems *during* a contest, so nothing about the problem list says the
  contest has finished — adding mid-flight would record in-contest results as if they were
  final. CodeChef reports its own server time beside the contest's end time, and that pair is
  what the check reads. A local clock that is wrong, or merely in a different timezone, would
  otherwise decide it.
- **`/START252` is a parent contest** with an empty problem list and no error. Divisions are rating-banded, so the user's own rating (from `codeChefUserData`) selects the one they competed in; with no known rating it names the divisions rather than guessing.

Costs one request for the contest plus **one per problem** — difficulty and tags appear on no bulk or contest-level response, signed in or not. That is ~9 for a Starters division, still fewer than a Codeforces add. Tags mix real topics with the setter's handle and the contest code (`['combinatorics','raysh07_adm','start252','trees']`), so `cleanTags` strips both.

`codechef/scraper.js#parseDashboard` is the one place CodeChef's markup is read, extracting `window.codeChefUserData` from `/dashboard` by **balanced-brace slicing** — a non-greedy regex stops at the first `};` inside a nested object or a string. It returns `null`, never a default: a guessed handle would look like a signed-in session.

**It reads that global out of a `<script>` element, which is a DOM node like any other.** This file and AtCoder's namesake both used to regex the raw HTML *string* instead, which made them look like an exception to the folder they sit in — an exception this file spent a paragraph excusing. It was expedience, not necessity. Selecting the script is what made every page parser take a `Document`, and it removed the last consequence of the split: AtCoder's `identify` had been fetching its page as a string and hand-building a `Document` from it *because the two parsers disagreed about their input*. One `getDocument` now, and **`new DOMParser` appears in exactly one file in the tree**, `services/site-client.js` — asserted by `module-boundaries.test.js`.

Note `solvedKey` is `codechef:<problem_code>`. The same problem runs in every division of a Starters, so solving it in Div 4 clears it from a tracked Div 3.

## Solved status is read per user, not per contest

A CodeChef contest stops accepting submissions when it ends, so **upsolving happens in practice mode**. `problemsstats.solved` on the contest payload reflects in-contest submissions only, and so does `problem_status` on the per-problem endpoint — both were tried. Reading either meant a CodeChef problem solved after its contest stayed in the queue forever, which made the whole platform untrackable past contest day.

So `fetchSolvedKeys` is now user-wide, matching Codeforces' `user.status` and AtCoder's submissions feed; its `contests` argument is unused. It reads the practice page's own source, `GET /api/list/problems?group=attempted`, and keeps the rows CodeChef marks Accepted.

Four things that are easy to get wrong:

- **`status === 1` is Accepted**, from the practice bundle's own map: `{0: Unattempted, 1: Accepted, 2: Partially Correct, 3: Wrong Answer, …}`. Match that value explicitly rather than "anything but 0" — `solved` is sticky and never cleared, so a false positive hides a problem permanently while a false negative costs one refresh. `2` is Partially Correct, excluded for the same reason `partially_solved` always was.
- **`page` is zero-based.** Page 1 silently skips the first hundred rows.
- **`start_rating` must be `-1`.** A range starting at 0 drops every unrated problem — 5,519 of 21,488 survive that filter.
- **Only the attempted-problems route needs a session; the rest is public.** Measured
  anonymously: `/api/contests/START252D` answers `success` with all 8 problems, and
  `/api/contests/START252D/problems/IOI7` answers with `difficulty_rating` and `user_tags`.
  So a `🔒` on the whole platform would be wrong. What is *not* public is the one below —
  and it fails in the dangerous direction, answering `success` while ignoring the filter,
  where AtCoder's gated routes redirect to `/login` and are caught loudly. Adding a CodeChef
  contest does still require a session, but that is `establishIdentity`'s doing, not
  CodeChef's.
- **The page cap is load-bearing.** Signed out, `group=attempted` is *ignored* and the endpoint answers with the whole catalogue. If that ever happens signed in, paging to `count` would walk 21,000 rows and become exactly the sweep this client forbids — so `attemptedProblems` refuses when `count` exceeds `MAX_ATTEMPTED` rather than continuing.

Dead ends, so they are not re-investigated: the profile page's solved list carries problem **names only**, no codes or links; "Recent Activity" is AJAX from `/recent/user`, which robots.txt disallows; and the listing endpoint has **no** status filter and **no** `contest_code` filter, so "just my solved ones" and "just this contest's" are both unavailable.

## Some problems were never mirrored to practice, and can never be solved again

A contest closes to submissions when it ends, so upsolving happens at `/problems/<CODE>` — and **some older problems were never added there**. `START32C/problems/MAXTHEMIN` still renders its statement inside the contest, but `codechef.com/problems/MAXTHEMIN` 404s. There is nowhere left to submit it. Since `solved` is only ever set true, such a problem would otherwise sit in the queue forever.

`is_added_to_practice`, on each entry of the **contest** payload's `problems` map, answers this exactly, and costs nothing: `fetchContestRecord` already has that payload in hand. Verified against START32C, where it is false for MAXTHEMIN and true for the other nine, cross-checked against the route it predicts (`/api/contests/PRACTICE/problems/MAXTHEMIN` → 404, `.../VOLCONTROL` → 200).

**How common, so it need not be re-surveyed:** 13 of 327 problems (~4%) across 37 sampled contests, in 10 of them. It is an *older*-contest phenomenon — everything from START95 onwards was clean (95, 100, 105, 110, 120, 150, 180, 210, 240, 252), as were the Cook-Off and Lunchtime rounds sampled. The affected codes skew towards non-standard problems (`LEARNSQL`, `RANKLISTPAGE`, `WATESTCASES`, `ON_OFF`), which suggests SQL and interactive tasks are what the practice archive does not take — a guess from the names, not verified. Note a shared problem is flagged in every division it ran in: MAXTHEMIN is unmirrored in all four of START32 A–D.

Two neighbouring fields do **not** answer it, so they should not be tried again. `problem_url` is `/problems/MAXTHEMIN` even for the problem that 404s there — the URL lies, the boolean does not. And `is_direct_submittable` is false for *everything* when signed out, because it tracks login state rather than mirroring.

Such a problem stores `upsolvable: false`. The key is **written only when it is false**; absent means upsolvable, which is every problem on Codeforces and AtCoder, both of which serve their whole history from a stable per-contest route. This is a data flag rather than a capability, so nothing outside `platforms/codechef/` decides what makes a problem unreachable and no view branches on the platform.

Four things about it are deliberate:

- **It is dropped in `pending-problems.js`, not in each view.** That is the single choke point the queue, the platform ring and both stats histograms all run through, so they cannot disagree about what "pending" counts. `tag-service.js` is the one iterator that bypasses it — `countPendingTags` walks contests directly — so it repeats the guard by hand, or the tag bars would count problems the coverage line directly above them has excluded.
- **The contest's own expansion opts back in**, via `collectPendingProblems(contests, { includeUnupsolvable: true })`. Hiding the row there would make the contest look shorter than it is and give no clue why. It renders muted with a `⚠` whose title explains it; the wording names no platform, since `problem-row.js` is shared by all three. The mark goes **inside** the name cell — `.contest-problems` declares four columns and each compact row borrows them with `subgrid`, so a fifth child drops onto an implicit row of its own. The `~` rating flag *did* have that bug, latently, until the flag started firing on every estimated Codeforces rating and put a stray `~` on the line below most rows of a gym's expansion; it now lives inside the rating cell. `tests/problem-row.test.js` counts a compact row's children rather than checking where a mark sits, since that is the invariant and it is what catches the next one. And it **leads** the name rather than trailing it: `.compact-name` truncates with an ellipsis, so a trailing mark is clipped away for exactly the long titles that most need explaining. It shipped trailing once and was invisible on screen — "Maximize the Minim…" rendered muted with no mark and no clue why — while the test, which matched the HTML string, passed.
- **The contest is deliberately not auto-deleted.** `progress-manager.js` is untouched: an unupsolvable problem never gets `solved = true`, so `allSolved` stays false and the contest keeps its place on the Contests tab with the warned row visible. It leaves only when removed by hand. Folding the flag into `allSolved` would delete the contest and the warning with it, which is the opposite of the point.
- **`refreshPracticeFlags` (in `codechef/platform.js`) runs on every refresh, not on the weekly `publishedDataCheckedAt` stamp that `syncPublishedDifficulty` in `codechef/platform.js` next door uses**, and writes in **both** directions — a problem CodeChef later mirrors has to come back to the queue, so unlike `solved` this is not write-once. It looks **only at contests that still carry a flagged problem**, so the normal fully-mirrored queue costs nothing; reading the *contest* payload rather than the per-problem endpoint is what makes even the flagged case cheap, at one request per affected contest instead of one per affected problem. A contest with nothing flagged is deliberately never re-checked: the only thing that would find is CodeChef *removing* a problem from practice, which does not happen, and paying a request per contest per refresh to look for it would be the sweep this client exists to avoid. A failed re-check leaves the flag alone rather than clearing it — guessing a problem back into the queue on a network blip would undo the point.

**Unconfirmed, and the reason for the fast cadence:** a contest added *hours* after it ends may plausibly report every problem as unmirrored simply because CodeChef has not got to them yet — which would empty the queue for exactly the contest you most want to upsolve. It could not be reproduced: the freshest contests reachable (START252D and DSAMONDAY016, four and six days old) already reported every problem mirrored, so mirroring is evidently prompt. Re-checking every refresh means that case self-corrects on the next one rather than persisting for a week. The first add of a just-finished contest is still the proof.

A `contest.practiceSyncedAt` stamp existed briefly, so a one-time backfill could flag contests stored before this feature without re-running forever. It is gone — the one install was backfilled and its ten CodeChef contests verified against the live API, so per the no-back-compat rule at the top of the root `CLAUDE.md` the normaliser came out rather than living in the tree. **Don't reintroduce a stamp to re-check unflagged contests**; that is the sweep the cost argument above rules out. Records written during that window still carry the vestigial key, and nothing reads it.

Note the expansion's opt-in is the one part of this **no unit test reaches** — removing it leaves the whole suite green. `npm run smoke` covers it: the store seeds START252D with an unmirrored problem, and the run fails unless the queue omits it while the contest's expansion lists it with exactly one mark. Confirmed the usual way, by removing each piece and watching the run report the original symptom.
