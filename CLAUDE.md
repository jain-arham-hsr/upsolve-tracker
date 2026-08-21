# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The extension is **Upsolve Tracker**; the repo and directory were renamed to match. It covers Codeforces, AtCoder and CodeChef. Internal identifiers were deliberately *not* renamed: storage keys keep the `cf_trainer.*` prefix and custom elements the `cf-` prefix, because renaming them means migrating live user data for no visible benefit and a failed migration silently loses someone's queue. `BACKUP_FILENAME` **did** change, to `upsolve_tracker_backup.json`, but only because the stranding problem is handled rather than accepted: writing to a new name would otherwise leave `cf_trainer_backup.json` in the export directory, frozen at the moment of the rename and looking like a perfectly good backup. `writeBackup()` deletes it — *after* the new file is on disk, never before, so a failed write can never leave the directory with no backup at all. A missing legacy file is the normal case for anyone who set up auto-export after the rename and is not treated as an error. `tests/auto-export.test.js` pins all three cases.

## Commands

```bash
npm install
npm run dev:chrome      # Vite dev server (port 5173, strictPort) + CRXJS HMR
npm run build:chrome    # -> dist/chrome
```

```bash
npm test                # node --test over tests/ — no framework, no browser
```

`npm test` covers the parts that fail *silently*: the estimator's maths, the standings parsing, the sampling arithmetic (via `scraping-service.test.js`, which stubs `HttpClient` so no network is touched), backup validation and queue ordering. UI wiring has no coverage — verify that manually by building and loading `dist/chrome` unpacked at `chrome://extensions` (Developer mode → Load unpacked). There is no linter or formatter configured.

`tests/sampling.test.js` deliberately asserts that uniformly random page sampling is *worse* than the stratified design, so the rejected approach can't quietly come back.

`tests/estimator-accuracy.test.js` records a **known bias**: estimates run below Codeforces' published ratings, by up to ~300 on the hardest problems. The Elo model assumes everyone attempted every problem, when most never open the hard ones — non-attempts read as difficulty-driven failures, so the model over-predicts solves and the search settles too low. Fixing it means modelling attempts, not ability. It matters less now that official problems take CF's published rating when one exists, leaving the estimator to gyms and contests too fresh to be rated.

The build is still target-parameterized (`TARGET` selects `targets/<name>/manifest.json` and `dist/<name>`), but only `chrome` exists — the previous `dev:firefox` / `build:firefox` scripts were removed because they failed at config load. A real Firefox target needs more than a manifest: `targets/chrome/` depends on `chrome.sidePanel`, which Firefox answers with `sidebar_action`, and CRXJS emits a Chrome-style service-worker loader. Everything under `core/` already sticks to APIs both browsers implement.

Pushing to `main` triggers `.github/workflows/release.yaml`: it builds Chrome, reads the version from `targets/chrome/manifest.json`, **deletes any existing release/tag with that version**, and republishes. Bump the manifest version when you want a distinct release; leaving it unchanged silently replaces the previous one.

## Build model

`vite.config.js` reads `targets/$TARGET/manifest.json` and hands it to `@crxjs/vite-plugin`, outputting to `dist/$TARGET`. Consequences:

- The manifest is the entry-point graph. HTML entries (`side_panel.default_path`, `options_ui.page`) and the service worker point at **source** paths (`core/ui/index.html`, `targets/chrome/background.js`); CRXJS crawls and rewrites them. A new page must be registered in the manifest to be built.
- `@core` aliases to `core/`, though most existing imports use relative paths.
- `core/` is target-agnostic business logic; `targets/<browser>/` holds only the manifest and background worker. Keep browser-specific glue in `targets/`.
- `linkedom` is a devDependency used only by the tests (`standings-dom.test.js`, `scraping-service.test.js`) to parse HTML in Node; shipped code uses the browser's `DOMParser`.

## Architecture

Vanilla ES modules and custom elements — no framework, no bundled UI library.

### Platform registry

`core/platforms/registry.js` owns which sites exist; `core/platforms/codeforces.js` is the only descriptor so far. A descriptor answers everything that depends on *where a contest came from*: `matchUrl`, `contestUrl`, `problemUrl`, `sourceLabel`, `contestLabel`, `solvedKey`, `problemKey`, and a `capabilities` block. Nothing outside `core/platforms/` should branch on the platform.

This replaced two copies of the same Codeforces URL regex (`contest-manager.js` and `contest-list.js`) and three hardcoded `https://codeforces.com` origins, so a URL change is now one edit.

Two conventions the registry depends on:

- **Records written before platforms existed carry no `platform` field and read as Codeforces.** That fallback *is* the migration — `platformOf()` and `contestKey()` both default, so nothing has to be rewritten on disk. A `platform` that is present but unrecognised throws instead of defaulting, because that means data from a newer build.
- **A contest may also carry `sourceId`** — the id the user navigated from, when it differs from the one stored. CodeChef parent contests resolve to a division, so `/START252` is stored as `START252D`; `findTrackedContest()` matches either, without which the add banner offers to add an already-tracked contest.
- **Contest identity is `platform:id`, never the bare id** (`contestKey`). Codeforces contest 1000 and a CodeChef contest "1000" are different contests; keying on the number alone would have one silently overwrite the other in `LocalDB.addTrackedContest`. `LocalDB.removeTrackedContest` takes `(platformId, contestId)` for the same reason.

`capabilities.allowsPartialRatings` decides whether a contest may be stored with some problems still unrated. Codeforces sets it **false** — the estimator fills every gap there, so a hole means something broke and `contest-manager.js` refuses loudly. Platforms that publish their own difficulty set it true and let unrated problems converge on a later refresh. This is *not* the default-1500 fallback the comments elsewhere warn about: those problems store `rating: null` and render as "???" rather than getting a fabricated number.

### Whose data is this? (`services/platform-identity.js`)

**Every platform has a handle you enter in Settings, and that handle is the authority.** Nothing that writes `solved`, or sets a rating the queue orders by, runs without one — and **a contest cannot be added for a platform whose handle is missing**, because it would store unmarked, its solved problems would never clear, and it would look like the sync was merely slow.

Adapters check it through `verifyIdentity(session)`, which returns `{username, rating}` or throws, before any user-specific read — on the refresh **and** the add path, since adding a CodeChef contest reads `problemsstats` too. Verification is free: the same call already fetched the rating. Codeforces uses `user.info`, AtCoder the profile page, CodeChef the bootstrap object `createSession` already read.

The check differs by how each platform is addressed:

- **Codeforces and AtCoder are asked *about* a handle**, so who is signed into those sites is irrelevant and verification only confirms the handle exists. That matters more than it sounds: `user.status?handle=X` returns X's submissions no matter whose key signs the request, so an unchecked handle silently yields somebody else's history. Codeforces' canonical casing is taken from the API, so `Tourist` over `tourist` is not read as a change.
- **CodeChef answers for whoever holds the session cookie**, so the configured handle is additionally compared against the signed-in account. A mismatch throws with **`isIdentityMismatch`** and callers must always stop — `solved` is only ever set true, fully-solved contests are deleted outright, and `writeBackup()` runs after the sync, so one sync under another account permanently corrupts the queue *and* overwrites the backup with the corruption.

`services/platform-identity.js` answers the one remaining question: **has that handle changed since the solved flags were derived?** If so they belong to the previous account and are cleared, for that platform only, so the next sync re-derives them. That restores what this file already claims — solved state derived fresh each sync rather than cached — which the stickiness had quietly made false. Contests already deleted for being fully solved cannot come back.

`updateSolvedStatus` returns `{removed, failures}` rather than a bare array. **Failures are surfaced, not just logged**: a silent refusal looks the same to the user as a silent corruption. The shell reports them **last**, after the backup write and the view refresh — reporting earlier let `"Writing backup…"` overwrite the message for exactly the users whose backup was at risk.

Note the Codeforces scrape sends cookies (`http-client.js:32`), but `standings-dom.js` reads only the contest name, problems, *competitors'* handles, solve counts and pagination — nothing about the viewer. So it needs no identity, and neither do the public bulk endpoints or kenkoooo's static files.

### Platform adapters

The registry is *pure* — URLs, identity, capabilities — so anything can import it. Network work lives behind an **adapter**, resolved by `core/platforms/adapters.js`. The split is deliberate: `backup-validation.js` imports the registry, and must not drag the network stack in with it.

A platform adapter exports four things:

- `createSession()` — loads whatever that site needs to authenticate. Codeforces wants a key pair and a handle; AtCoder will want only a handle; CodeChef reads both from the page. **The orchestrator never sees a credential.**
- `fetchContestRecord({contestId, subtype, session, onProgress})` — the entire acquisition pipeline behind one call, returning a stored-shape contest whose problems all carry `rating`, `ratingSource`, `tags` and `officialSolves`.
- `fetchSolvedKeys(session, onProgress)` — a Set of `platform.solvedKey(...)` values.
- `syncMetadata(session, contests, onProgress)` — optional; fills in data that only arrives later.

`contest-manager.js` is now just the orchestrator: match the URL, pick the adapter, mark solved, decide whether the record is complete enough to store. Everything Codeforces-specific — the signed API, the standings scrape, the Elo estimator — sits in `core/platforms/codeforces/adapter.js`. Adding a platform means writing one adapter, not editing the orchestrator.

`progress-manager.js#updateSolvedStatus()` loops over every platform with tracked contests, **isolating failures**: one site being down or unconfigured must not stop the others, and if *every* platform fails it returns before the write so a bad sync can't touch storage. `applySolvedStatus()` is split out and pure because it's the step that fails quietly.

Two invariants there:

- **`solved` is only ever set true, never cleared.** That stickiness is load-bearing. CodeChef answers a logged-out request with an *empty* solved list rather than an error, and clearing on that would resurrect every finished problem.
- **`solvedKey` is namespaced by platform** (`codeforces:2193-A`). One `Set` holds solved history from every site, so a bare `contestId-index` would let two platforms sharing a contest number mark each other's problems solved.

Note every relative import must carry its `.js` extension. Vite resolves extensionless paths, Node does not — three of them had been sitting in `get-prob-stats.js`, `get-rating-distribution.js` and `options.js`, invisible until a test imported that part of the graph.

`backup-validation.js` deliberately does **not** require `platform` — every backup written before this change lacks it — but does refuse a backup naming a platform this build doesn't know, since that would otherwise throw later while rendering the list.

### AtCoder

`core/platforms/atcoder/`. Far smaller than the Codeforces adapter, because AtCoder Problems (kenkoooo) publishes difficulty directly — **there is no scrape, no participant sampling and no estimator on this path**. Four static JSON files plus a submissions endpoint cover everything. AtCoder needs no key or secret, only a handle (`cf_trainer.atcoder_handle`), and only to read solved history.

Four things that are easy to get wrong:

- **`contest-problem.json` is not optional.** 1,906 of 9,383 problems belong to more than one contest, and `problems.json` records only the one a problem debuted in. Reading it alone under-reports a rerun badly — one daily-training round lists 4 problems instead of 9. Verified live.
- **Difficulty is unbounded below.** 1,772 rated problems sit under 800 and 931 are negative; ABC 471's A is −817. Nothing on this path may apply the estimator's `Math.max(800, …)` floor. (`-10000` appears once, for `agc010_a` — a single fitting artifact, not a sentinel, so it needs no guard.)
- **A problem's identity is its task id**, not contest + index, so `solvedKey` and `problemKey` are both `atcoder:<task_id>`. Solving a problem in its original contest clears it from every rerun too.
- **Difficulty arrives only once a problem has run in a rated contest.** ABC/ARC/AGC are 92–99% covered, but a round added the evening it ends may have gaps, and unrated contests (`awc*`) never get models at all. Hence `allowsPartialRatings: true`: those problems store `rating: null`, render as "???" and are re-checked on every refresh. That re-check is free — `problem-models.json` is already fetched and cached.

`problems-api.js` caches the four resources **in memory**, not in `chrome.storage.local`: they total ~5 MB parsed, against a 10 MB quota the queue itself needs. Requests are spaced ≥1 s per kenkoooo's published etiquette, and queue behind one another through a promise chain — checking a timestamp per call looks equivalent but lets concurrent requests all wait the same interval and then fire together, which is the exact burst the spacing exists to prevent.

Submission paging is the other sharp edge. The endpoint returns at most 500 rows, and both failure modes are silent: stopping at the first full page leaves solved problems in the queue forever, while advancing the cursor *past* the newest timestamp skips every submission sharing that second. So the cursor moves **to** the newest timestamp, the overlapping row is deduplicated by id, and the loop stops when a page brings nothing new. Note the documented `atcoder-api/results?user=` endpoint **404s** — it was retired in favour of the v3 route.

### CodeChef

`core/platforms/codechef/`. No estimator here either: CodeChef publishes `difficulty_rating` and does so promptly — Starters 252 was fully rated within two days of running. `/api/rankings/` is CSRF-gated and returns 403, but nothing needs it.

CodeChef's public API was retired years ago and the site is an SPA, so the only route to its data is the same `/api/` endpoints the front end calls. **Its ToS §14 forbids crawling**, which is why `api.js` is written to be strictly user-session shaped: only the contest the user is looking at and its problems, `/api/` paths only (robots.txt disallows `/problems/*` and `/status/*`), no catalogue sweep, and a 403 stops and surfaces an error rather than retrying. `/api/list/problems` exists and must never be called in a loop.

Four traps, all confirmed against the live API:

- **`problemsstats.solved` changes type.** Signed out it is an empty **array**; signed in it is an **object** keyed by problem code. Array methods silently see nothing on the shape that actually carries data, so read it with `Object.keys`.
- **Signed out looks identical to "solved nothing."** `fetchSolvedKeys` therefore refuses outright when `signedIn` is false, so `progress-manager` isolates the failure and leaves existing flags alone. This is the case the stickiness invariant exists for.
- **Two out-of-band difficulty values**, both arriving as strings: `-1` for unrated (74% of the catalogue) and `9999`. Both become null. `9999` is the dangerous one — it is also the queue's own sort-last sentinel, so passing it through would read as a legitimate, very hard problem.
- **`/START252` is a parent contest** with an empty problem list and no error. Divisions are rating-banded, so the user's own rating (from `codeChefUserData`) selects the one they competed in; with no known rating it names the divisions rather than guessing.

Costs one request for the contest plus **one per problem** — difficulty and tags appear on no bulk or contest-level response, signed in or not. That is ~9 for a Starters division, still fewer than a Codeforces add. Tags mix real topics with the setter's handle and the contest code (`['combinatorics','raysh07_adm','start252','trees']`), so `cleanTags` strips both.

`page-data.js` is the CodeChef equivalent of `standings-dom.js`: the one place that parses its markup, extracting `window.codeChefUserData` by **balanced-brace slicing** — a non-greedy regex stops at the first `};` inside a nested object or a string. It returns `null`, never a default: a guessed handle would look like a signed-in session.

Note `solvedKey` is `codechef:<problem_code>`. The same problem runs in every division of a Starters, so solving it in Div 4 clears it from a tracked Div 3.

### Data acquisition on Codeforces: two channels, both required

1. **Signed API** (`core/services/codeforces-service.js`) — builds the `apiSig` (SHA-512 over `rand/method?sortedParams#secret`) via `crypto.subtle`. Used for `user.status`, `contest.ratingChanges`, `contest.standings`, `user.info`.
2. **HTML scraping** (`core/services/scraping-service.js` → `core/services/http-client.js`, parsing in `core/services/standings-dom.js`) — the standings page is the only source for problem names/URLs and official in-contest solve counts. `problemStatistics.solvedCount` is *not* a substitute: it counts all-time solves including practice, which the estimator can't use.

Each platform paces its own requests through `services/request-pacer.js`, so their budgets are independent — `HttpClient`'s counter is a single static shared by everything. `HttpClient.get` deliberately throttles: 1–2.5 s jitter before *every* request and a 6–12 s cooldown every 15 requests, with `credentials: "include"` so the user's Codeforces session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error. Even sampled, adding a contest issues tens of requests, so these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing.

### Rating estimation pipeline

`core/contest-manager.js#processNewContest(url)` is the orchestrator. Given a `/contest/<id>` or `/gym/<id>` URL:

1. `get-prob-stats.js` — scrape problems from the standings header row. Official contests read solve counts from the "Accepted" totals row; gyms instead count `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties. Returns `solveCountsRead`, which is false when the totals row wouldn't parse.
2. `problemset-sync.js` — apply Codeforces' published ratings and tags. Anything rated here needs no estimate, which is why this runs *before* the expensive steps. Only now, knowing what still needs estimating, does `contest-manager` refuse an unreadable totals row — and only if some problem has no published rating to fall back on.
3. `get-rating-distribution.js` — produce the participant rating distribution, as **strata**: `{ strata: [{ ratings, scale }] }`, where `scale` is how many real competitors one read competitor stands for. Official: `contest.ratingChanges` `oldRating`s at scale 1; if empty, fall back to sampling the standings (below). Gym/ICPC: build from `contest.standings`, collapsing each team into one effective rating via `computeTeamRating` (binary search for R where the product of per-member loss probabilities is 0.5).
4. `rating-estimator.js` — binary-search the rating R whose Elo-expected solve count, summed over the strata and weighted by each one's scale, matches actual solves; round to the nearest 100, floor 800. Zero solves targets 0.5 expected solves rather than 0.
5. Mark already-solved problems from `user.status`, then **store only if every problem got a rating** — a partial result throws instead of persisting. There is intentionally no default-1500 fallback (see the comments in `contest-manager.js`); reintroducing one would silently corrupt the queue's sort order.

### Sampling the field (`scraping-service.js`)

When `contest.ratingChanges` is empty — which is exactly the freshly-finished contest you most want to upsolve — the participant distribution has to come from the standings pages. Reading all of them costs one throttled request per 50 competitors, so a big round ran to hundreds of requests. `sampleParticipantHandles` reads ~32 instead, regardless of turnout.

**Do not "simplify" this to a uniform random sample of pages.** It was tried and measured: standings are rank-ordered, so a page is a narrow band of near-identical ratings rather than a random slice. Sampling pages at random is cluster sampling with near-total intra-cluster correlation — 20 pages of 50 behaves like 20 draws, not 1000 — and estimates land 400–800 points off. Spreading pages evenly fixes the variance but biases estimates *downward*, because a random start offset can skip the very top of the field, and hard problems are decided almost entirely by the strongest few competitors.

What works, and what's implemented, is two strata:

- **Head** — `HEAD_PAGES` (10) read in full at scale 1. Small, but it's what rates the hard problems.
- **Tail** — `TAIL_PAGES` (20) at even intervals over the remainder, scaled by the competitors each represents.

Verified against **real** rounds captured in `tests/fixtures/real-contest-fields.json` (rank order, pre-contest ratings and in-contest solve counts, all from the API): 14 of 15 problems reproduce the full-field rating exactly, one is 100 off. Real rank/rating correlation is about -0.65, not -1, so pages cluster less than a synthetic sorted field suggests — don't re-verify this with simulated data. Contests of 30 pages or fewer are still read whole, since sampling would cost the same. The last page is confirmed to actually be last before its number is used to size the field — a wrong count would undercount the field and skew every rating.

### You cannot fetch Codeforces HTML from a dev machine

`codeforces.com/contest/<id>/standings` answers a plain `curl`/`fetch` with a Cloudflare interstitial — HTTP 403 and a "Just a moment" body — regardless of User-Agent headers. Browser-like headers don't help; the extension only gets through because it runs inside a browser with a real session. **Don't burn time trying**; the API (`codeforces.com/api/*`) is unaffected and answers fine.

The consequence is that the HTML half of the pipeline is verified against synthetic markup (`tests/scraping-service.test.js`) and against real *data* pulled via the API (`tests/fixtures/`), but never against a live standings page. If a selector assumption is wrong, the failure modes are deliberately safe rather than silent: an understated page count either takes the walk-every-page branch or trips the `hasPageLink` guard (slow but correct), a missing contest name falls back to `Contest <id>`, and an unreadable totals row refuses loudly. The residual risk is a slow add, not a wrong rating. Adding a just-finished contest in the real extension is the only way to confirm it.

### Scraped markup is quarantined in `services/standings-dom.js`

Every CSS selector and parsing rule for Codeforces' HTML lives in that one file, with ordered fallback chains (contest name tries `.contest-name`, then `.caption`, then `<title>`). A CF layout change should be a one-file fix.

**Extractors return `null`, never a plausible default.** This is the important invariant. The old code left solve counts at `0` when the totals row went missing and `parseInt(...) || 0` turned an unparseable cell into a zero — so a markup change didn't break anything visibly, it produced *confidently wrong ratings* that were stored and sorted like real ones. Returning `null` forces the caller to decide.

`contest-manager.js` makes that decision as late as possible: it only refuses when unreadable counts actually matter, i.e. when some problem has no published rating to fall back on. A rated official contest doesn't need the totals row at all.

### Tags and published ratings

Both come from `problemset.problems` via `problemset-sync.js` (`tag-service.js` now only counts tags for the stats view). Ratings are preferred over estimates — same quantity, measured rather than inferred — and `problem.ratingSource` records `"official"` or `"estimated"`. Because CF publishes ratings days after a round, the weekly re-check means estimates converge to real ratings over time; a contest added right after it ends starts estimated and settles.

The tag source differs by contest type:

- **Official** — `problemset.problems`, one ~2 MB request covering all ~11k problems, keyed by `contestId-index`. The per-contest alternative (`contest.standings`) also returns tags but embeds every participant row — ~12 MB for one Div. 3 — so it must not be used in a loop. Note this endpoint rejects `from`/`count` for non-gym contests; it only answers anonymous parameter-less GETs.
- **Gym** — absent from the problemset entirely. Tags are lifted from the `problems` array of the standings response that adding a gym already fetches, and are usually empty since gyms sit outside CF's taxonomy.

`contest.tagsSyncedAt` records *when* the problemset was last consulted, which is what distinguishes "not fetched yet" from "genuinely untagged" — without it, contests whose problems have no tags would be re-requested forever. Records written before this field existed carry a `tagsSynced` boolean instead and are read as "synced long ago".

CF tags are editable after publication, so a problem can gain tags days later — about 1.6% of the problemset is untagged at any time. `syncOfficialProblemData` therefore re-checks a contest that still has bare problems, but only once a week; contests where every problem is tagged are never re-requested. It runs at add time and from the refresh, and costs at most one request per sync regardless of how many contests are stale.

### Start times

`start-time-service.js` fills `contest.startTimeSeconds`, which orders the contest list. Contest IDs are *not* chronological (2205 ran a day before 2200), so sorting by ID is not a substitute.

- **Official** — `contest.list`, one ~400 KB request. A finished contest's start time never changes, so unlike tags there's no re-check: a contest is asked about once and only if the field is missing.
- **Gym** — `contest.list?gym=true`, but private gyms and mashups (the 6xxxxx IDs) don't appear there at all. Those are covered at add time from `standings.contest.startTimeSeconds`, which `get-prob-stats.js` already has in hand. Anything still unresolved sorts to the bottom rather than being treated as ancient.

`progress-manager.js#updateSolvedStatus()` re-syncs on demand: re-fetches accepted submissions, flips `prob.solved`, drops fully-solved contests from storage, and returns the removed ones so the UI can announce them.

### Storage split — this is deliberate

- **`chrome.storage.local`** (`services/storage.js`, `LocalDB`) — `trackedContests` array, keyed by `platform:id` (see the platform registry above), plus settings under dotted keys `cf_trainer.handle` and `cf_trainer.auto_export`. This is what the Export/Import JSON backup dumps wholesale.
- **IndexedDB** (`services/secure-store.js`) — API key/secret and the `FileSystemDirectoryHandle`. Credentials live here specifically so they never land in an exported backup; the directory handle lives here because handles aren't serializable into `chrome.storage`.

`LocalDB` deliberately holds only the tracked-contest methods. Settings are read directly from their dotted keys (`cf_trainer.handle`, `cf_trainer.auto_export`, `cf_trainer.contest_filter`, `cf_trainer.tag_rating_range`), and solved state is derived fresh from `user.status` on every sync rather than cached. Earlier accessors for a `cfHandle` key and a `solvedCache` were removed — nothing wrote them.

### Deduplicating the queue

`core/pending-problems.js` is the single place that flattens tracked contests into unsolved problems, and it **deduplicates**. That is not cosmetic: a CodeChef Starters runs the same problem in all four divisions, so tracking two of them lists every shared problem twice, and 1,906 of AtCoder's 9,383 problems belong to more than one contest — daily-training rounds are mostly reruns.

Identity is each platform's `problemKey`: task id on AtCoder, problem code on CodeChef, contest+index on Codeforces, where a problem really does belong to exactly one contest. When the same problem appears twice, the **newer** contest wins, since that is the one the user most likely just competed in.

Both `queue-view` and `stats-view` go through it, so their counts agree.

### Ordering a merged queue

`core/queue-order.js`. Raw ratings are **not** comparable across platforms — a Codeforces 1600 and an AtCoder 1600 are different difficulties in different populations' units. What is comparable is how likely you are to solve the thing:

```
P(solve) = 1 / (1 + 10^((difficulty − your_rating_on_that_platform) / 400))
```

All three sites define difficulty as roughly the rating at which a contestant has a 50% chance in-contest — the same quantity `rating-estimator.js` searches for — so feeding a problem's difficulty and your rating *on the same platform* cancels the scale. It is common-person equating with one anchor, you: a poor way to build a general conversion table, a good way to order one person's practice.

The queue displays **native ratings with the platform's mark beside them**, never a converted number, and shows the probability coarsely (`~72%`) because it is modelled. There is deliberately no "Rating:" label — the word implied one shared scale, which is the single claim this design denies. **Only Codeforces tints its rating numbers**, because only there do the colours carry the site's own established meaning — "cyan 1600" says something specific on Codeforces and nothing on CodeChef, which grades in stars. Platforms with no rank scheme of their own render `.tone-neutral`; the platform mark beside the number is what says whose scale you are reading. A descriptor opts in by defining `ratingBandClass`, and the shared code falls back to neutral when it is absent.

`ui/problem-row.js` owns that markup for both the queue and the contest list — `toProblemRow()` builds the view model and `renderProblemRow()` renders it, so the two views cannot drift. Two options shape it for context: `position` is omitted in a contest's expansion, where the queue's global numbering would mislead, and `compact` switches to a **one-line** row for the same place. Compact drops the platform mark and the contest code because the header directly above already carries both, and quietens the problem name — at full weight four problem titles competed with the contest's own title for the eye.

Rows fall into three bands, and the two reasons a row can lack a probability must not be conflated:

| Cause | Rating column | Chance column |
|---|---|---|
| no published difficulty | `???` | `—` |
| your rating on that platform is unknown | the native rating | `—` |

Collapsing those would hide a missing *user* rating — which mis-sorts a whole platform at once — behind what looks like ordinary missing problem data. Ties break deterministically (platform, then contest date, then index) or the list reshuffles between renders.

`services/user-ratings.js` holds your rating per platform, and is deliberately conservative because **one rating moves an entire platform's block**: a failed lookup keeps the previous value rather than clearing it, and nothing is ever defaulted. Ratings arrive from `verifyIdentity` (above), so a rating always comes attached to a confirmed account rather than floating free. There is no manual override — all three platforms fetch automatically.

### Stats: an overview, plus one panel per platform

**A platform panel is a child of the overview, not a peer of it**, so it is reached by drilling in rather than by a fourth chip beside "Overview": the two have different structure, and four equal chips both said otherwise and wrapped to two rows at panel width. The ring's legend rows *are* the navigation — each is a button — and a panel opens with a `‹ Overview` back link above a header naming the platform. Both directions share one delegated `[data-scope]` handler. The header carries no count, because once scoped the summary line directly above already reads "240 pending · median 1600 · 3 unrated".

**Panels never mix platforms** — no chart bins numbers from different sites on one axis.

- **Per-platform panels** show a native rating histogram in that platform's own units, plus tags and the rating-range control. Only the Codeforces panel colours its bars by rank; the others use a single neutral fill, since the bar length already carries the magnitude and the colours would only import a foreign meaning.
- **The overview** carries only what is genuinely comparable across sites: the platform ring, and the solve-chance histogram.

**There is no tag chart on the overview.** Vocabularies do not match — Codeforces' `dfs and similar` versus CodeChef's `graphs`, and AtCoder publishes none at all — so pooling them produces an authoritative-looking chart built from incompatible lists. The per-platform panels state tag coverage outright ("tags cover 47% of these problems"), because an empty "graphs" bar otherwise reads as "I have no graph problems" rather than "half of this is untagged".

**A platform that publishes no tags gets no tag section at all** — heading, coverage line and rating-range control included. Drawing the frame and then explaining it is empty reads as a load that failed. That is `capabilities.publishesTags` on the descriptor, asked of the registry rather than checked against an id, so a new platform declares it instead of the view guessing. AtCoder sets it false.

The rating range is a **dual-thumb slider**: two stacked native `<input type="range">`, not a bespoke widget, so arrow keys still step exactly one bucket — which is what the pair of selects it replaced was good at and a slider is bad at, since ~28 buckets across a panel is about 12px each. The inputs take no pointer events and only their thumbs do, so the lower stays grabbable through the upper. Thumbs **clamp rather than cross**; swapping them mid-drag makes the thumb under the pointer jump sides. When both sit at the top end the min thumb is raised above the max, or it could never be dragged back.

**The ring** (`ui/platform-ring.js`) shows pending problems per platform, from the same `collectPendingProblems()` the queue uses, so the two cannot disagree. Colour encodes **identity**, so each platform's `chartColor` is fixed on its descriptor and never assigned by size — filtering must not repaint the survivors. Those hues come from a validated categorical theme rather than the brand colours, which fail the chroma floor as fills (AtCoder brands achromatically, CodeChef's brown reads gray); the icons keep carrying brand identity in the legend. The three are **checked together, not individually** — changing one means re-running `scripts/validate_palette.js` on all three against the dark surface. Codeforces yellow `#c98500`, AtCoder blue `#3987e5`, CodeChef red `#e34948`; that last pair sits at CVD deutan ΔE 6.2, inside the 6–8 band, which is legal only because every swatch carries an icon, a full name and a count beside it. `#c0392b` is the zero-warning fallback if the legend ever loses its labels.

Note the ring is capped at 220px and centred rather than filling the panel, and its total and caption are **HTML centred over the SVG, not `<text>`** — SVG text scales with the viewBox, so at full width they rendered at ~60px and ~28px, larger than any label in the app. Because they no longer scale, the ring's size and stroke can be tuned freely.

It is deliberately **not a progress ring**. `updateSolvedStatus` deletes a contest once every problem in it is solved, so the only solved problems still on disk sit in part-finished contests — a "you have solved 12%" figure would understate by an unknowable amount and would *fall* as you cleared contests.

**The chance histogram uses a sequential ramp** — one hue, light to dark — not the rank colours. Those ran green through red and put 202 of a real 243-problem queue in a "red" band, so the chart's loudest message was that most of the backlog is failure. Sequential is the correct family here: ordered magnitude with no midpoint to diverge around. Its hue is **aqua, not blue**: blue is AtCoder's identity colour on the ring directly above this chart, and a magnitude band sharing a colour with a platform reads as though it means that platform. Every step sits at least 19.6 ΔE from all three identity colours, and lightness is strictly decreasing. Both palettes were checked with the dataviz skill's validator against the real `#1e1e1e` surface rather than picked by eye.

### Shared row tokens, and why the two list views agree

The Queue and Contests rows are different structures — one has a number column and a
two-line meta block, the other a title with badges beneath — but everything they *share*
comes from one place, because eight properties had previously drifted into separate
literals and made the tabs read as different products: `--row-pad-y` / `--row-pad-x`,
`--row-separator`, `--title-size`, and `--badge-size` / `--badge-ink` / `--badge-fill`.
The badge was the worst of it: the same component was dimmer, larger in the text and less
rounded on one tab than the other, and its right edge landed 10px apart.

Three differences are deliberate: the mark is 11px in the queue where it sits beside a
rating and 14px on Contests where it leads a title; the queue's row is taller because it
carries two meta lines; and its titles start further right because of the number column.

**`--text-title` (#dedede), not `--text-main`, is the top of a row's ladder.** Anything
that leads a row uses it — contest name, problem title, solve chance, an untinted rating,
histogram counts, tag names, ring legend names and the ring's total. `#fff` at weight 600
is the loudest thing on a near-black panel. Codeforces' tinted ratings are the exception,
because there the colour carries the site's own meaning rather than emphasis. Nothing
inverts to signal a selected state either — the tab bar brightens its label and underlines
it, which is what a large near-white fill was doing wrong.

### Fonts are declared but never shipped

Nothing bundles or links a webfont, and neither `Inter` nor `JetBrains Mono` is installed
on a typical machine, so **what renders is the tail of each stack** — measured, not
assumed: `"JetBrains Mono", "Courier New", monospace` and `"Courier New", Courier,
monospace` produce byte-identical text widths, which is what a fallback looks like. Both
stacks are therefore one variable each, `--font-sans` and `--font-mono`, with real system
faces at the tail. Spelling stacks out per rule is exactly how three rules once landed on
Courier New while fifteen sat elsewhere, which showed up as the queue's contest line
looking sharper than the numbers above it. `tests/stylesheet.test.js` requires every
`font-family` to use a variable and forbids Courier as anyone's fallback.

Mono is for identifiers and numbers, sans for words. That is why the footer's Import and
Export moved off mono — they are actions, and caps made them read as a heading rather than
something you press.

### Marks are seated by font metrics, never by a tuned nudge

A platform mark next to text has to centre on the text's **ink**, not its box: digits have
no descenders, so box-centring leaves the mark visibly low. That offset was tuned by hand
twice and went stale both times — once when the mark resized, once when the font stack was
fixed and Courier New's metrics stopped applying. It is now derived from constants measured
with canvas `actualBoundingBox`: `--digit-ink-center` (0.357) for the mono digits beside a
rating, and `--sans-fb-ascent` / `--sans-fb-descent` / `--sans-ink-center` for a title's
first line, where the baseline must first be located inside the line box.

`--mark-size` drives both `.platform-icon`'s own width/height *and* the offset maths, so
overriding it resizes and re-seats in one move; they were independent literals until a
resize test walked the mark 1.5px off. `.rating` and `.solve-chance` likewise read
`--rating-size`. Verified by pixel-measuring ink at four sizes: worst case 0.12px.
`tests/stylesheet.test.js` fails if a raw px translate reappears.

### A note on `style.css`

`.contest-row` was once declared **five times**, each block overriding the last, so editing any one of them appeared to do nothing. `.view-container` had three, `.list-toolbar` and `#contest-items` two each. Those are now single declarations holding the computed result of the old cascade — verified pixel-identical, not eyeballed.

**Check for a preceding comma before removing an apparent duplicate.** This bit once already: `.view-container` was the *last selector of a grouped rule*, so deleting it destroyed the whole block — the one commented "The Flexbox Scrolling Fix" — and left a dangling comma that ran the selector list on into `.btn.outline`. The queue stopped scrolling and `#router-outlet` inherited a button's border. `tests/stylesheet.test.js` now guards the shape: no selector list may contain a comment after a comma or end in one, and the scrolling fix must still name every element in the chain.

Two apparent duplicates are deliberate and should stay: `.contest-type` appears twice because the second is part of a **grouped** selector (`.contest-id, .contest-type`), and deleting it would silently restyle `.contest-id`; `.btn` gains a bare `position: relative` later for tooltip anchoring. Before removing an apparent duplicate, check whether it is one line of a group.

The rank-band colours live in `--band-*` variables so the histogram fills (`.band-*`) and the queue's rating text (`.tone-*`) cannot drift apart.

### UI shell

`core/ui/index.js` defines `<cf-app>`, which clones the `#tpl-app` template from `index.html` and hand-rolls a router over three views in `#router-outlet`: `<cf-queue-view>`, `<cf-contest-list>` and `<cf-stats-view>`. Navigation is the tab bar; the header holds only refresh and settings, which act on the app rather than on a view. Views import their markup with Vite `?raw` imports and set `innerHTML`, and are **destroyed and rebuilt on every tab switch** — which is why selections that should survive (the contest type filter, the tag rating range) are persisted to `chrome.storage.local` rather than held on the instance.

**Adding a contest is a contextual action, not a navigational one.** The offer only exists when the active browser tab is on a contest page, so it lives in the shell as a banner above the tab bar — visible from any view — rather than inside the Contests view, where the button spent most of its life greyed out. The `chrome.tabs` listeners live in `index.js` for the same reason: they have to outlive any single view.

Two conventions the shell depends on:

- **`refreshData()`** — called on the current view after a global refresh. A view that needs post-sync updates must expose it; `queue-view` also takes the removed-contest list to announce.
- **`cf-status` event** — views report long operations by dispatching a bubbling `CustomEvent` that the shell renders in its status strip (`null` clears it). That's how adding a contest narrates its stages without each view growing its own progress UI. The same `onProgress` callback is threaded through `processNewContest` and `updateSolvedStatus`; stages that no-op stay silent rather than claiming work they skipped.

`queue-view` flattens all unsolved problems across contests and sorts by solve probability (see above), and shows a setup prompt when `hasCompleteSetup()` is false — which now means *any* platform is usable, not specifically Codeforces, since AtCoder needs only a handle and CodeChef needs nothing at all — without it, a missing handle or API key made refresh look like a dead button. The platform filter (`ui/platform-filter.js`) is shared by both list views. It is a **dropdown**, not a chip row: chips grew with every platform added and competed for width with the very list they filter, whereas one control stays one line however many platforms exist. The collapsed button shows the active selection as marks plus "2 of 4", so what is filtered stays readable without opening it.

Its groups come from `listFilterPlatforms()`, so a new platform appears without touching either view. The list is **flat**: every group is one row carrying its platform's mark and naming itself in full, so no row depends on a header above it. Codeforces contributes two rows (Official and Gym) because that distinction is worth practising against; platforms with many subtypes contribute one, since nobody wants five AtCoder rows. An empty selection means **no filter**, not "show nothing", and a saved single-select choice from the original dropdown still migrates.

`ui/dismissable.js` supplies close-on-outside-click and close-on-Escape, shared with the contest row's ⋮ menu; it listens in the capture phase so a handler that stops propagation cannot leave a popover stuck open.

**A contest row is an accordion.** Clicking it expands in place to show what that contest still owes the queue, rendered with `problem-row.js` so the expansion and the Queue cannot disagree — positions are omitted there, since the queue's numbering is global. The expansion is scoped to one contest rather than deduplicated against the others: a problem shared with another division really is in both, and hiding it would make the contest look shorter than it is. Expanded keys persist to `cf_trainer.expanded_contests`, because the view is rebuilt on every tab switch. **There is no chevron** — the expansion appearing is the indicator, with `aria-expanded` for anything that can't see it.

The row carries a **⋮ menu** holding *Open contest* and *Remove from queue*; the row is a `<button>`, not an anchor, so clicking it no longer leaves the panel. The menu button stops propagation, or opening it would toggle the accordion underneath.

**Removal asks first**, replacing a 700 ms hold on a ✕. The hold existed so "a stray press does nothing at all", and a dialog is a better guard than a timer because it says what is about to happen. Confirming still has to call `writeBackup()`, or the exported JSON drifts from the panel.

`contest-list` watches `chrome.tabs` events to enable "+ Add Contest" only on a supported contest page, sorts by `startTimeSeconds` (newest first, unknown last), and deletes on a 700 ms hold rather than a click so a stray press does nothing at all.

### Platform marks

`core/ui/platform-icons.js` holds a small inline SVG per platform, used wherever a row has to say which site it came from. They are **drawn, not the real logos** — those are someone else's artwork and don't survive being shrunk to 12px — but each keeps the recognisable shape and colours: Codeforces' three bars, AtCoder's letterform, CodeChef's toque.

AtCoder's is deliberately light-on-dark, inverting its black-on-white branding, because a `#222` square on the `#1e1e1e` panel is close to invisible.

A platform with no mark yet falls back to a text chip rather than rendering nothing.

### Untrusted input

Views build rows with template strings and `innerHTML`, so anything originating outside the extension goes through `ui/escape-html.js` first. That covers contest names, problem names and tags (scraped or API-supplied), and the problem URL and source label, which are both built from a scraped problem index. Values the extension derives itself — counts, ratings, the type badge — don't need it.

`backup-validation.js` guards Import, which writes straight into `chrome.storage.local` with no undo. Note it uses `.some()`, not `.find()`: a `null` entry in `trackedContests` is itself falsy, so a truthiness check on `find`'s return value silently accepted malformed backups. There's a test for exactly that case.

**Auto-export gotchas** (`services/auto-export.js`, used by both the add-contest handler and the global refresh):

- `verifyExportPermission()` must be called *before* the slow await in a click handler, because a `FileSystemDirectoryHandle` re-permission prompt only succeeds while the user gesture is still fresh. Moving it after the network work breaks auto-export after every browser restart.
- Any path that mutates `chrome.storage.local` must call `writeBackup()` afterwards. The refresh writes solved status and tags straight to storage, so without that call the on-disk JSON silently drifts from what the UI shows — which is exactly how tags ended up visible in the extension but missing from the backup.
