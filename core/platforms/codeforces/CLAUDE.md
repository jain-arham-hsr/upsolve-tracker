<!-- Site notes for Codeforces (both platforms). Split out of the root CLAUDE.md, which was over
     its size limit; this file is loaded when a file in this folder is read.
     Cross-site rules stay in the root. -->
# Codeforces

One site, two registered platforms: `official/` and `gyms/`.

## Codeforces is one site with two platforms

`codeforces/official/` and `codeforces/gyms/` are the two platforms of one site. They were one
platform with two subtypes, and six modules independently asked which one they had — six
conditions that had to agree with nothing checking that they did. One had already failed that
way: `needsSync` read `contest.type !== "OFFICIAL"` on a record built before `type` was stamped on
it, so every official add silently skipped its published ratings. **The class answers that
question now**, and every one of those branches is gone.

They are genuinely different pipelines, not two flavours of one:

| | official | gym |
|---|---|---|
| roster | `contest.standings` (unsigned) | `contest.standings` (signed), or the problems page when standings are hidden |
| ratings/tags | `problemset.problems` + standings | standings only |
| field | `ratingChanges`, else sampled standings rows | standings rows, or `contest.status` parties |
| API methods | `publicContestStandings`, `contestRatingChanges`, `problemsetProblems` | `contestStandings`, `contestStatus` |
| HTML | **none at all** | none, unless the standings are hidden |

**What they share is the site, and neither platform holds any of it.** `codeforces/site.js`
is the origin, mark, host permission, rank colours and keys both classes take on;
`codeforces/api.js` is the signed client and the signing (SHA-512 over
`rand/method?sortedParams#secret`), every JSON route either platform reads, the account answers
— `identity`, `accepted`, `fromSettings` — that the base's defaults work through so neither
platform overrides an account hook, the three field readers (`officialField`, `gymField`,
`partyField`, all ending in one `partyRatings`), and the pure readers of what came back: the
applier that takes a standings response's published ratings and tags, the summariser that
rebuilds a hidden gym from its submissions, and the sampling that picks which standings rows an
official field is measured from. `codeforces/scraper.js` is the page client and the one page.
`codeforces/estimator.js` is the fit both run. Until this shape existed the two folders held
744 byte-identical lines with a test forbidding them to diverge.

Three consequences worth knowing before changing anything here:

- **The duplicated `user.status` fetch is load-bearing.** `progress-manager.js` loops
  platforms, so a refresh reads the whole account's submissions twice. The response carries
  no gym/official marker, so each platform stamps its own `solvedKey` prefix on the same
  stream and `applySolvedStatus` looks up by the prefix of the platform that *owns* the
  contest. Skip either fetch and that platform's solves stop clearing.
- **They share one request budget.** The signed client is one object in `api.js`, named
  `budget: "codeforces-api"`; without that, two instances each honouring a 2 s gap would serve
  one request per second to codeforces.com.
- **The signed API never refuses at the transport** — a bad key is a 200 with
  `status: "FAILED"` — so it goes through `site-client.js` with a direct `fetchImpl` and a
  no-op `refusal`, and `tests/platforms/codeforces/api.test.js` pins the string that is hashed, since a
  wrong `apiSig` is indistinguishable from a bad key. **One method is deliberately unsigned**:
  `publicContestStandings`, because Codeforces serves a non-gym standings only to an
  anonymous request with no extra parameters, and signing appends two. That method is also the
  one no adapter test reaches, since they all stub the service — which is how it once shipped
  calling a pacer that no longer existed. The API test now drives it through a fetch stub.

**The one page Codeforces still reads** is `/gym/<id>`, for a gym whose standings the setter
hid: it answers `FAILED` to `contest.standings`, and the problems page is the only page such
a contest renders. It is the definitive problem list — a problem nobody attempted appears in
no submission, so a list rebuilt from `contest.status` would come out silently short.
`CodeforcesScraper#problemsPage` is how that page is read, through the page client with the
session cookie and throttling tuned against the live site; `module-boundaries.test.js` pins that
`codeforces/scraper.js` makes exactly one page read and that it is not a standings page. So **an
add needs no codeforces.com tab** unless the gym's standings are hidden. Three scrapes went
before that: the official roster and its field sampling (both already in `contest.standings`),
and the gym roster (the same call was made anyway, and the API's counts overwrote the page's).
The recorded reason for the gym scrape — "a gym's roster has no API source: its standings
need signing" — did not survive checking: needing a key is not an obstacle when the key is in
hand.

## Sampling the field (`codeforces/estimator.js`)

When `contest.ratingChanges` is empty — exactly the freshly-finished contest you most want to upsolve — the participant distribution comes from the standings **rows**, which `fetchContest` already fetched for the roster and passes along in `context`. So the rows are free; what is not free is turning them into ratings, at one throttled `user.info` per 250 handles. A 15,000-entrant Div. 3 is ~60 calls where a sample of ~1,500 is seven. `stratifyRows` takes that sample.

**This used to read ~32 paginated standings pages over the throttled HTML client**, and the strata are unchanged — only the source is. Everything that went with it was a consequence of pagination rather than of sampling: the page-count sanity guard, the partial-last-page measurement, the walk-every-page fallback. A row count is authoritative, so none of them has anything left to guard against. It also removed the last Cloudflare-exposed request on the official path, and a second ~8.5 MB fetch of a response already in memory (`publicContestStandings` is not cached; only the problemset is, for 60 s).

`BLOCK` is still 50 because that is what a standings page held, and the accuracy fixtures were captured against those boundaries.

**Do not "simplify" this to a uniform random sample of pages.** It was tried and measured: standings are rank-ordered, so a page is a narrow band of near-identical ratings rather than a random slice. Sampling pages at random is cluster sampling with near-total intra-cluster correlation — 20 pages of 50 behaves like 20 draws, not 1000 — and estimates land 400–800 points off. Spreading pages evenly fixes the variance but biases estimates *downward*, because a random start offset can skip the very top of the field, and hard problems are decided almost entirely by the strongest few competitors.

What works, and what's implemented, is two strata:

- **Head** — `HEAD_PAGES` (10) read in full at scale 1. Small, but it's what rates the hard problems.
- **Tail** — `TAIL_PAGES` (20) at even intervals over the remainder, scaled by the competitors each represents.

Verified against **real** rounds captured in `tests/fixtures/real-contest-fields.json` (rank order, pre-contest ratings and in-contest solve counts, all from the API): 14 of 15 problems reproduce the full-field rating exactly, one is 100 off. Real rank/rating correlation is about -0.65, not -1, so blocks cluster less than a synthetic sorted field suggests — don't re-verify this with simulated data. Fields of 30 blocks or fewer are taken whole, since sampling would save nothing worth the precision.

**Gyms never sample, and never need to.** A gym's whole field arrives in one
`contest.standings` response and is 5–76 parties — small enough to rate outright, and far too
small to sample from. That size is also why a gym estimate is so much noisier than an official
one: the model is fitting tens of people where an official round gives it thousands.

**`tests/platforms/codeforces/estimator.sampling.test.js` measures a *model* of the sample, not the code** — `stratifiedSample`, written in that file — because that is what makes the accuracy claim checkable against a captured field. So it also asserts that `stratifyRows` reproduces that model, including *positionally*: a head that sampled the bottom 500 would match on every count and be the exact mistake this design exists to avoid. Without that, the two could drift and every accuracy test would still pass — which is precisely what was possible while production read HTML and the test sliced an array.

### Gyms whose standings Codeforces has hidden

A gym can be set to **"Standings will not be visible as original contest"**. When it is, both
halves of the acquisition path die at once: the standings page carries no `table.standings`, and
`contest.standings` answers `FAILED — "contestId: Standings are not available"`. That was terminal
— and worse than a wait, since a gym could not wait at all, so the contest never even
became a waiting entry. It now answers `notEndedYet` while running and `unavailable` when finished
with no visible field. Verified on gym 712373.

**`contest.status` still answers**, and it carries everything the standings response was mined for.
`codeforces/api.js#summariseSubmissions` derives it — pure over the submission array, so it tests
without a network stack. Against 712373's real 103 rows it reproduces the contest page exactly —
A x12, B x12, C x12, D x4, E x6, F x1 — which is the fixture `tests/fixtures/gym-standings-hidden.json`
and the thing `tests/platforms/codeforces/api.submissions.test.js` pins.

Five things there are easy to get wrong:

- **The problem list comes from the `/gym/<id>` problems page, not from the submissions.** A
  problem nobody attempted appears in no submission, so a submission-derived list silently yields a
  contest one problem short — which reads as a shorter contest, not as a failure. The problems page
  is the one page that still renders for these contests. If it can't be parsed either, the add
  refuses loudly rather than falling back to the shorter list.
- **Entering the fallback is a flag on the error, never a message match** — `error.isStandingsHidden`,
  the same idiom as `isNotPublishedYet` and `isIdentityMismatch`. And the gate is three conditions:
  gym **and** flagged **and** the problems page parses. An *official* contest with no standings
  table deliberately still throws: that is far more likely a Codeforces layout change, which
  CLAUDE.md's rules say must fail loudly rather than be routed around. `tests/platforms/codeforces/gyms/platform.test.js`
  is mostly about what the branch must *not* touch; it stubs the service to throw if a healthy gym
  ever reaches `contestStatus`.
- **Practice submissions are excluded, and that is what makes the counts right.** A gym closes when
  it ends, so practice solves say nothing about how hard a problem was during it — and the estimator
  is fitted to exactly that quantity. Including them breaks 8 of the 12 derivation tests. Ghost
  parties are excluded too, matching the standings path, and a party is counted once per problem
  however many times it resubmits.
- **`participantTypes` matches `contestStandings`' `CONTESTANT,VIRTUAL`** so both gym paths mean
  the same thing by a "solve". 712373 happens to have no virtual entrants, so that choice is
  unexercised there.
- **With no official submissions at all, `solveCountsRead` is false.** All-zero counts are
  indistinguishable from "nobody solved anything", and handing those to the estimator floors every
  problem at 800 (`codeforces/estimator.js`, the floor and zero-solve target) rather than refusing.

The field is recovered from who submitted, through `api.js#partyField`. Everything below
the handles — `user.info` chunking, `teamRating`, the strata shape — is shared with the
standings path via `partyRatings` so the two cannot drift. Note this field is **narrower** than a
standings one: it sees only parties that submitted at least once. A party that entered and
submitted nothing solved nothing either, so the counts stay consistent with it, but the field skews
strong.

That matters less than it sounds here, because this path **takes the difficulty Codeforces
publishes on the problem** (`submission.problem.rating`, stored `ratingSource: "official"`) and
only estimates what is left. For 712373 that is all six problems, so the estimator never runs — which
is just as well, since at 12 parties it has almost no signal. Note the *visible*-gym path is
deliberately unchanged and still estimates everything, even though `standings.problems[].rating`
carries the same number; changing that would alter contests that already add successfully.

**The problems page names the contest somewhere else**, and reusing
`findContestName` there is wrong: that page has no `.contest-name`, and its first `.caption` is the
"→ About Contest" sidebox heading — so the first real add filed the contest in the queue under the
name "→ About Contest". The name is the sidebar contest box's header link
(`#sidebar .rtable th a`, whose href is the contest root), which is not a `.caption` at all.
`findContestNameOnProblemsPage` is separate from `findContestName` for that reason, and
`tests/platforms/codeforces/scraper.problems-page.test.js` keeps the real sidebar markup plus a test asserting that the
*standings* chain still returns "→ About Contest" on it — which is what makes the split legible.
Note the name is read once at add time and never re-read, so a contest added under the wrong name
keeps it until removed and re-added.

Both halves are now confirmed against the live site: `contest.status` against the API, and the
problems-page parser by a real add of 712373, which found all six problems with correct indices and
names. `curl` still gets a 403 from this machine (see below), so the tests remain synthetic apart
from the captured sidebar markup.

## You cannot fetch Codeforces HTML from a dev machine

`codeforces.com/contest/<id>/standings` answers a plain `curl`/`fetch` with a Cloudflare interstitial — HTTP 403, `cf-mitigated: challenge`, and a "Just a moment" body. **Don't burn time on headers**: sending a browser-like `Accept: text/html` was measured and changes nothing, and `Sec-Fetch-*`, `Origin` and `User-Agent` are forbidden for JS to set, so a fetch cannot be made to resemble a navigation. The response demands things a fetch structurally cannot supply — executing the challenge scripts, and the `Critical-CH` client-hint retry, both of which only navigations do. The API (`codeforces.com/api/*`) is unaffected and answers fine.

**This file used to claim the extension "only gets through because it runs inside a browser with a real session." That was wrong**, and measurement showed it: the panel's requests were never authenticated at all. They worked only because Codeforces was not challenging anonymous traffic, and began failing the moment that changed — no code change was involved, and `git log` confirms it, the last commit touching that path predating the last successful add by four days. See **Requests go through a page, not from the panel**, in the root `CLAUDE.md`, for the measurement and what it forced.

The consequence is that the HTML half of the pipeline is verified against synthetic markup (`tests/platforms/codeforces/gyms/platform.test.js`, `tests/platforms/codeforces/scraper.problems-page.test.js`) and against real *data* pulled via the API (`tests/fixtures/`), but never against a live page. If a selector assumption is wrong, the failure modes are deliberately safe rather than silent: a problems page the parser does not recognise — no table, or a row with no index — returns null and the add refuses loudly, and an unreadable contest name falls back to `Contest <id>`. The residual risk is a refused add, never a wrong rating. Adding a hidden-standings gym in the real extension is the only way to confirm it, and one has been (712373).

## Scraped markup is quarantined in `codeforces/scraper.js`

Every CSS selector and parsing rule for Codeforces' HTML lives in that file — today one page, parsed by `parseProblemsPage`, with its selectors in one block above it and ordered fallback chains (the contest name tries the sidebar header link, then `<title>`). A CF layout change should be a one-block fix.

**Its parser was called `standings-dom.js` for a long time after the standings scrape was deleted**, holding no standings parsing at all, and nothing caught it because nothing tied a parser's name to the page it reads. That is the whole argument for naming a `parse*` function after its page: the name is what makes the next such drift visible.

**A scraper returns `null`, never a plausible default.** This is the important invariant. The old code left solve counts at `0` when the totals row went missing and `parseInt(...) || 0` turned an unparseable cell into a zero — so a markup change didn't break anything visibly, it produced *confidently wrong ratings* that were stored and sorted like real ones. Returning `null` forces the caller to decide.

`contest-manager.js` makes that decision as late as possible: it only refuses when unreadable counts actually matter, i.e. when some problem has no published rating to fall back on. A rated official contest doesn't need the totals row at all.

## Tags and published ratings

Both come from **`contest.standings`**, applied by `codeforces/api.js#applyStandingsProblemData` (`tag-service.js` now only counts tags for the stats view). Ratings are preferred over estimates — same quantity, measured rather than inferred — and `problem.ratingSource` records `"official"` or `"estimated"`. Because CF publishes ratings days after a round, a contest added right after it ends starts estimated and settles on a later refresh.

`problemset.problems` returns all **~11k problems in one request** (~2 MB, memoised 60 s),
which is what makes it a cheap readiness gate and a tempting difficulty source.

**`problemset.problems` is not the source, and the reason is easy to miss.** It lists each
problem *once*, under the contest it originated in — so a shared Div. 1 / Div. 2 problem is
filed under Div. 1 only. Round 1079's Div. 2 (2197) lists just A and B; C–F live under 2196
with Div. 1 indices. Matching on `contestId-index` finds nothing for them, so the estimator
rates problems Codeforces has already rated — measured on 2197, D stored 1500 against a
published 1600 and E2 stored 2100 against 2000. It is not usable as a *roster* either, for the
same reason: filtering it by contest id would store a contest several problems short, and a
short contest reads as a small contest rather than as a fault.

**It is not rare.** Of 936 finished Div. 2 rounds, 282 have exactly two problems in the
problemset and 330 have three or fewer, against five to seven for a standalone round — a
bimodal distribution whose spike at two is the paired-round signature. So for roughly a third
of Div. 2 rounds the problemset can never supply most of the ratings, and a re-check reading
it would leave those estimated permanently while re-fetching them every week forever.

The two sources do **not** differ in timing, which is worth recording so it is not re-tested:
sampled at the same moment, a round unrated in one is unrated in the other, and a rated one
carries identical values in both. The difference is coverage alone.

`contest.standings` reports a shared problem's rating under *this* contest's index, because a
rating belongs to the problem rather than the contest. Four things about that call:

- **It must not be signed.** Codeforces serves a non-gym standings only to *"anonymous GET
  requests with no extra parameters"*, and the signed call always appends `apiKey` and `time`.
  A signed request is refused with that exact complaint independently of key validity — so
  `publicContestStandings` is a bare GET on purpose. Signing it would break it, which is
  why the comment there is long.
- **It cannot be trimmed.** `count`, `from`, `handles`, `showUnofficial` and
  `participantTypes` are all rejected by the same rule, verified across five contests. ~8.5 MB
  buys seven problem objects out of eleven thousand rows. Read and drop it; never retain it.
- **Nothing cheaper exists — this was searched for, not assumed.** No API field links the
  paired contests (a problem carries only `contestId, index, name, type, points, tags,
  rating`; a contest only `id, name, type, phase, frozen, duration/start/relativeTimeSeconds`).
  Nor does the HTML: the contest page, the problem statement and the standings page never
  mention the twin's id. Matching on start time is unsound — 13% of same-start groups are
  unrelated contests, including ICPC problem sets — and matching on problem name is unsound
  too, since contest 100 also has a "Friendly Numbers".
- **Failure is soft on the add.** The estimator covers whatever the call did not, so losing
  it costs accuracy rather than the contest. On the re-check it is softer still: the stamp is
  written only on success, so a failed call is retried on the next refresh instead of waiting
  out another week.

The same rule had left a dead fallback: `estimator.js` answered an empty `ratingChanges` by
calling `readField` on an official contest, which signs — so it was refused every
time, leaving the field empty. It now fetches unsigned and hands the payload over.

The tag source differs by contest type:

- **Official** — the same `contest.standings` response the roster comes from, so tags and ratings arrive together and the add pays for one call rather than two. `problemset.problems` is still fetched, but only as the readiness gate (`official/platform.js`'s `inProblemset`), where one ~2 MB request memoised for 60 s answers "has Codeforces published this contest at all" for every contest at once.
- **Gym** — absent from the problemset entirely. Tags *and the published rating* are lifted from the `problems` array of the standings response that adding a gym already fetches (`codeforces/api.js#applyStandingsProblemData`). Tags are usually empty, since gyms sit outside CF's taxonomy — but **about a third of gym problems carry a `rating`**, and taking it is not optional decoration.

  Those are problems the setter picked from the CF archive rather than preparing in Polygon, so CF still recognises them and serves its own number; problems written for the contest have none and are estimated as before. Measured over the 62 stored gym problems CF also rates, the estimate was a mean **211** off with 14 out by 400+, so ignoring the published value — which this code did until it was noticed — actively mis-sorted the queue. A one-time correction of the affected install was applied through Import rather than left as a normaliser, per the no-back-compat rule at the top of the root `CLAUDE.md`.

  **Don't add a recurring gym re-check.** A gym rating is inherited from an already-rated archive problem, so unlike CF's editable tags it never appears later. Re-checking would cost one `contest.standings` per gym per refresh forever, and the gyms with no rated problems would never resolve — the same sweep the CodeChef practice-flag section argues against.

  Note this shrinks the unrated set `estimateMissing` sees, so a fully-rated gym skips the estimator entirely.

  **That duplicate `contest.standings` fetch is gone.** `CodeforcesGyms#fetchContest` fetches the response to count gym solves and keeps it; `fetchContest` carries it in `context` and `CodeforcesGyms#readField` measures the field from it rather than fetching again. It is passed, never stored — the built contest is what reaches `chrome.storage`, and a whole gym's field has no business there. Two things worth knowing before assuming it applied more widely: the official field reads `ratingChanges` first and falls back to the same carried response; and the hidden-standings path has no such response to pass, so it still fetches. `tests/platforms/codeforces/platform.test.js` counts the calls, because nothing about a correct rating says how many requests produced it — this could otherwise regress silently forever.

  Worth knowing before trusting the number: a setter *can* keep the rating and replace the statement — CF supports it directly ([Rewrite Statements in Mashups](https://codeforces.com/blog/entry/84795)), to stop trainees googling the editorial. The official test set is unchanged and the form warns when the formulas differ, so the rating still describes the problem being judged; the residual risk is a rewrite that quietly strips a hint. Of the 62, 55 match exactly one archive problem by name with an identical rating and zero disagreements, and a re-*upload* of a rated contest inherits nothing at all (gym 100001 has no ratings and its problem name drifted to "Spreadsheets").

### The re-check stops after six weeks

`syncPublishedData` in `codeforces/official/platform.js` re-asks `contest.standings` for a contest that still has a
problem without an official rating or without tags — at most weekly, and **only
until six weeks after the round ran**.

The cutoff is what makes it terminate, and it is the part worth not undoing. A
round Codeforces will never rate — an ICPC challenge, a Kotlin Heroes practice
round, the H-series of a marathon — stays incomplete by definition, so without a
cutoff it is re-fetched every week for the life of the queue, at 6.5–8.5 MB a time —
the response scales with turnout, so the figure quoted elsewhere in this file varies for
that reason rather than through disagreement.
That is the same sweep the CodeChef practice-flag and gym-recheck sections argue
against, arrived at from a different direction.

Three details are deliberate:

- **It is measured from `contest.startTimeSeconds`, not from the last check or
  the add.** A stamp that moves every time we look can never bound anything; the
  run date is fixed, so a contest provably leaves the rotation and never
  re-enters it. `addedAt` is the fallback when the start time is null, since a
  contest that cannot be dated is better bounded by something than by nothing.
- **`startTimeSeconds` is epoch *seconds* while every other stamp on a record is
  milliseconds.** Comparing them directly is off by a factor of 1000 and dates
  every contest to 1970, which silently puts the whole queue past the cutoff and
  disables the re-check entirely — a failure with no symptom except ratings that
  quietly stop converging. `tests/platforms/codeforces/official/platform.test.js` pins it.
- **There is no per-refresh cap**, unlike AtCoder's `syncMetadata`, and that is a
  decision rather than an omission. A cap interacts badly with the cutoff: with
  several stale contests and an infrequent refresher, a capped rotation gives
  each contest one look every few refreshes, and one that loses that race ages
  past six weeks *before* it ever converged — causing the exact failure the
  re-check exists to prevent. The weekly gate and the six-week window bound the
  work between them, and the steady state is small, since only a round added
  within days of running is stale at all.

The add does **not** run this pass. `fetchContest` has already applied every
rating and tag the standings carry, so calling it again would re-fetch the same
~6.5 MB response to learn nothing — which is why the add stamps
`publishedDataCheckedAt: Date.now()` rather than `null`.

`contest.publishedDataCheckedAt` records *when* the platform was last asked for what it publishes, which is what distinguishes "not fetched yet" from "genuinely untagged" — without it, contests whose problems have no tags would be re-requested forever.

**Two different things leave a problem unrated, and only one of them is real.** A problem
shared with the paired division is filed under *that* division and simply is not listed under
this contest — its rating exists, and `contest.standings` reports it under this contest's own
index. Separately, **283 of the ~11k problemset entries (about 2.5%) are listed with no rating
at all**, which is the genuine case and the only one the estimator should ever see. Conflating
them is what made the old problemset-based re-check look like it was doing something.

CF tags are editable after publication, so a problem can gain tags days later — about 1.6% of the problemset is untagged at any time. `syncPublishedData` in `codeforces/platform.js` therefore re-checks a contest that still has bare problems, but only once a week, and only until the round is six weeks old; a contest where every problem is tagged and officially rated is never re-requested. It runs from the refresh only — the add has already applied whatever the standings carry — and costs one `contest.standings` (~6.5 MB) per stale contest, which the weekly gate and the cutoff bound between them.
