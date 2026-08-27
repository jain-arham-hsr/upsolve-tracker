# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The extension is **Upsolve Tracker**; the repo and directory were renamed to match. It covers Codeforces, AtCoder and CodeChef. Storage keys are `upsolve_tracker.*`, custom elements are `upsolve-*`, the IndexedDB store is `upsolve_tracker_db` and the backup file is `upsolve_tracker_backup.json`. **There is no back-compatibility code anywhere**, deliberately: this was a single-user project at the point of the rename, so the one existing install's data was canonicalised once by hand rather than leaving normalisers in the tree forever. A stored contest therefore always carries its `platform`, and the metadata timestamp is always `publishedDataCheckedAt` — code may read both as guaranteed, and anything malformed should fail loudly rather than be quietly repaired.

## Commands

```bash
npm install
npm run dev:chrome      # Vite dev server (port 5173, strictPort) + CRXJS HMR
npm run build:chrome    # -> dist/chrome
```

```bash
npm test                # node --test over tests/ — no framework, no browser
```

`npm test` covers the parts that fail *silently*: the estimator's maths, the standings parsing, the sampling arithmetic (via `scraping.test.js`, which stubs `CodeforcesHttp` so no network is touched), backup validation and queue ordering — plus three things that are invisible by nature. **Request pacing** (`request-pacer.test.js`, `codeforces-http.test.js`, `codeforces-api.test.js`): nothing about a response says whether a delay was served, so pacing can be removed without any other test noticing. These are the only tests here that assert on **wall-clock time**, so they are also the only ones that can flake on a loaded machine — and the two kinds behave differently. `codeforces-http` and `codeforces-api` assert a **lower bound** (`gap >= 50` against a pinned 60ms), which a stall can only make more true. `request-pacer.test.js` asserts **both directions** via its `near()` helper, including two `near(…, 0, 40)` checks that a request should *not* have waited — a 40ms stall fails those. **If one goes red on CI and nowhere else, widen the tolerance; do not touch the pacing.** The pinned gaps are test-only anyway, set through the `resetApiState(ms)` / `resetHttpState(ms)` seams; production values are in the table below. **The platform boundary** (`module-boundaries.test.js`). And **the settings page's markup** (`options-settings.test.js`), which is generated from the descriptors and so is assertable in Node. There is no linter or formatter configured.

**Adapter fixtures must be cloned per test, not shared.** `codechef-adapter.test.js` keeps its payloads in module-level consts (`PROBLEMS`, `DETAILS`) that the `fetch` stub reads directly, so a test modelling "CodeChef published this later" — flipping `is_added_to_practice`, or filling in a `difficulty_rating` — mutates the fixture for every test that runs after it. The suite then passes or fails on *ordering*. `beforeEach` deep-copies both; do the same for any fixture a test writes to.

```bash
npm run build:chrome && npm run smoke   # loads the built panel in headless Chrome
```

**`npm run smoke` is the only thing that executes a view.** It loads the real bundle from `dist/chrome` with the extension APIs stubbed, clicks all three tabs, drills into a platform on Stats, and fails on any uncaught error, rejection or `console.error` — plus on a view that renders implausibly little, since the queue answers a missing setup with a short prompt that would otherwise read as success.

It exists because of a specific escape: `contest.tagsSyncedAt == nullAt` is valid JavaScript (that field is `publishedDataCheckedAt` now), so `node --check` passed, the build succeeded, the whole unit suite stayed green, and the Stats tab threw on render for every user. Reintroduce that bug and the unit tests still pass while the smoke run fails — that is the gap, and it is worth re-checking that way after changing the harness.

Two things it needs that are easy to get wrong: the built HTML uses absolute `/assets/` paths that `file://` cannot resolve, and `window.indexedDB` must be installed with `Object.defineProperty` — it is getter-only, so assignment fails silently, and real IndexedDB is unavailable on `file://`, which makes the secret read behind `readSettingsValues()` reject and leaves the queue stuck on its setup prompt.

The store seeds two waiting contests with the strip open, and the run fails if the strip draws no rows — collapsed it is a single button, and a typo inside a row would ship unseen, which is precisely the escape this harness exists for.

It also drives the **add banner**, which no unit test can reach: the stubbed tab starts on a seeded waiting contest, and the run cancels that wait and removes a tracked contest, failing if the banner does not fall back to "Add" both times. That is a genuine escape it caught — the banner is derived from storage but lives in the shell, while both lists are edited from the Contests view, so it kept reading "Waiting" for a contest that had stopped waiting. Note the stub therefore has to model `storage.onChanged` and fire `tabs.onUpdated`, and the removal must target `[data-key="codeforces:2237"]` rather than the first row: the list sorts by date, so removing the first row would leave the banner correctly still reading "Added" — a check that failed for a reason that had nothing to do with the code.

The mirror direction is checked too: the run writes a new waiting entry **straight to storage** and fails unless the mounted view grows a row, which is what proves a view follows a write it did not make. All of these interaction checks must run **after the driver clicks back to the Contests tab** — the tab loop ends on Stats, and `.waiting-item` does not exist there, so running them in loop order silently measures zero.

Each of these was confirmed the way the `nullAt` gap was: by removing the fix and watching the run report the original symptom. That is the standard for anything added here — a smoke check that has never been seen to fail is not yet evidence of anything.

It skips rather than fails when no Chrome is found; set `CHROME_PATH` to point at one. It is mostly shallow — it proves the views run, not that they are right, so **layout still needs a real browser**: build, then load `dist/chrome` unpacked at `chrome://extensions` (Developer mode → Load unpacked).

There are **two measured layout checks**, and they are the template for adding more. The unmirrored-practice `⚠` first shipped *after* the problem name, where `.compact-name`'s ellipsis clipped it off the end — the row rendered muted with no mark at all, while the unit test, which matched the HTML string, passed. So the run compares the mark's `getBoundingClientRect()` against its cell's, and separately asserts the seeded name **actually truncates**; without that second check the mark fits either way and the first proves nothing. Note the harness panel is wider than the real side panel, so a name long enough to truncate in Chrome may not be long enough here. The store also seeds `upsolve_tracker.expanded_contests`, since a collapsed accordion renders no rows and the check would silently measure zero.

The second measures **two things down the queue**: that the platform marks share an x, and that the gap between each mark and its number is constant. `.meta-line` is packed to the right, so every item's x is measured back from the rating cell — and while that cell sized to its content, a one-character difference walked the mark sideways. Removing the width reservation reports `platform marks drift 13.5px`; right-aligning the cell reports `the gap between the platform mark and the rating varies by 13.5px`. The gap check measures a **`Range` over the cell's contents**, not the cell's own box — the box is a fixed-width column and does not move when the text inside it is realigned, so an earlier version measuring the box passed happily while every number sat shoved against the far side of its cell. The gap check works by measuring the **always-rendered flag's right edge**, which is the only thing in the DOM that marks where the digits begin — the number itself is a bare text node.

It carries the same second check as the `⚠` does: the store seeds one problem with `ratingSource: "estimated"` so a `~` actually renders next to unflagged rows, and the run **fails if the queue's ratings are all one width** — without a mix, every row aligns whatever the CSS does and the measurement proves nothing.

**The run makes a second pass over `core/ui/options/index.html`**, which for a long time nothing executed at all — three `verifyIdentity` paths, credential load/save and the folder picker, none of it reached by any automated check, so a `nullAt`-class typo there would have shipped. It asserts one section per registered platform, that the stored key pair actually loads into the form, and that pressing Codeforces' **Test connection** produces a verdict rather than throwing.

Three things that pass are easy to get wrong there. The page sits **three levels down**, so `/assets/` rewrites to `../../../assets/` and not the panel's two. `--allow-file-access-from-files` is required, or the `crossorigin` attribute CRXJS puts on the `<link>` makes Chrome CORS-block the stylesheet under `file://` and the page renders in Times with every computed style wrong — a failure that looks exactly like a CSS bug. And `fetch` is stubbed to **reject**, because every change-triggered platform verifies on load and the run would otherwise sit waiting on atcoder.jp; rejecting drives the failure branch, which is the one that has to render a verdict instead of throwing. Errors the stub itself causes are filtered out by message, since a failed verify legitimately logs.

Confirmed the usual way: renaming a descriptor's `api_secret` key reports *"the stored API key pair did not load into the form"*, which is the one failure here that is otherwise silent — a secret read under the wrong key comes back empty and looks exactly like a setting you never saved.

`tests/sampling.test.js` deliberately asserts that uniformly random page sampling is *worse* than the stratified design, so the rejected approach can't quietly come back.

`tests/estimator-accuracy.test.js` records a **known bias**: estimates run below Codeforces' published ratings, by up to ~300 on the hardest problems. The Elo model assumes everyone attempted every problem, when most never open the hard ones — non-attempts read as difficulty-driven failures, so the model over-predicts solves and the search settles too low.

**"Model attempts, not ability" was the suggested fix, and it is wrong.** It was measured against 62 gym problems where CF publishes a rating — a real labelled set — and fitting only the parties that actually submitted took mean absolute error from 213 to **374**, with the bias swinging to −310. CF's own ratings are calibrated over everyone who *entered* the round, not everyone who opened the problem, so conditioning on attempters leaves the definition rather than correcting for it. Six other levers were tried and all were neutral or worse (attempt blending, shrinkage to the contest mean, the zero-solve target, the 800 floor, team collapsing by max/mean, Elo divisors 200–1000); the file lists the numbers so none is retried. Enforcing difficulty order across a contest was rejected before measuring — only 2 of 8 contests are actually sorted.

The residue is not reweightable: fed data from its own model at those field sizes the estimator has an irreducible error of 87 against an actual 213, so ~126 points is model misfit — most likely because the two numbers measure different things, difficulty for a two-hour CF round versus for a handful of teams sharing a machine over five ICPC hours. The response is honesty rather than accuracy: `ui/problem-row.js` marks an estimated rating with `~`, so a ±200 number does not read as exact.

It matters less than it did, because published ratings are now preferred wherever they exist — official contests via `problemset-sync.js`, and the ~32% of gym problems CF recognises via `solve-stats.js`.

The build is still target-parameterized (`TARGET` selects `targets/<name>/manifest.json` and `dist/<name>`), but only `chrome` exists — the previous `dev:firefox` / `build:firefox` scripts were removed because they failed at config load. A real Firefox target needs more than a manifest: `targets/chrome/` depends on `chrome.sidePanel`, which Firefox answers with `sidebar_action`, and CRXJS emits a Chrome-style service-worker loader. Everything under `core/` already sticks to APIs both browsers implement.

Pushing to `main` triggers `.github/workflows/release.yaml`: it runs `npm test`, builds Chrome, reads the version from `targets/chrome/manifest.json`, **deletes any existing release/tag with that version**, and republishes. Bump the manifest version when you want a distinct release; leaving it unchanged silently replaces the previous one — and because the workflow re-creates the tag, the old tag is *moved to the new commit*, so a span of work can end up filed under a version that was already published. That happened between the first v2.1 and v2.2. `package.json`'s version is decorative (nothing reads it); keep it in step with the manifest anyway so the two never disagree.

A docs-only or comment-only commit needs **no** bump: the built bundle is unchanged, so re-publishing the same version is correct and simply moves the tag forward to include it. Bump only when what ships differs. Note `gh` is **not installed** on this machine, so the workflow's result cannot be checked from a shell — look at the Actions tab.

The test step is the gate: before it existed the workflow would happily build and publish a release from a red tree.

## Build model

`vite.config.js` reads `targets/$TARGET/manifest.json` and hands it to `@crxjs/vite-plugin`, outputting to `dist/$TARGET`. Consequences:

- **`host_permissions` is composed at build time**, not listed in the manifest. `vite.config.js` imports `registry.js` — which is pure ES modules and loads under plain Node — and flattens each descriptor's `hostPermissions` into the manifest it already reads. Chrome needs these declared statically, but nothing requires a human to keep the list in step, and "remember to also edit the manifest" is exactly the step that gets missed. The composed list is verified against the previously hand-written one by diffing `dist/chrome/manifest.json`; note AtCoder contributes **two** origins (`atcoder.jp` and `kenkoooo.com`), which is why the descriptor key is a list.
- The manifest is the entry-point graph. HTML entries (`side_panel.default_path`, `options_ui.page`) and the service worker point at **source** paths (`core/ui/index.html`, `targets/chrome/background.js`); CRXJS crawls and rewrites them. A new page must be registered in the manifest to be built.
- `@core` aliases to `core/`, though most existing imports use relative paths.
- `core/` is target-agnostic business logic; `targets/<browser>/` holds only the manifest and background worker. Keep browser-specific glue in `targets/`.
- **Everything outside `core/platforms/` is platform-agnostic, and that is now enforced across the whole subtree.** `registry.js` and `adapters.js` are the only two modules allowed to know which platforms exist; everything else asks them. Five wholly-Codeforces modules used to sit in shared space — the signed API client, the scrape, its HTML parser, its HTTP client and the start-time sync — plus `secure-store.js` hardcoding three ids and their storage keys, `platform-icons.js` as a three-key map, and a settings page importing all three adapters by name.

  `start-time-service.js` was the instructive one, and an earlier version of this file argued it should stay. It exported `syncStartTimes` (Codeforces-only) *and* `byStartTimeDesc` (a pure comparator `contest-list.js` uses). One genuinely shared export is what kept a Codeforces module looking like shared infrastructure. It is split: the comparator is in `queue-order.js`, the rest is `platforms/codeforces/start-times.js`.

  **`tests/module-boundaries.test.js` previously asserted almost nothing**, and passing green is what made that expensive. It read *one directory* — files directly under `core/` — so `core/services/` and `core/ui/` were never examined; and it recognised a violation by import **path shape** (`./platforms/<id>/…`), which a platform-specific module living outside `platforms/` never has. It could only flag the problem after the move that fixes it. It now walks recursively and checks three things: no import from inside a platform folder, no platform id in comment-stripped code, and no use of a platform's **subtype vocabulary** (`"OFFICIAL"`, `"GYM"`, `"ABC"`) — the leak with no platform name in it. Comment-stripping is essential rather than convenient: every shared module discusses all three platforms in its prose, so a raw scan would fail on documentation and prove nothing.

  There is **one named exception**, `stats-view.js#renderHint`, with its reason recorded beside it and a test that fails if the file stops needing it. A named exception is a debt the suite keeps visible; the version being replaced hid a whole subtree by accident.
- `linkedom` is a devDependency used only by the tests (`standings-dom.test.js`, `scraping.test.js`, `options-settings.test.js`) to parse HTML in Node; shipped code uses the browser's `DOMParser`.

## Architecture

Vanilla ES modules and custom elements — no framework, no bundled UI library.

### Platform registry

`core/platforms/registry.js` owns which sites exist. A descriptor answers everything that depends on *where a contest came from*: `matchUrl`, `contestUrl`, `problemUrl`, `sourceLabel`, `contestLabel`, `solvedKey`, `problemKey`, and a `capabilities` block.

It also answers everything shared code used to hardcode about a platform, which is what makes the boundary hold rather than merely be stated:

| key | what it stops shared code doing |
|---|---|
| `icon` | keeping a three-key map of marks in `ui/platform-icons.js` |
| `chartColor`, `ratingBandClass` | assigning colours or rank tints by id |
| `hostPermissions` | hand-listing origins in `targets/chrome/manifest.json` |
| `settingsFields` | naming three ids and their storage keys in `secure-store.js` |
| `verify` | branching on which section has a button |

`registry.js` and `adapters.js` are the **only** two modules allowed to enumerate platforms. Nothing else — not a view, not a service, not the build — should branch on one, and `tests/module-boundaries.test.js` fails if it does.

This replaced two copies of the same Codeforces URL regex (`contest-manager.js` and `contest-list.js`) and three hardcoded `https://codeforces.com` origins, so a URL change is now one edit.

Two conventions the registry depends on:

- **Every stored contest names its `platform`.** `platformOf()` and `contestKey()` both throw on a record that does not, rather than defaulting — a default would file a malformed record under Codeforces and key it as `undefined:1993`. An unrecognised platform throws too, since that means data from a newer build.
- **A contest may also carry `sourceId`** — the id the user navigated from, when it differs from the one stored. CodeChef parent contests resolve to a division, so `/START252` is stored as `START252D`; `findTrackedContest()` matches either, without which the add banner offers to add an already-tracked contest.
- **Contest identity is `platform:id`, never the bare id** (`contestKey`). Codeforces contest 1000 and a CodeChef contest "1000" are different contests; keying on the number alone would have one silently overwrite the other in `LocalDB.addTrackedContest`. `LocalDB.removeTrackedContest` takes `(platformId, contestId)` for the same reason.

**Every adapter answers with one of five statuses** from `core/contest-status.js` — `ready`,
`notEndedYet`, `notPublishedYet`, `sourceUnreachable`, `unavailable` — and `contest-manager.js` is
the only place that maps one to an outcome. The set is closed on purpose: an adapter used to be able
to return a contest, throw a *flagged* error, or throw a bare `Error` with arbitrary prose, and the
orchestrator could classify the first two and only shrug at the third. CodeChef fell through that
gap entirely, failing hard where AtCoder waits. An exception escaping an adapter is now a **bug**,
not a case.

The naming rule that produced those five: **a fact must imply the same policy on every platform; if
it doesn't, the fact is too coarse.** There used to be one fact — "couldn't rate this contest" —
covering both a round whose standings hadn't settled (*the data is coming*) and a private gym whose
field will never be visible (*the data will never exist*). Those need opposite handling, which is
the only reason a `mayBeUnpublished(subtype)` capability existed: to tell them apart afterwards,
using subtype as a proxy. Splitting the fact removed the need for the proxy, and the capability is
gone. **Don't re-merge them** — the moment one status means different things on different platforms,
per-platform policy creeps back.

`capabilities.canEstimate` decides what a *gap* means once a contest is fetched. Codeforces is the
only platform whose participant field is readable, so it is the only one that can estimate: a hole
left after the estimator has run is a bug and `contest-manager` refuses loudly. AtCoder and CodeChef
cannot estimate, so a gap is simply a problem the site hasn't rated — it stores `rating: null` and
renders "???". This replaced `allowsPartialRatings`, which was never independent: it was the exact
inverse of this on all three platforms, two declarations that had to agree with nothing checking
they did. `???` therefore means exactly one thing — *the site says unrated* — never "we couldn't
find out", which is why a failed request waits rather than producing one.

### Whose data is this? (`services/platform-identity.js`)

**Every platform has a handle you enter in Settings, and that handle is the authority.** Nothing that writes `solved`, or sets a rating the queue orders by, runs without one — and **a contest cannot be added for a platform whose handle is missing**, because it would store unmarked, its solved problems would never clear, and it would look like the sync was merely slow.

Adapters check it through `verifyIdentity(session)`, which returns `{username, rating}` or throws, before any user-specific read — on the refresh **and** the add path, since adding a CodeChef contest reads `problemsstats` too. Verification is free: the same call already fetched the rating. Codeforces uses `user.info`, AtCoder the profile page, CodeChef the bootstrap object `createSession` already read.

The check differs by how each platform is addressed:

- **Codeforces and AtCoder are asked *about* a handle**, so who is signed into those sites is irrelevant and verification only confirms the handle exists. That matters more than it sounds: `user.status?handle=X` returns X's submissions no matter whose key signs the request, so an unchecked handle silently yields somebody else's history. Codeforces' canonical casing is taken from the API, so `Tourist` over `tourist` is not read as a change.
- **CodeChef answers for whoever holds the session cookie**, so the configured handle is additionally compared against the signed-in account. A mismatch throws with **`isIdentityMismatch`** and callers must always stop — `solved` is only ever set true, fully-solved contests are deleted outright, and `writeBackup()` runs after the sync, so one sync under another account permanently corrupts the queue *and* overwrites the backup with the corruption.

Settings confirms the resolved account for all three, in one shape: *“Connected as tourist”* where the handle is looked up, *“Signed in as tourist”* on CodeChef where the browser session really is the identity. Each runs the **same `verifyIdentity` the sync runs** — a check that exercises a different call can pass while the real path fails — and Codeforces runs it against the values typed in the form rather than the saved ones. AtCoder previously showed nothing at all, which mattered most there: its history is read *about* a handle, so the resolved account is the only thing between a typo and a queue synced against a stranger.

**What the check can and cannot establish differs by platform, and the difference is not cosmetic.** On CodeChef the browser session *is* the identity, so the signed-in account is compared against the configured handle and a mismatch throws. On Codeforces and AtCoder there is no session involved — `user.status?handle=X` returns X's submissions whoever's key signs the request, and AtCoder's history comes from kenkoooo, which authenticates nobody. Neither site offers a "who am I" endpoint, so **the handle is verified to exist, not to be yours**: enter someone else's and you will sync their solves. What contains that is the *changed*-identity path, which clears that platform's flags rather than merging them, so the mistake is recoverable.

The guarantee rests on three independent layers, each confirmed by removing it and watching `tests/identity-guard.test.js` fail:

1. `adapter.verifyIdentity` runs before any user-specific read, on the refresh (`progress-manager.js`) *and* the add (`contest-manager.js#establishIdentity`).
2. `classifyIdentity` throws on a blank username, so an identity that was swallowed rather than verified still cannot get through.
3. CodeChef's `fetchSolvedKeys` verifies again on its own — the layer that survives when the first two are both defeated, and the reason a caller cannot accidentally read another account's solves.

`services/platform-identity.js` answers the one remaining question: **has that handle changed since the solved flags were derived?** If so they belong to the previous account and are cleared, for that platform only, so the next sync re-derives them. That restores what this file already claims — solved state derived fresh each sync rather than cached — which the stickiness had quietly made false. Contests already deleted for being fully solved cannot come back.

`updateSolvedStatus` returns `{removed, failures}` rather than a bare array. **Failures are surfaced, not just logged**: a silent refusal looks the same to the user as a silent corruption. The shell reports them **last**, after the backup write and the view refresh — reporting earlier let `"Writing backup…"` overwrite the message for exactly the users whose backup was at risk.

Note the Codeforces scrape sends cookies (`platforms/codeforces/http.js`), but `standings-dom.js` reads only the contest name, problems, *competitors'* handles, solve counts and pagination — nothing about the viewer. So it needs no identity, and neither do the public bulk endpoints or kenkoooo's static files.

### Platform adapters

The registry is *pure* — URLs, identity, capabilities — so anything can import it. Network work lives behind an **adapter**, resolved by `core/platforms/adapters.js`. The split is deliberate: `backup-validation.js` imports the registry, and must not drag the network stack in with it.

A platform adapter exports six things, two of them optional:

- `createSession()` — loads whatever that site needs to authenticate, from saved settings. **The orchestrator never sees a credential.**
- `createSessionFrom(values)` — the same session from a `settingsFields` key→value map that has *not* been saved. Settings verifies what you typed rather than what is stored, so a wrong key tells you before you come to rely on it; this is what lets it do that without reaching past the adapter into a platform's API client, which is what it used to do. `createSession()` is now this function over saved values, so the two cannot diverge.
- `fetchContestRecord({contestId, subtype, session, onProgress})` — the entire acquisition pipeline behind one call, returning a stored-shape contest whose problems all carry `rating`, `ratingSource`, `tags` and `officialSolves`.
- `fetchSolvedKeys(session, onProgress)` — a Set of `platform.solvedKey(...)` values.
- `verifyIdentity(session)` — `{username, rating}` or a throw, run before any user-specific read. Its **message is the user-facing verdict**, in Settings and in the queue's status strip alike; see the identity section below.
- `syncMetadata(session, contests, onProgress)` — optional; fills in data that only arrives later.
- `describeIdentity(identity)` — optional; how Settings names the resolved account. Defaults to *"Connected as X"*; CodeChef overrides it to *"Signed in as X"* because there the browser session **is** the identity. It lives on the adapter so that distinction is not a branch on the platform in shared code.

`contest-manager.js` is now just the orchestrator: match the URL, pick the adapter, mark solved, decide whether the record is complete enough to store. Everything Codeforces-specific — the signed API, the standings scrape, the Elo estimator — sits in `core/platforms/codeforces/adapter.js`. Adding a platform means writing one adapter, not editing the orchestrator.

`progress-manager.js#updateSolvedStatus()` loops over every platform with tracked contests, **isolating failures**: one site being down or unconfigured must not stop the others, and if *every* platform fails it returns before the write so a bad sync can't touch storage. `applySolvedStatus()` is split out and pure because it's the step that fails quietly.

Two invariants there:

- **`solved` is only ever set true, never cleared.** That stickiness is load-bearing. CodeChef answers a logged-out request with an *empty* solved list rather than an error, and clearing on that would resurrect every finished problem.
- **`solvedKey` is namespaced by platform** (`codeforces:2193-A`). One `Set` holds solved history from every site, so a bare `contestId-index` would let two platforms sharing a contest number mark each other's problems solved.

Note every relative import must carry its `.js` extension. Vite resolves extensionless paths, Node does not — three of them had been sitting in what are now `solve-stats.js`, `rating-distribution.js` and `options.js`, invisible until a test imported that part of the graph.

`backup-validation.js` refuses a backup whose contests omit `platform` or name one this build doesn't know, since either would otherwise throw later while rendering the list.

### Waiting on a contest the platform hasn't published yet

`core/waiting-contests.js`. Adding a round minutes after it ends fails for the same reason everywhere: the data isn't there. AtCoder Problems has not indexed it; a Codeforces standings totals row has not settled. The message was correct and the only recovery was to come back and click Add again — at the one moment you most want the contest queued. So the attempt is remembered under `upsolve_tracker.waiting_contests`, and every global refresh retries it.

**Waiting entries are their own storage key, never `trackedContests`.** They carry no `problems` array, so filing one in the queue would break `backup-validation.js`, `collectPendingProblems`, the platform ring and the stats histograms at once. They still ride along in the backup, since `writeBackup()` dumps `chrome.storage.local` wholesale. Keying is `makeContestKey`, identical to a tracked contest, so the two can never be filed under different names for the same round.

Four things are easy to get wrong:

- **Which failures may wait is a property of the fact, not of the platform.** `shouldWait()` in `contest-status.js` answers it, identically everywhere: `notEndedYet`, `notPublishedYet` and `sourceUnreachable` wait; `unavailable` refuses, and is the one status that also **drops an existing waiting entry** on retry, since another attempt cannot change the answer.
- **Entering the state is a flag on the error, never a message match** — `error.isNotPublishedYet`, the same idiom as CodeChef's `isIdentityMismatch`. A copy edit to "doesn't list contest" must not silently turn a contest that would have resolved into one that is never retried. `error.isAlreadySolved` exists for the same reason on the other side.
- **It must not be logged as a fault.** `console.error` from an extension page is filed under `chrome://extensions` as an extension error, with a stack trace and a red badge — once on the add, then again on *every refresh* for as long as it waits. So `contest-manager.js` logs it at **`info`** when `isNotPublishedYet` is set, and errors as before for everything else. `warn` is not enough — that page collects error *and* warning levels, so downgrading to `console.warn` only changed the icon from a red circle to a yellow triangle, and the test that watched `console.error` alone passed while the entry was still being filed. `tests/waiting-quiet.test.js` drives the real `processNewContest` for both halves of that branch, since the logging is in its catch.

  **The same trap is still live in one place, knowingly.** `codeforces/api.js` logs every failed API call at `console.error`, so typing a wrong key into Settings and pressing *Test connection* files an extension error against the extension — a red badge for what is just a typo the page already explained. It was left alone because it is not only a Settings path: the same line fires when a sync genuinely fails, where an error *is* the right level. Splitting the two means deciding at the call site rather than in the client. Worth doing, not urgent.
- **A retry drops an entry only when it will never resolve** — added, already tracked, or every problem solved. **Every other failure keeps it waiting.** `processNewContest` verifies identity before it fetches anything, so a 503 or an expired session throws something that is *not* a publication delay; dropping on that would lose the wait to a network blip, silently. The recorded `lastError` renders on the row, which is the only thing that tells a stuck entry from a young one.

The retry runs **before** `updateSolvedStatus` in the shell's refresh, so a contest added here gets its solved status marked and lands in the same backup write rather than sitting a refresh behind. Failures are isolated per entry, the way `progress-manager` isolates them per platform. `retryWaitingContests(onProgress, {addContest})` takes the adder as a **test seam** — production always passes `processNewContest`, and `tests/waiting-contests.test.js` substitutes it so the outage case can be exercised without a network stack standing in for one.

**Both halves of this are now confirmed against a live site.** A waiting entry has resolved on its own — left the strip and entered the queue on a later refresh, unaided — and a Codeforces official round has entered the waiting state. An earlier version of this file warned that neither had ever been seen and that the Codeforces branch "may never fire in practice", on the reasoning that a just-finished round normally succeeds anyway because an empty `contest.ratingChanges` is what the standings sampling covers. That reasoning was wrong about the outcome; the branch fires.

**Which makes the cost asymmetry a live characteristic rather than a footnote.** An AtCoder entry costs a 304 per refresh. A Codeforces one costs **tens of deliberately throttled requests**, every refresh, until it resolves or is cancelled by hand — so a CF round that is never going to resolve is worth cancelling rather than leaving to sit. That arithmetic is why `unavailable` exists as a distinct status: a gym with no visible field refuses immediately instead of retrying forever, which is what a `mayBeUnpublished` capability used to approximate by asking whether the subtype was a gym.

**133 of 2,138 finished official Codeforces contests (6%) never enter `problemset.problems` at all** — 12 ICPC Challenges including World Finals, 14 Kotlin Heroes, and 54 mirrors of external events ("based on Technocup", "based on VK Cup"; the newest is 1,040 days old, so current rounds are unaffected). Since an official round now waits until the problemset has it, such a contest waits **indefinitely**. That is a knowing trade — an honest stall over a wrong rating — not an oversight. Cancel it from the ⋮ menu if one turns up.

One non-obvious dependency: AtCoder's resources are cached in memory for 15 minutes, so a retry inside that window would re-read the same stale array, fail on the same missing row, and *look* like it checked. `getResources({revalidate: true})` skips the TTL without skipping the ETag — a no-change revalidation costs a 304, not another 3 MB. It is requested **once per platform per refresh**, not once per entry, since the first revalidation makes the rest fresh.

**The banner *and* the mounted view are rebuilt from `chrome.storage.onChanged`, not from anyone remembering to say so.** Both are derived from what is tracked and what is waiting, and both had a mirror-image staleness bug:

- The banner lives in the shell while the lists are edited from the Contests view, which cannot reach up to it — so cancelling a wait left it reading "Waiting" for a contest that had stopped waiting until the panel was reopened. Removing a tracked contest had the same latent bug, reading "Added".
- In the other direction the shell writes and the view has to notice: adding a contest that turned out to be waiting showed no sign of it on the Contests tab until you navigated away and back. The path that *succeeds* had always refreshed explicitly, which is exactly why the waiting branch was missed — one call site, one omission.

So `index.js#refreshCurrentView()` is called from the listener rather than from each writer. Watching storage covers every writer for free, including Import, which replaces both lists wholesale. It filters to `trackedContests` and `upsolve_tracker.waiting_contests`, since a sync writes storage constantly and re-querying the active tab each time is wasted work. The global refresh still calls `refreshCurrentView(removed)` **directly as well**, because the removed-contest list is what the queue announces and a storage event cannot carry it.

In the UI the state is an indicator, not a control: the shell's banner shows a disabled `⏱ Waiting` exactly as it shows `✓ Added`, and cancelling lives on the Contests tab, in the same ⋮ menu and behind the same dialog as removing a tracked contest — whose title, help text and confirm label are swapped, since "its unsolved problems leave the queue" describes something that never happened. The waiting strip is a collapsible shaded band above the list, and its rows are **not** buttons: there is no accordion, because a waiting contest has no problems to expand onto.

Three details there are deliberate. **Its header carries a chevron**, which is the opposite of the contest row's rule above — and for the reason that rule gives: a contest row needs none because the expansion appearing under it *is* the indicator, whereas this header collapses to a bar with nothing beneath it, so there was nothing to see and no reason to guess it opened. It points **down when closed and up when open, never sideways**: a chevron pointing right at a row's far right edge is the drill-in affordance — it is what the Stats legend rows use to open a platform panel — so pointing it that way promised another screen when this expands in place. It rotates rather than swapping glyphs, so the two states cannot drift. **The rows carry no "waiting" pill**, since the heading directly above them already says so — the same reasoning that drops the platform mark from a contest's compact expansion. And the band keeps a `margin-bottom` matching the one `#contest-items` already has: flush against the scrolling list, the first real contest read as another waiting row.

### AtCoder

`core/platforms/atcoder/`. Far smaller than the Codeforces adapter, because AtCoder Problems (kenkoooo) publishes difficulty directly — **there is no scrape, no participant sampling and no estimator on this path**. Four static JSON files plus a submissions endpoint cover everything. AtCoder needs no key or secret, only a handle (`upsolve_tracker.atcoder_handle`), and only to read solved history.

Four things that are easy to get wrong:

- **`contest-problem.json` is not optional.** 1,906 of 9,383 problems belong to more than one contest, and `problems.json` records only the one a problem debuted in. Reading it alone under-reports a rerun badly — one daily-training round lists 4 problems instead of 9. Verified live.
- **Difficulty is unbounded below.** 1,772 rated problems sit under 800 and 931 are negative; ABC 471's A is −817. Nothing on this path may apply the estimator's `Math.max(800, …)` floor. (`-10000` appears once, for `agc010_a` — a single fitting artifact, not a sentinel, so it needs no guard.)
- **A problem's identity is its task id**, not contest + index, so `solvedKey` and `problemKey` are both `atcoder:<task_id>`. Solving a problem in its original contest clears it from every rerun too.
- **Difficulty arrives only once a problem has run in a rated contest.** ABC/ARC/AGC are 92–99% covered, but a round added the evening it ends may have gaps, and unrated contests (`awc*`) never get models at all. Hence `canEstimate: false`: those problems store `rating: null`, render as "???" and are re-checked on every refresh. That re-check is free — `problem-models.json` is already fetched and cached.

`problems-api.js` caches the four resources **in memory**, not in `chrome.storage.local`: they total ~5 MB parsed, against a 10 MB quota the queue itself needs. Requests are spaced ≥1 s per kenkoooo's published etiquette, and queue behind one another through a promise chain — checking a timestamp per call looks equivalent but lets concurrent requests all wait the same interval and then fire together, which is the exact burst the spacing exists to prevent.

Submission paging is the other sharp edge. The endpoint returns at most 500 rows, and both failure modes are silent: stopping at the first full page leaves solved problems in the queue forever, while advancing the cursor *past* the newest timestamp skips every submission sharing that second. So the cursor moves **to** the newest timestamp, the overlapping row is deduplicated by id, and the loop stops when a page brings nothing new. Note the documented `atcoder-api/results?user=` endpoint **404s** — it was retired in favour of the v3 route.

### CodeChef

`core/platforms/codechef/`. No estimator here either: CodeChef publishes `difficulty_rating` and does so promptly — Starters 252 was fully rated within two days of running. `/api/rankings/` is CSRF-gated and returns 403, but nothing needs it.

CodeChef's public API was retired years ago and the site is an SPA, so the only route to its data is the same `/api/` endpoints the front end calls. **Its ToS §14 forbids crawling**, which is why `api.js` is written to be strictly user-session shaped: only the contest the user is looking at, its problems, and their own solve history; `/api/` paths only (robots.txt disallows `/problems/*`, `/status/*` and `/recent/user`); and a 403 stops and surfaces an error rather than retrying. What would make it a crawler is **enumeration** — paging the ~21,000-problem catalogue. `/api/list/problems` *is* used, but only ever scoped by `group=attempted` and behind a page cap; see below.

Four traps, all confirmed against the live API:

- **`problemsstats.solved` changes type.** Signed out it is an empty **array**; signed in it is an **object** keyed by problem code. Array methods silently see nothing on the shape that actually carries data, so read it with `Object.keys`.
- **Signed out looks identical to "solved nothing."** `fetchSolvedKeys` therefore refuses outright when `signedIn` is false, so `progress-manager` isolates the failure and leaves existing flags alone. This is the case the stickiness invariant exists for.
- **`problemsstats` cannot see an upsolve, and neither can the per-problem endpoint.** Both report only what happened *during* the contest. A contest closes to submissions when it ends, so upsolving happens in practice — see the section below, which is why solved status is no longer read per contest at all.
- **Two out-of-band difficulty values**, both arriving as strings: `-1` for unrated (74% of the catalogue) and `9999`. Both become null. `9999` is the dangerous one — it is also the queue's own sort-last sentinel, so passing it through would read as a legitimate, very hard problem.
- **`/START252` is a parent contest** with an empty problem list and no error. Divisions are rating-banded, so the user's own rating (from `codeChefUserData`) selects the one they competed in; with no known rating it names the divisions rather than guessing.

Costs one request for the contest plus **one per problem** — difficulty and tags appear on no bulk or contest-level response, signed in or not. That is ~9 for a Starters division, still fewer than a Codeforces add. Tags mix real topics with the setter's handle and the contest code (`['combinatorics','raysh07_adm','start252','trees']`), so `cleanTags` strips both.

`page-data.js` is the CodeChef equivalent of `standings-dom.js`: the one place that parses its markup, extracting `window.codeChefUserData` by **balanced-brace slicing** — a non-greedy regex stops at the first `};` inside a nested object or a string. It returns `null`, never a default: a guessed handle would look like a signed-in session.

Note `solvedKey` is `codechef:<problem_code>`. The same problem runs in every division of a Starters, so solving it in Div 4 clears it from a tracked Div 3.

#### Solved status is read per user, not per contest

A CodeChef contest stops accepting submissions when it ends, so **upsolving happens in practice mode**. `problemsstats.solved` on the contest payload reflects in-contest submissions only, and so does `problem_status` on the per-problem endpoint — both were tried. Reading either meant a CodeChef problem solved after its contest stayed in the queue forever, which made the whole platform untrackable past contest day.

So `fetchSolvedKeys` is now user-wide, matching Codeforces' `user.status` and AtCoder's submissions feed; its `contests` argument is unused. It reads the practice page's own source, `GET /api/list/problems?group=attempted`, and keeps the rows CodeChef marks Accepted.

Four things that are easy to get wrong:

- **`status === 1` is Accepted**, from the practice bundle's own map: `{0: Unattempted, 1: Accepted, 2: Partially Correct, 3: Wrong Answer, …}`. Match that value explicitly rather than "anything but 0" — `solved` is sticky and never cleared, so a false positive hides a problem permanently while a false negative costs one refresh. `2` is Partially Correct, excluded for the same reason `partially_solved` always was.
- **`page` is zero-based.** Page 1 silently skips the first hundred rows.
- **`start_rating` must be `-1`.** A range starting at 0 drops every unrated problem — 5,519 of 21,488 survive that filter.
- **The page cap is load-bearing.** Signed out, `group=attempted` is *ignored* and the endpoint answers with the whole catalogue. If that ever happens signed in, paging to `count` would walk 21,000 rows and become exactly the sweep this client forbids — so `getAttemptedProblems` refuses when `count` exceeds `MAX_ATTEMPTED` rather than continuing.

Dead ends, so they are not re-investigated: the profile page's solved list carries problem **names only**, no codes or links; "Recent Activity" is AJAX from `/recent/user`, which robots.txt disallows; and the listing endpoint has **no** status filter and **no** `contest_code` filter, so "just my solved ones" and "just this contest's" are both unavailable.

#### Some problems were never mirrored to practice, and can never be solved again

A contest closes to submissions when it ends, so upsolving happens at `/problems/<CODE>` — and **some older problems were never added there**. `START32C/problems/MAXTHEMIN` still renders its statement inside the contest, but `codechef.com/problems/MAXTHEMIN` 404s. There is nowhere left to submit it. Since `solved` is only ever set true, such a problem would otherwise sit in the queue forever.

`is_added_to_practice`, on each entry of the **contest** payload's `problems` map, answers this exactly, and costs nothing: `fetchContestRecord` already has that payload in hand. Verified against START32C, where it is false for MAXTHEMIN and true for the other nine, cross-checked against the route it predicts (`/api/contests/PRACTICE/problems/MAXTHEMIN` → 404, `.../VOLCONTROL` → 200).

**How common, so it need not be re-surveyed:** 13 of 327 problems (~4%) across 37 sampled contests, in 10 of them. It is an *older*-contest phenomenon — everything from START95 onwards was clean (95, 100, 105, 110, 120, 150, 180, 210, 240, 252), as were the Cook-Off and Lunchtime rounds sampled. The affected codes skew towards non-standard problems (`LEARNSQL`, `RANKLISTPAGE`, `WATESTCASES`, `ON_OFF`), which suggests SQL and interactive tasks are what the practice archive does not take — a guess from the names, not verified. Note a shared problem is flagged in every division it ran in: MAXTHEMIN is unmirrored in all four of START32 A–D.

Two neighbouring fields do **not** answer it, so they should not be tried again. `problem_url` is `/problems/MAXTHEMIN` even for the problem that 404s there — the URL lies, the boolean does not. And `is_direct_submittable` is false for *everything* when signed out, because it tracks login state rather than mirroring.

Such a problem stores `upsolvable: false`. The key is **written only when it is false**; absent means upsolvable, which is every problem on Codeforces and AtCoder, both of which serve their whole history from a stable per-contest route. This is a data flag rather than a capability, so nothing outside `platforms/codechef/` decides what makes a problem unreachable and no view branches on the platform.

Four things about it are deliberate:

- **It is dropped in `pending-problems.js`, not in each view.** That is the single choke point the queue, the platform ring and both stats histograms all run through, so they cannot disagree about what "pending" counts. `tag-service.js` is the one iterator that bypasses it — `countPendingTags` walks contests directly — so it repeats the guard by hand, or the tag bars would count problems the coverage line directly above them has excluded.
- **The contest's own expansion opts back in**, via `collectPendingProblems(contests, { includeUnupsolvable: true })`. Hiding the row there would make the contest look shorter than it is and give no clue why. It renders muted with a `⚠` whose title explains it; the wording names no platform, since `problem-row.js` is shared by all three. The mark goes **inside** the name cell — `.contest-problems` declares four columns and each compact row borrows them with `subgrid`, so a fifth child drops onto an implicit row of its own. The `~` rating flag *did* have that bug, latently, until the flag started firing on every estimated Codeforces rating and put a stray `~` on the line below most rows of a gym's expansion; it now lives inside the rating cell. `tests/problem-row.test.js` counts a compact row's children rather than checking where a mark sits, since that is the invariant and it is what catches the next one. And it **leads** the name rather than trailing it: `.compact-name` truncates with an ellipsis, so a trailing mark is clipped away for exactly the long titles that most need explaining. It shipped trailing once and was invisible on screen — "Maximize the Minim…" rendered muted with no mark and no clue why — while the test, which matched the HTML string, passed.
- **The contest is deliberately not auto-deleted.** `progress-manager.js` is untouched: an unupsolvable problem never gets `solved = true`, so `allSolved` stays false and the contest keeps its place on the Contests tab with the warned row visible. It leaves only when removed by hand. Folding the flag into `allSolved` would delete the contest and the warning with it, which is the opposite of the point.
- **`refreshPracticeFlags` runs on every refresh, not on the weekly `publishedDataCheckedAt` stamp**, and writes in **both** directions — a problem CodeChef later mirrors has to come back to the queue, so unlike `solved` this is not write-once. It looks **only at contests that still carry a flagged problem**, so the normal fully-mirrored queue costs nothing; reading the *contest* payload rather than the per-problem endpoint is what makes even the flagged case cheap, at one request per affected contest instead of one per affected problem. A contest with nothing flagged is deliberately never re-checked: the only thing that would find is CodeChef *removing* a problem from practice, which does not happen, and paying a request per contest per refresh to look for it would be the sweep this client exists to avoid. A failed re-check leaves the flag alone rather than clearing it — guessing a problem back into the queue on a network blip would undo the point.

**Unconfirmed, and the reason for the fast cadence:** a contest added *hours* after it ends may plausibly report every problem as unmirrored simply because CodeChef has not got to them yet — which would empty the queue for exactly the contest you most want to upsolve. It could not be reproduced: the freshest contests reachable (START252D and DSAMONDAY016, four and six days old) already reported every problem mirrored, so mirroring is evidently prompt. Re-checking every refresh means that case self-corrects on the next one rather than persisting for a week. The first add of a just-finished contest is still the proof.

A `contest.practiceSyncedAt` stamp existed briefly, so a one-time backfill could flag contests stored before this feature without re-running forever. It is gone — the one install was backfilled and its ten CodeChef contests verified against the live API, so per the no-back-compat rule at the top of this file the normaliser came out rather than living in the tree. **Don't reintroduce a stamp to re-check unflagged contests**; that is the sweep the cost argument above rules out. Records written during that window still carry the vestigial key, and nothing reads it.

Note the expansion's opt-in is the one part of this **no unit test reaches** — removing it leaves the whole suite green. `npm run smoke` covers it: the store seeds START252D with an unmirrored problem, and the run fails unless the queue omits it while the contest's expansion lists it with exactly one mark. Confirmed the usual way, by removing each piece and watching the run report the original symptom.

### Data acquisition on Codeforces: two channels, both required

1. **Signed API** (`core/platforms/codeforces/api.js`) — builds the `apiSig` (SHA-512 over `rand/method?sortedParams#secret`) via `crypto.subtle`. Used for `user.status`, `contest.ratingChanges`, `contest.standings`, `user.info`.
2. **HTML scraping** (`core/platforms/codeforces/scraping.js` → `core/platforms/codeforces/http.js`, parsing in `core/platforms/codeforces/standings-dom.js`) — the standings page is the only source for problem names/URLs and official in-contest solve counts. `problemStatistics.solvedCount` is *not* a substitute: it counts all-time solves including practice, which the estimator can't use.

**`services/request-pacer.js` is the only pacing mechanism**, and every caller configures it. An earlier version of this file claimed each platform already paced through it; that was false for Codeforces, which had two paths and used neither. The scrape carried its own `HttpClient` with a hard-coded jitter range and cooldown, and **the signed API was paced by nothing at all** — the tell being three hand-rolled `await delay(2000)` calls standing in for it at the call sites that had noticed.

| caller | configuration |
|---|---|
| `atcoder/problems-api.js` | `gapMs: 1100` |
| `codechef/api.js` | `gapMs: 1500` |
| `codeforces/http.js` (scrape) | `gapMs: [1000, 2500]`, `measureFrom: "end"`, `cooldown: { everyNth: 15, gapMs: [6000, 12000] }`, `credentials: "include"` |
| `codeforces/api.js` (signed) | `gapMs: 2000` |

Each caller makes its own pacer, so budgets are independent — `HttpClient`'s counter was a single static shared by everything, which is now per-instance state and structurally impossible to cross.

**`measureFrom` exists because of a real difference, not for symmetry.** `"start"` waits until `previousStart + gap`, so a slow request eats into the next gap. `"end"` waits the full gap after the previous request *finished*, and waits it before the first request too — which is what `HttpClient` did. They diverge exactly when a request outlasts the gap, and collapsing them onto `"start"` silently makes the Codeforces scrape **faster**. Even sampled, adding a contest issues tens of requests, and these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing. `tests/request-pacer.test.js` fails on that specific collapse; it was confirmed by making it and watching exactly those two assertions go red.

Requests queue through a promise chain rather than each checking the clock. `HttpClient` had a variant of the flaw that guards against: it slept a random interval per call with no queue, so two concurrent callers slept in parallel and then fired together. It was latent rather than live, since every scrape call site is a sequential `await` — but absorbing it closed the hole rather than preserving it.

**Confirmed in the real extension**, by removing a tracked contest and adding it back on all three platforms. That exercises the newly paced signed API end to end alongside the throttled scrape, solved marking and the backup write — the pacing was the one behaviour change here with real risk, since nothing about a response says whether a delay was served.

What that does *not* reach is the waiting branches: those contests were already published, so the problemset gate passed immediately and the gym phase check saw a finished contest. A round fresh enough that Codeforces has not indexed it yet is still the only way to see `notPublishedYet` fire on the add path.

Codeforces' own half stays in `codeforces/http.js`: `credentials: "include"` so the user's session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error. The cooldown logs at `console.info` rather than `console.warn`, because `chrome://extensions` collects warnings alongside errors and a normal add was otherwise filing a row there every 15 requests — the same trap the waiting-contest logging was fixed for.

### Rating estimation pipeline

`core/contest-manager.js#processNewContest(url)` is the orchestrator, and the adapter answers it
with one of the five statuses above. Given a `/contest/<id>` or `/gym/<id>` URL:

1. **Is it ready at all?** — asked before any work, because the answer is usually cheap and the
   work is not.
   - *Official*: is the contest in `problemset.problems`? Codeforces publishes problems there
     already rated, so present-and-rated arrive together and absence is the whole question. Absent →
     `notPublishedYet`, and **nothing is scraped** — the alternative was tens of throttled requests
     spent producing an estimate that `problemset-sync` would overwrite. The response is cached for
     60 s so the check and step 3 don't fetch ~2 MB twice.
   - *Gym*: has it finished? Gyms are never in the problemset, so they skip that check entirely —
     applying it would make every gym unaddable. Phase comes from `contest.standings`' own `contest`
     object, or from the problems-page sidebar (`.contest-state-phase`) when standings are hidden.
     Still running → `notEndedYet`. An unreadable phase proceeds: refusing on a label we can't read
     would make a contest unaddable for a reason we can't state.
2. `platforms/codeforces/solve-stats.js` — scrape problems from the standings header row. Official
   contests read solve counts from the "Accepted" totals row; gyms instead count
   `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties. Returns
   `solveCountsRead`, false when the totals row wouldn't parse.
3. `platforms/codeforces/problemset-sync.js` — apply Codeforces' published ratings and tags.
   Anything rated here needs no estimate, which is why it runs *before* the expensive steps.
4. `platforms/codeforces/rating-distribution.js` — produce the participant rating distribution, as
   **strata**: `{ strata: [{ ratings, scale }] }`, where `scale` is how many real competitors one
   read competitor stands for. Official: `contest.ratingChanges` `oldRating`s at scale 1; if empty,
   fall back to sampling the standings (below). Gym/ICPC: build from `contest.standings`, collapsing
   each team into one effective rating via `computeTeamRating` (binary search for R where the
   product of per-member loss probabilities is 0.5). Hidden-standings gyms recover the same field
   from who submitted, via `getGymRatingDistFromParties`.
5. `rating-estimator.js` — binary-search the rating R whose Elo-expected solve count, summed over
   the strata and weighted by each one's scale, matches actual solves; round to the nearest 100,
   floor 800. Zero solves targets 0.5 expected solves rather than 0 — which drives the estimate to
   the **ceiling**, not the floor.
6. Mark already-solved problems from `user.status`. A gap surviving all of that means no measurable
   field, and for a **gym** that is permanent — private or empty standings don't become visible
   later — so it answers `unavailable` and refuses rather than waiting. Codeforces stores only when
   every problem has a rating (`canEstimate: true`, see above); there is intentionally no
   default-1500 fallback, and reintroducing one would silently corrupt the queue's sort order.

### Sampling the field (`codeforces/scraping.js`)

When `contest.ratingChanges` is empty — which is exactly the freshly-finished contest you most want to upsolve — the participant distribution has to come from the standings pages. Reading all of them costs one throttled request per 50 competitors, so a big round ran to hundreds of requests. `sampleParticipantHandles` reads ~32 instead, regardless of turnout.

**Do not "simplify" this to a uniform random sample of pages.** It was tried and measured: standings are rank-ordered, so a page is a narrow band of near-identical ratings rather than a random slice. Sampling pages at random is cluster sampling with near-total intra-cluster correlation — 20 pages of 50 behaves like 20 draws, not 1000 — and estimates land 400–800 points off. Spreading pages evenly fixes the variance but biases estimates *downward*, because a random start offset can skip the very top of the field, and hard problems are decided almost entirely by the strongest few competitors.

What works, and what's implemented, is two strata:

- **Head** — `HEAD_PAGES` (10) read in full at scale 1. Small, but it's what rates the hard problems.
- **Tail** — `TAIL_PAGES` (20) at even intervals over the remainder, scaled by the competitors each represents.

Verified against **real** rounds captured in `tests/fixtures/real-contest-fields.json` (rank order, pre-contest ratings and in-contest solve counts, all from the API): 14 of 15 problems reproduce the full-field rating exactly, one is 100 off. Real rank/rating correlation is about -0.65, not -1, so pages cluster less than a synthetic sorted field suggests — don't re-verify this with simulated data. Contests of 30 pages or fewer are still read whole, since sampling would cost the same. The last page is confirmed to actually be last before its number is used to size the field — a wrong count would undercount the field and skew every rating.

#### Gyms whose standings Codeforces has hidden

A gym can be set to **"Standings will not be visible as original contest"**. When it is, both
halves of the acquisition path die at once: the standings page carries no `table.standings`, and
`contest.standings` answers `FAILED — "contestId: Standings are not available"`. That was terminal
— and worse than a wait, since a gym could not wait at all, so the contest never even
became a waiting entry. It now answers `notEndedYet` while running and `unavailable` when finished
with no visible field. Verified on gym 712373.

**`contest.status` still answers**, and it carries everything the standings response was mined for.
`platforms/codeforces/contest-submissions.js` derives it — `summariseSubmissions` is pure over the submission array so it tests
without a network stack. Against 712373's real 103 rows it reproduces the contest page exactly —
A x12, B x12, C x12, D x4, E x6, F x1 — which is the fixture `tests/fixtures/gym-standings-hidden.json`
and the thing `tests/contest-submissions.test.js` pins.

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
  CLAUDE.md's rules say must fail loudly rather than be routed around. `tests/gym-hidden-standings.test.js`
  is mostly about what the branch must *not* touch; it stubs the service to throw if a healthy gym
  ever reaches `getContestStatus`.
- **Practice submissions are excluded, and that is what makes the counts right.** A gym closes when
  it ends, so practice solves say nothing about how hard a problem was during it — and the estimator
  is fitted to exactly that quantity. Including them breaks 8 of the 12 derivation tests. Ghost
  parties are excluded too, matching the standings path, and a party is counted once per problem
  however many times it resubmits.
- **`participantTypes` matches `getContestStandings`' `CONTESTANT,VIRTUAL`** so both gym paths mean
  the same thing by a "solve". 712373 happens to have no virtual entrants, so that choice is
  unexercised there.
- **With no official submissions at all, `solveCountsRead` is false.** All-zero counts are
  indistinguishable from "nobody solved anything", and handing those to the estimator floors every
  problem at 800 (`rating-estimator.js:45,62`) rather than refusing.

The field is recovered from who submitted, through `getGymRatingDistFromParties`. Everything below
the handles — `user.info` chunking, `computeTeamRating`, the strata shape — is shared with the
standings path via `ratePartyList` so the two cannot drift. Note this field is **narrower** than a
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
`tests/standings-dom.test.js` keeps the real sidebar markup plus a test asserting that the
*standings* chain still returns "→ About Contest" on it — which is what makes the split legible.
Note the name is read once at add time and never re-read, so a contest added under the wrong name
keeps it until removed and re-added.

Both halves are now confirmed against the live site: `contest.status` against the API, and the
problems-page parser by a real add of 712373, which found all six problems with correct indices and
names. `curl` still gets a 403 from this machine (see below), so the tests remain synthetic apart
from the captured sidebar markup.

### You cannot fetch Codeforces HTML from a dev machine

`codeforces.com/contest/<id>/standings` answers a plain `curl`/`fetch` with a Cloudflare interstitial — HTTP 403 and a "Just a moment" body — regardless of User-Agent headers. Browser-like headers don't help; the extension only gets through because it runs inside a browser with a real session. **Don't burn time trying**; the API (`codeforces.com/api/*`) is unaffected and answers fine.

The consequence is that the HTML half of the pipeline is verified against synthetic markup (`tests/scraping.test.js`) and against real *data* pulled via the API (`tests/fixtures/`), but never against a live standings page. If a selector assumption is wrong, the failure modes are deliberately safe rather than silent: an understated page count either takes the walk-every-page branch or trips the `hasPageLink` guard (slow but correct), a missing contest name falls back to `Contest <id>`, and an unreadable totals row refuses loudly. The residual risk is a slow add, not a wrong rating. Adding a just-finished contest in the real extension is the only way to confirm it.

### Scraped markup is quarantined in `codeforces/standings-dom.js`

Every CSS selector and parsing rule for Codeforces' HTML lives in that one file, with ordered fallback chains (contest name tries `.contest-name`, then `.caption`, then `<title>`). A CF layout change should be a one-file fix.

**Extractors return `null`, never a plausible default.** This is the important invariant. The old code left solve counts at `0` when the totals row went missing and `parseInt(...) || 0` turned an unparseable cell into a zero — so a markup change didn't break anything visibly, it produced *confidently wrong ratings* that were stored and sorted like real ones. Returning `null` forces the caller to decide.

`contest-manager.js` makes that decision as late as possible: it only refuses when unreadable counts actually matter, i.e. when some problem has no published rating to fall back on. A rated official contest doesn't need the totals row at all.

### Tags and published ratings

Both come from `problemset.problems` via `problemset-sync.js` (`tag-service.js` now only counts tags for the stats view). Ratings are preferred over estimates — same quantity, measured rather than inferred — and `problem.ratingSource` records `"official"` or `"estimated"`. Because CF publishes ratings days after a round, the weekly re-check means estimates converge to real ratings over time; a contest added right after it ends starts estimated and settles.

The tag source differs by contest type:

- **Official** — `problemset.problems`, one ~2 MB request covering all ~11k problems, keyed by `contestId-index`. The per-contest alternative (`contest.standings`) also returns tags but embeds every participant row — ~12 MB for one Div. 3 — so it must not be used in a loop. Note this endpoint rejects `from`/`count` for non-gym contests; it only answers anonymous parameter-less GETs.
- **Gym** — absent from the problemset entirely. Tags *and the published rating* are lifted from the `problems` array of the standings response that adding a gym already fetches (`solve-stats.js#applyStandingsProblemData`). Tags are usually empty, since gyms sit outside CF's taxonomy — but **about a third of gym problems carry a `rating`**, and taking it is not optional decoration.

  Those are problems the setter picked from the CF archive rather than preparing in Polygon, so CF still recognises them and serves its own number; problems written for the contest have none and are estimated as before. Measured over the 62 stored gym problems CF also rates, the estimate was a mean **211** off with 14 out by 400+, so ignoring the published value — which this code did until it was noticed — actively mis-sorted the queue. A one-time correction of the affected install was applied through Import rather than left as a normaliser, per the no-back-compat rule at the top of this file.

  **Don't add a recurring gym re-check.** A gym rating is inherited from an already-rated archive problem, so unlike CF's editable tags it never appears later. Re-checking would cost one `contest.standings` per gym per refresh forever, and the gyms with no rated problems would never resolve — the same sweep the CodeChef practice-flag section argues against.

  Note this shrinks `needsEstimate`, so a fully-rated gym now skips `estimateMissingRatings` — and with it the **second** `contest.standings` fetch `rating-distribution.js` makes for a response `solve-stats.js` already had. That duplicate is still paid whenever anything needs estimating.

  Worth knowing before trusting the number: a setter *can* keep the rating and replace the statement — CF supports it directly ([Rewrite Statements in Mashups](https://codeforces.com/blog/entry/84795)), to stop trainees googling the editorial. The official test set is unchanged and the form warns when the formulas differ, so the rating still describes the problem being judged; the residual risk is a rewrite that quietly strips a hint. Of the 62, 55 match exactly one archive problem by name with an identical rating and zero disagreements, and a re-*upload* of a rated contest inherits nothing at all (gym 100001 has no ratings and its problem name drifted to "Spreadsheets").

`contest.publishedDataCheckedAt` records *when* the platform was last asked for what it publishes, which is what distinguishes "not fetched yet" from "genuinely untagged" — without it, contests whose problems have no tags would be re-requested forever.

CF tags are editable after publication, so a problem can gain tags days later — about 1.6% of the problemset is untagged at any time. `syncOfficialProblemData` therefore re-checks a contest that still has bare problems, but only once a week; contests where every problem is tagged are never re-requested. It runs at add time and from the refresh, and costs at most one request per sync regardless of how many contests are stale.

### Start times

`platforms/codeforces/start-times.js` fills `contest.startTimeSeconds`, which orders the contest list. Contest IDs are *not* chronological (2205 ran a day before 2200), so sorting by ID is not a substitute.

- **Official** — `contest.list`, one ~400 KB request. A finished contest's start time never changes, so unlike tags there's no re-check: a contest is asked about once and only if the field is missing.
- **Gym** — `contest.list?gym=true`, but private gyms and mashups (the 6xxxxx IDs) don't appear there at all. Those are covered at add time from `standings.contest.startTimeSeconds`, which `solve-stats.js` already has in hand. Anything still unresolved sorts to the bottom rather than being treated as ancient.

`progress-manager.js#updateSolvedStatus()` re-syncs on demand: re-fetches accepted submissions, flips `prob.solved`, drops fully-solved contests from storage, and returns the removed ones so the UI can announce them.

### Storage split — this is deliberate

- **`chrome.storage.local`** (`services/storage.js`, `LocalDB`) — `trackedContests` array, keyed by `platform:id` (see the platform registry above), plus settings under dotted keys `upsolve_tracker.handle` and `upsolve_tracker.auto_export`. This is what the Export/Import JSON backup dumps wholesale.
- **IndexedDB** (`services/secure-store.js`) — API key/secret and the `FileSystemDirectoryHandle`. Credentials live here specifically so they never land in an exported backup; the directory handle lives here because handles aren't serializable into `chrome.storage`.

`LocalDB` deliberately holds only the tracked-contest methods. Settings are read directly from their dotted keys (`upsolve_tracker.handle`, `upsolve_tracker.auto_export`, `upsolve_tracker.platform_filter`, `upsolve_tracker.tag_rating_range`), and solved state is derived fresh from `user.status` on every sync rather than cached. Earlier accessors for a `cfHandle` key and a `solvedCache` were removed — nothing wrote them.

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

A rating the extension **modelled rather than measured** — AtCoder's own low-confidence models, or
anything the Codeforces estimator produced, which on a gym is most problems — is marked with a
**dotted underline** (`.rating.is-estimated`), not with a glyph beside the number. An unmarked
number reads as exact, and these run a mean 211 off.

**A `~` was tried first and cost four consecutive layout bugs**, which is the reusable lesson here:
a mark that occupies width competes with the digits for space, and every way of settling that
competition broke something else.

1. In a contest's expansion it was a fifth child of a four-column `subgrid`, so it dropped onto the
   line *below* every marked row.
2. In the queue it sat outside `.rating`, where `.meta-line`'s flex gap detached it from its number
   and shoved that number sideways.
3. Reserving a column for it — always rendered, `visibility: hidden` when unused — keeps the digits
   stacked, which nothing asked for, and started every *unmarked* number a character from its
   platform mark: equal across rows, but far enough that the column read as right-aligned, which
   was the thing being fixed.
4. Drawing it out of flow (`width: 1ch` against `margin-left: -1ch`) to reclaim that space wedged it
   against the platform mark, ink 0.7px inside it.

A decoration occupies no width, so none of it arises — and it doubles as the "there is an
explanation attached" cue. The `title` therefore moved onto `.rating` itself: on the glyph it made
a ~6.7px hover target and hovering the number did nothing at all.

Details settled by looking at a 6× render of real rows across the rank tints, not by reasoning:
**dotted at 1px**, `text-underline-offset: 3px`, in `currentColor` so a Codeforces rating keeps its
band colour through the rule. Dashed at this size reads as an almost-solid line and gets confused
with a link; 1.5px dots start competing with the digits. The defaults for thickness and offset are
font-derived and land too tight to read at `--rating-size`, so both are set explicitly.

Because the mark costs nothing, `.rating` needs only `min-width: 4ch` — the widest a rating gets,
AtCoder's negatives included (`-817`). It is **left-aligned**, which is what makes the gap between
the platform mark and the number identical on every row; right-aligning pins the last digit instead
and pushes a three-digit rating an extra character from its mark. `.solve-chance` is `4ch` and
right-aligned for the opposite reason — there the ones digit is what should stack, `~9%` under
`~26%`.

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

**The ring** (`ui/platform-ring.js`) shows pending problems per platform, from the same `collectPendingProblems()` the queue uses, so the two cannot disagree. Colour encodes **identity**, so each platform's `chartColor` is fixed on its descriptor and never assigned by size — filtering must not repaint the survivors. Those hues come from a validated categorical theme rather than the brand colours, which fail the chroma floor as fills (AtCoder brands achromatically, CodeChef's brown reads gray); the icons keep carrying brand identity in the legend. The three are **checked together, not individually** — changing one means re-checking all three together against the dark surface — with the dataviz skill's validator, which is **not a script in this repo**, so the numbers recorded here are the durable artifact rather than something a reader can regenerate from the tree. Codeforces yellow `#c98500`, AtCoder blue `#3987e5`, CodeChef red `#e34948`; that last pair sits at CVD deutan ΔE 6.2, inside the 6–8 band, which is legal only because every swatch carries an icon, a full name and a count beside it. `#c0392b` is the zero-warning fallback if the legend ever loses its labels.

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

### Fonts are bundled, and that is load-bearing

`core/ui/fonts.css` ships **Inter** and **JetBrains Mono** as woff2 from `public/fonts/`,
imported by both `style.css` and `options/options.css`. Before this the stacks named both
and shipped neither, so what actually rendered was the tail of each — SF Pro and SF Mono on
a Mac, Segoe UI and Consolas on Windows — and the panel looked different on every machine.

**SF Pro cannot be substituted for Inter**: Apple licenses it for Apple platforms only, so
it may not be redistributed in an extension. Inter is the closest bundleable face and was
what the stack always named first.

Details worth not rediscovering: they are **variable** fonts, so one file per subset covers
400–700 rather than one file per weight; only `latin` and `latin-ext` are shipped, since CJK
would add megabytes for the occasional Japanese AtCoder title; `font-display: block`, because
the files are local and a swap would flash. Both are SIL OFL 1.1 and the licences ship
alongside them in `public/fonts/`, which the licence requires.

The `url(/fonts/…)` paths are absolute because an extension resolves them from its own root.
`npm run smoke` opens the build over `file://`, which resolves them from the *disk* root
instead, so the harness rewrites them to relative — the absolute form was verified separately
by serving `dist/chrome` over http. The smoke run now asserts both faces actually load, since
a missing font is otherwise silent: the panel simply renders in whatever the system has. Every `font-family` still goes through `--font-sans` or `--font-mono`; spelling stacks out
per rule is exactly how three rules once landed on Courier New while fifteen sat elsewhere,
which showed up as the queue's contest line looking sharper than the numbers above it.
`tests/stylesheet.test.js` enforces that and forbids Courier as anyone's fallback. The system
faces remain at the tail of each stack, as a fallback for the glyphs the latin subsets do not
cover.

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

### The settings page is generated, one section per platform

`options/index.html` holds only the intro and the Backup section. Everything platform-shaped is rendered by `options/platform-settings.js` from each descriptor's **`settingsFields`**, and every check runs through `getAdapter()` — so adding a platform touches no file on this page. It used to import all three adapters plus Codeforces' API client directly and hand-write three near-identical sections.

A field declares `key`, `label`, `type`, `placeholder`, `help` and **`store`**: `"local"` for `chrome.storage.local`, `"secret"` for IndexedDB, which is what keeps a key pair out of the exported backup. The keys are the ones already in use (`upsolve_tracker.handle`, `api_key`, `api_secret`), so nothing stored had to move — and a **typo in a secret's key is the one failure here that is silent**, since the value comes back empty and reads as a setting you never saved. `npm run smoke` checks exactly that.

`help` and `label` are authored in the descriptors, in this repo, and are injected as **trusted HTML** so the Codeforces key-pair note can carry a link to its API settings page. That is the deliberate exception to the escaping rule; anything originating outside the extension still goes through `escape-html.js`.

**Verification is four lines, because the adapters already word every failure well** — no handle, unknown handle, signed out, wrong account. Adapters gained `createSessionFrom(values)`, building a session from what is *typed* rather than what is stored, so a wrong key tells you before you rely on it; `createSession()` is now that same function over saved values. This deleted real duplication: the page used to re-check `session.signedIn` itself and compose its own CodeChef "signed out" message, so one condition read differently here and in the queue's status strip. Settings now shows the adapter's wording, which is what the queue already showed.

Three CodeChef *failure* verdicts changed wording as a result — signed out, wrong account, and site unreachable. The success line did not: it read "✓ Signed in as <handle>" and still does, because `verifyIdentity` throws unless the two match, so the resolved account and the configured handle are the same string by the time it renders. Codeforces' transient "Checking…" also lost a green tint it should never have had; it is not a success.

The *"Connected as"* / *"Signed in as"* distinction survives as `describeIdentity` on the adapter — the handle is looked up on two platforms and **is** the session on CodeChef — because putting it anywhere else makes it a branch on the platform in shared code.

**How a section verifies is the descriptor's call too.** `verify: { trigger: "button", label, help, incomplete }` for Codeforces, where three fields must be filled before a signed request means anything; `{ trigger: "change" }` for the other two, which check on load and on change. That keeps the *"Test connection"* button rather than unifying it away.

The CSS is now one rule, `.status-text[data-status]`, with spacing scoped to `.form-group > …` so the button's inline verdict — which `.test-row` already spaces with `gap` — is excluded. The three parallel id rules this replaces are precisely how they drifted: Codeforces and CodeChef each had their own `0.85rem` block while AtCoder's had **no rule at all** and fell back to the body's 16px. The old instruction to "add a fourth platform to those two selectors" is gone; a new platform picks the treatment up by existing.

### UI shell

`core/ui/index.js` defines `<upsolve-app>`, which clones the `#tpl-app` template from `index.html` and hand-rolls a router over three views in `#router-outlet`: `<upsolve-queue-view>`, `<upsolve-contest-list>` and `<upsolve-stats-view>`. Navigation is the tab bar; the header holds only refresh and settings, which act on the app rather than on a view. Views import their markup with Vite `?raw` imports and set `innerHTML`, and are **destroyed and rebuilt on every tab switch** — which is why selections that should survive (the contest type filter, the tag rating range) are persisted to `chrome.storage.local` rather than held on the instance.

**Adding a contest is a contextual action, not a navigational one.** The offer only exists when the active browser tab is on a contest page, so it lives in the shell as a banner above the tab bar — visible from any view — rather than inside the Contests view, where the button spent most of its life greyed out. The `chrome.tabs` listeners live in `index.js` for the same reason: they have to outlive any single view.

Two conventions the shell depends on:

- **`refreshData()`** — called on the current view after a global refresh. A view that needs post-sync updates must expose it; `queue-view` also takes the removed-contest list to announce.
- **`cf-status` event** — views report long operations by dispatching a bubbling `CustomEvent` that the shell renders in its status strip (`null` clears it). That's how adding a contest narrates its stages without each view growing its own progress UI. The same `onProgress` callback is threaded through `processNewContest` and `updateSolvedStatus`; stages that no-op stay silent rather than claiming work they skipped.

`queue-view` flattens all unsolved problems across contests and sorts by solve probability (see above), and shows a setup prompt when `hasCompleteSetup()` is false — which now means *any* platform is usable, not specifically Codeforces, since AtCoder needs only a handle and CodeChef needs nothing at all — without it, a missing handle or API key made refresh look like a dead button. **The prompt names the platforms from `listPlatforms()`** rather than spelling them out in `queue-view.html`, which is how it came to offer two out of three: CodeChef was added and that sentence was not. The platform filter (`ui/platform-filter.js`) is shared by both list views. It is a **dropdown**, not a chip row: chips grew with every platform added and competed for width with the very list they filter, whereas one control stays one line however many platforms exist. The collapsed button shows the active selection as marks plus "2 of 4", so what is filtered stays readable without opening it.

Its groups come from `listFilterPlatforms()`, so a new platform appears without touching either view. The list is **flat**: every group is one row carrying its platform's mark and naming itself in full, so no row depends on a header above it. Codeforces contributes two rows (Official and Gym) because that distinction is worth practising against; platforms with many subtypes contribute one, since nobody wants five AtCoder rows. An empty selection means **no filter**, not "show nothing".

`ui/dismissable.js` supplies close-on-outside-click and close-on-Escape, shared with the contest row's ⋮ menu; it listens in the capture phase so a handler that stops propagation cannot leave a popover stuck open.

**A contest row is an accordion.** Clicking it expands in place to show what that contest still owes the queue, rendered with `problem-row.js` so the expansion and the Queue cannot disagree — positions are omitted there, since the queue's numbering is global. The expansion is scoped to one contest rather than deduplicated against the others: a problem shared with another division really is in both, and hiding it would make the contest look shorter than it is. Expanded keys persist to `upsolve_tracker.expanded_contests`, because the view is rebuilt on every tab switch. **There is no chevron** — the expansion appearing is the indicator, with `aria-expanded` for anything that can't see it.

The row carries a **⋮ menu** holding *Open contest* and *Remove from queue*; the row is a `<button>`, not an anchor, so clicking it no longer leaves the panel. The menu button stops propagation, or opening it would toggle the accordion underneath.

**Removal asks first**, replacing a 700 ms hold on a ✕. The hold existed so "a stray press does nothing at all", and a dialog is a better guard than a timer because it says what is about to happen. Confirming still has to call `writeBackup()`, or the exported JSON drifts from the panel.

`contest-list` watches `chrome.tabs` events to enable "+ Add Contest" only on a supported contest page, sorts by `startTimeSeconds` (newest first, unknown last), and deletes on a 700 ms hold rather than a click so a stray press does nothing at all.

### Platform marks

Each mark lives on its **descriptor**, beside `chartColor` — a platform's own appearance is its own to declare. `core/ui/platform-icons.js` keeps only the fallback and the design rules that apply to all of them, and asks the registry. It uses `listPlatforms().find(...)` rather than `getPlatform()`, which **throws** on an id it does not know: the text-chip fallback is the whole point of the function, so a platform without a mark yet must show something rather than take the panel down.

AtCoder's is deliberately light-on-dark, inverting its black-on-white branding, because a `#222` square on the `#1e1e1e` panel is close to invisible.

A platform with no mark yet falls back to a text chip rather than rendering nothing.

### Untrusted input

Views build rows with template strings and `innerHTML`, so anything originating outside the extension goes through `ui/escape-html.js` first. That covers contest names, problem names and tags (scraped or API-supplied), and the problem URL and source label, which are both built from a scraped problem index. Values the extension derives itself — counts, ratings, the type badge — don't need it.

**One deliberate exception, and it is the only one:** the settings page injects each descriptor's `label` and `help` as trusted HTML, so the Codeforces key-pair note can carry a link to its API settings page. That text is authored in this repo, in `platforms/<id>/descriptor.js`. Nothing reaching that path comes from a platform or a user — and if a descriptor ever grows a field whose text does, it must be escaped like everything else.

`backup-validation.js` guards Import, which writes straight into `chrome.storage.local` with no undo. Note it uses `.some()`, not `.find()`: a `null` entry in `trackedContests` is itself falsy, so a truthiness check on `find`'s return value silently accepted malformed backups. There's a test for exactly that case.

**The exported backup is how you inspect the real queue from outside the browser.** `chrome.storage.local` is unreachable from a shell, but auto-export writes the whole store to `upsolve_tracker_backup.json` in whichever folder the picker points at — on this machine, `~/Workbench/__pinned__/upsolve-tracker/`. That is what made it possible to confirm the practice-mirror work against the actual 65 tracked contests rather than against fixtures, and to cross-check every stored flag against the live CodeChef API. It is only as fresh as the last refresh or add, since those are what call `writeBackup()`.

**Auto-export gotchas** (`services/auto-export.js`, used by both the add-contest handler and the global refresh):

- `verifyExportPermission()` must be called *before* the slow await in a click handler, because a `FileSystemDirectoryHandle` re-permission prompt only succeeds while the user gesture is still fresh. Moving it after the network work breaks auto-export after every browser restart.
- Any path that mutates `chrome.storage.local` must call `writeBackup()` afterwards. The refresh writes solved status and tags straight to storage, so without that call the on-disk JSON silently drifts from what the UI shows — which is exactly how tags ended up visible in the extension but missing from the backup.
