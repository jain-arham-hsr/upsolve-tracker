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

`npm test` covers the parts that fail *silently*: the estimator's maths, the standings parsing, the sampling arithmetic (via `platforms/codeforces/estimator.sampling.test.js`, against captured fields, so no network is touched), backup validation and queue ordering, and what an unrated problem means (`contest-gap-policy.test.js`, which drives the real `processNewContest` because the decision and the error carrying it are both inside it) — plus three things that are invisible by nature. **Request pacing** (`request-pacer.test.js`, `platforms/codeforces/api.test.js`, `platforms/codeforces/scraper.test.js`): nothing about a response says whether a delay was served, so pacing can be removed without any other test noticing. These are the only tests here that assert on **wall-clock time**, so they are also the only ones that can flake on a loaded machine — and the two kinds behave differently. The two Codeforces client tests assert a **lower bound** (`gap >= 50` against a pinned 60ms), which a stall can only make more true. `request-pacer.test.js` asserts **both directions** via its `near()` helper, including two `near(…, 0, 40)` checks that a request should *not* have waited — a 40ms stall fails those. **If one goes red on CI and nowhere else, widen the tolerance; do not touch the pacing.** The pinned gaps are test-only anyway, set through `platform.reset(ms)` and each `Api` and `Scraper` class's static `reset(ms)`; production values are in the table below. **The platform boundary** (`module-boundaries.test.js`). And **the settings page's markup** (`options-settings.test.js`), which is generated from the descriptors and so is assertable in Node. There is no linter or formatter configured.

**Adapter fixtures must be cloned per test, not shared.** `platforms/codechef/platform.test.js` keeps its payloads in module-level consts (`PROBLEMS`, `DETAILS`) that the `fetch` stub reads directly, so a test modelling "CodeChef published this later" — flipping `is_added_to_practice`, or filling in a `difficulty_rating` — mutates the fixture for every test that runs after it. The suite then passes or fails on *ordering*. `beforeEach` deep-copies both; do the same for any fixture a test writes to.

```bash
npm run build:chrome && npm run smoke   # loads the built panel in headless Chrome
```

**`npm run smoke` is the only thing that executes a view.** It loads the real bundle from `dist/chrome` with the extension APIs stubbed, clicks all three tabs, drills into a platform on Stats, and fails on any uncaught error, rejection or `console.error` — plus on a view that renders implausibly little, since the queue answers a missing setup with a short prompt that would otherwise read as success.

It exists because of a specific escape: `contest.tagsSyncedAt == nullAt` is valid JavaScript (that field is `publishedDataCheckedAt` now), so `node --check` passed, the build succeeded, the whole unit suite stayed green, and the Stats tab threw on render for every user. Reintroduce that bug and the unit tests still pass while the smoke run fails — that is the gap, and it is worth re-checking that way after changing the harness.

Two things it needs that are easy to get wrong: the built HTML uses absolute `/assets/` paths that `file://` cannot resolve, and `window.indexedDB` must be installed with `Object.defineProperty` — it is getter-only, so assignment fails silently, and real IndexedDB is unavailable on `file://`, which makes the secret read behind `settings/store.js#getSettings` reject and leaves the queue stuck on its setup prompt.

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

Confirmed the usual way: renaming the schema's `api_secret` slug reports *"the stored API key pair did not load into the form"*, which is the one failure here that is otherwise silent — a secret read under the wrong key comes back empty and looks exactly like a setting you never saved.

`tests/platforms/codeforces/estimator.sampling.test.js` deliberately asserts that uniformly random page sampling is *worse* than the stratified design, so the rejected approach can't quietly come back.

`tests/platforms/codeforces/estimator-accuracy.test.js` records a **known bias**: estimates run below Codeforces' published ratings, by up to ~300 on the hardest problems.

**Do not confuse two different 14-of-15 figures.** The one in *Sampling the field*
(`core/platforms/codeforces/CLAUDE.md`) is
**sampling fidelity** — the ~1,500-competitor sample reproduces what reading the whole field
would have produced, for 14 of 15 problems. It says nothing about whether the model agrees
with Codeforces. Measured directly against the 15 published ratings in
`fixtures/real-contest-fields.json`, the estimator scores **mean |error| 100, mean signed
error −73, 6 of 15 exact, none out by 400**. Good, and visibly biased low — which is the
bias this file records, not an absence of one. An earlier version of `DATA.md` had merged the
two and claimed the model reproduced 14 of 15 *published* ratings; it does not. The Elo model assumes everyone attempted every problem, when most never open the hard ones — non-attempts read as difficulty-driven failures, so the model over-predicts solves and the search settles too low.

**"Model attempts, not ability" was the suggested fix, and it is wrong.** It was measured against 62 gym problems where CF publishes a rating — a real labelled set — and fitting only the parties that actually submitted took mean absolute error from 213 to **374**, with the bias swinging to −310. CF's own ratings are calibrated over everyone who *entered* the round, not everyone who opened the problem, so conditioning on attempters leaves the definition rather than correcting for it. Six other levers were tried and all were neutral or worse (attempt blending, shrinkage to the contest mean, the zero-solve target, the 800 floor, team collapsing by max/mean, Elo divisors 200–1000); the file lists the numbers so none is retried. Enforcing difficulty order across a contest was rejected before measuring — only 2 of 8 contests are actually sorted.

The residue is not reweightable: fed data from its own model at those field sizes the estimator has an irreducible error of 87 against an actual 213, so ~126 points is model misfit — most likely because the two numbers measure different things, difficulty for a two-hour CF round versus for a handful of teams sharing a machine over five ICPC hours. The response is honesty rather than accuracy: `ui/problem-row.js` marks an estimated rating with `~`, so a ±200 number does not read as exact.

It matters less than it did, because published ratings are now preferred wherever they exist — official contests and the ~32% of gym problems CF recognises, both via `codeforces/api.js#applyStandingsProblemData`.

The build is still target-parameterized (`TARGET` selects `targets/<name>/manifest.json` and `dist/<name>`), but only `chrome` exists — the previous `dev:firefox` / `build:firefox` scripts were removed because they failed at config load. A real Firefox target needs more than a manifest: `targets/chrome/` depends on `chrome.sidePanel`, which Firefox answers with `sidebar_action`, and CRXJS emits a Chrome-style service-worker loader. Everything under `core/` already sticks to APIs both browsers implement.

Pushing to `main` triggers `.github/workflows/release.yaml`: it runs `npm test`, builds Chrome, reads the version from `targets/chrome/manifest.json`, **deletes any existing release/tag with that version**, and republishes. Bump the manifest version when you want a distinct release; leaving it unchanged silently replaces the previous one — and because the workflow re-creates the tag, the old tag is *moved to the new commit*, so a span of work can end up filed under a version that was already published. That happened between the first v2.1 and v2.2. `package.json`'s version is decorative (nothing reads it); keep it in step with the manifest anyway so the two never disagree.

A docs-only or comment-only commit needs **no** bump: the built bundle is unchanged, so re-publishing the same version is correct and simply moves the tag forward to include it. Bump only when what ships differs. Note `gh` is **not installed** on this machine, so the workflow's result cannot be checked from a shell — look at the Actions tab.

The test step is the gate: before it existed the workflow would happily build and publish a release from a red tree.

## Build model

`vite.config.js` reads `targets/$TARGET/manifest.json` and hands it to `@crxjs/vite-plugin`, outputting to `dist/$TARGET`. Consequences:

- **`host_permissions` is composed at build time**, not listed in the manifest. `vite.config.js` imports `registry.js` — which is pure ES modules and loads under plain Node — and flattens each descriptor's `hostPermissions` into the manifest it already reads. Chrome needs these declared statically, but nothing requires a human to keep the list in step, and "remember to also edit the manifest" is exactly the step that gets missed. The composed list is verified against the previously hand-written one by diffing `dist/chrome/manifest.json`; the key is a list because a platform may need several origins — AtCoder used to contribute two (`atcoder.jp` and `kenkoooo.com`) before it stopped depending on the second.
- The manifest is the entry-point graph. HTML entries (`side_panel.default_path`, `options_ui.page`) and the service worker point at **source** paths (`core/ui/index.html`, `targets/chrome/background.js`); CRXJS crawls and rewrites them. A new page must be registered in the manifest to be built.
- `@core` aliases to `core/`, though most existing imports use relative paths.
- `core/` is target-agnostic business logic; `targets/<browser>/` holds only the manifest and background worker. Keep browser-specific glue in `targets/`.
- **Everything outside `core/platforms/` is platform-agnostic, and that is now enforced across the whole subtree.** `registry.js` is the only module allowed to know which platforms exist, with `settings/schema.js` as the one named exception below; everything else asks it. Five wholly-Codeforces modules used to sit in shared space — the signed API client, the scrape, its HTML parser, its HTTP client and the start-time sync — plus `secure-store.js` hardcoding three ids and their storage keys (it now stores a secret by slug and knows nothing else), `platform-icons.js` as a three-key map, and a settings page importing all three adapters by name.

  `start-time-service.js` was the instructive one, and an earlier version of this file argued it should stay. It exported `syncStartTimes` (Codeforces-only) *and* `byStartTimeDesc` (a pure comparator `contest-list.js` uses). One genuinely shared export is what kept a Codeforces module looking like shared infrastructure. It is split: the comparator is in `queue-order.js`, the rest is `Platform#syncStartTimes`, the base default that dates contests from a site's `contestList`, which `CodeforcesGyms` extends.

  **`tests/module-boundaries.test.js` previously asserted almost nothing**, and passing green is what made that expensive. It read *one directory* — files directly under `core/` — so `core/services/` and `core/ui/` were never examined; and it recognised a violation by import **path shape** (`./platforms/<id>/…`), which a platform-specific module living outside `platforms/` never has. It could only flag the problem after the move that fixes it. It now walks recursively and checks three things: no import from inside a platform folder, no platform id in comment-stripped code, and no use of a platform's **subtype vocabulary** (`"OFFICIAL"`, `"GYM"`, `"ABC"`) — the leak with no platform name in it. Comment-stripping is essential rather than convenient: every shared module discusses all three platforms in its prose, so a raw scan would fail on documentation and prove nothing.

  There is **one named exception**, `settings/schema.js`, whose `verify.adapter` has to name a platform, with its reason recorded beside it and a test that fails if the file stops needing it. A named exception is a debt the suite keeps visible; the version being replaced hid a whole subtree by accident.

**A second class of leak has its own file, `tests/record-contract.test.js`.** Not a
boundary between platforms but between *modules*: a record handed on without a field
the receiver gates on. The official Codeforces add once passed the metadata syncs a
record built before the trunk had stamped `type` on it, and
the sync's `needsSync` read `contest.type !== "OFFICIAL"` — so it answered
"not official", every official add skipped its published ratings, the estimator ran
on problems Codeforces had already rated, and estimates with a mean error of ~211
were stored in their place. 358 tests passed the whole time.

Three things guard it now, and each was confirmed by reintroducing the bug and
watching it fire:

- **The gate is structural, so there is no field left to misread.** `needsSync` used
  to ask `contest.type !== "OFFICIAL"` of a record whose `type` had not been stamped
  yet; that question is now answered by the folder — it lives in
  `codeforces/official/platform.js`, which only official contests reach, so a gym
  cannot arrive there at all. Where a field genuinely must be read, the rule is to
  throw rather than answer false: `platformOf()` refuses a record with no `platform`
  instead of defaulting. This is the load-bearing one: it makes the whole class loud
  at runtime regardless of what any test covers.
- **The trunk's field list is derived, not written down.** The contract test scans
  shared code for `contest.<field>` reads and asserts `buildContestRecord` emits every
  one. Platform folders are excluded deliberately — there `contest` just as often
  names an API response (`contest.standings`, `contest.phase`) and would pollute it.
- **Execution, not mention.** Whether the published-ratings path *runs* is read from
  `node --test --experimental-test-coverage`, not from grepping tests for
  `subtype: "OFFICIAL"`. That text scan was tried first and was hollow twice over:
  satisfied by the contract test's own fixtures, and then by an existing OFFICIAL
  test that returns `notPublishedYet` long before reaching the gate. Two details keep
  the replacement honest — the probe line is located by content rather than
  hardcoded, since a stale line number would point at some covered line and pass; and
  a missing coverage row asserts loudly rather than skipping, since the child runner
  suppresses the table unless `NODE_TEST_CONTEXT` is cleared.
- `linkedom` is a devDependency used only by the tests (`platforms/codeforces/scraper.problems-page.test.js`, `platforms/codeforces/gyms/platform.test.js`, `options-settings.test.js` and others) to parse HTML in Node; shipped code uses the browser's `DOMParser`.

## Architecture

Vanilla ES modules and custom elements — no framework, no bundled UI library.

### Platform registry

`core/platforms/registry.js` owns which platforms exist, as one instance each. **A platform is its own descriptor**: the class declares everything that depends on *where a contest came from* beside the work it does — `matchUrl`, `contestUrl`, `problemUrl`, `sourceLabel`, `contestLabel`, `solvedKey`, `problemKey`, and a `capabilities` block.

It also answers everything shared code used to hardcode about a platform, which is what makes the boundary hold rather than merely be stated:

| key | what it stops shared code doing |
|---|---|
| `icon` | keeping a three-key map of marks in `ui/platform-icons.js` |
| `chartColor`, `ratingBandClass` | assigning colours or rank tints by id |
| `hostPermissions` | hand-listing origins in `targets/chrome/manifest.json` |
| `ratingGraceMs` | hardcoding how long *this* site takes to publish a rating |

`registry.js` is the **only** module allowed to enumerate platforms. Nothing else — not a view, not a service, not the build — should branch on one, and `tests/module-boundaries.test.js` fails if it does.

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
left after the estimator has run is a bug and `contest-manager` refuses loudly. **AtCoder now
declares it too**: it runs the same estimator over a contest's own standings, so a problem it
cannot rate is a fault rather than a fact about the problem. CodeChef cannot estimate, so there a
gap is simply a problem the site hasn't rated — it stores `rating: null` and renders "???". This replaced `allowsPartialRatings`, which was never independent: it was the exact
inverse of this on all three platforms, two declarations that had to agree with nothing checking
they did. `???` therefore means exactly one thing — *the site says unrated* — never "we couldn't
find out", which is why a failed request waits rather than producing one.

**And never "not rated *yet*", which is the third case that used to be folded in.** CodeChef
publishes `difficulty_rating` promptly but not instantly — Starters 252 was fully rated within two
days of running — so a contest added the evening it ended stored `???` for problems the site was
about to rate. A timing gap wearing the one meaning `???` is supposed to carry. So a platform that
cannot estimate also declares **`capabilities.ratingGraceMs`**: while the contest is younger than
that, a missing rating is `notPublishedYet` and waits through the ordinary machinery, and only
after it does the site's silence count as an answer. `contest-manager.js` supplies a one-week
fallback for a platform declaring none, and `Platform.check` **refuses** a window declared
alongside `canEstimate: true`, where the branch that reads it is unreachable and it would be
config that looks live.

Two things about it are deliberate. **The window is the platform's and the policy is the
manager's** — how long a site takes to publish is a fact about the site, while what to do about it
is the gap policy, which lives in exactly one place for the reason stated above. And **it is
measured from `contest.startTimeSeconds`, never from the add or the last try**: the record is
rebuilt on every retry, so its `addedAt` is always "now" and an undateable contest would read as
permanently young and wait forever. A contest with no start time is therefore stored rather than
waited on — the safe direction. Note `startTimeSeconds` is epoch *seconds* against `Date.now()`'s
milliseconds, the same factor-of-1000 trap the six-week Codeforces cutoff carries; `ranWithin`
exists to hold the conversion in one place, and `tests/contest-gap-policy.test.js` pins it. **It is now a CodeChef
phenomenon only.** AtCoder used to produce one whenever its standings could not be read — the
normal outcome when signed out — which was precisely the "we couldn't find out" case wearing the
other meaning's clothes. That reads `sourceUnreachable` and waits now, and the estimator bounds
rather than refuses, so nothing on AtCoder stores a null.

### Whose data is this? (`services/platform-identity.js`)

**Every platform has a handle you enter in Settings, and that handle is the authority.** Nothing that writes `solved`, or sets a rating the queue orders by, runs without one — and **a contest cannot be added for a platform whose handle is missing**, because it would store unmarked, its solved problems would never clear, and it would look like the sync was merely slow.

Adapters check it through `verifyIdentity(session)`, which returns `{username, rating}` or throws, before any user-specific read — on the refresh **and** the add path, since adding a CodeChef contest reads `problemsstats` too. Verification is free: the same call already fetched the rating. Codeforces uses `user.info`, AtCoder the profile page, CodeChef the bootstrap object `createSession` already read.

The check differs by how each platform is addressed:

- **Codeforces and AtCoder are asked *about* a handle**, so who is signed into those sites is irrelevant and verification only confirms the handle exists. That matters more than it sounds: `user.status?handle=X` returns X's submissions no matter whose key signs the request, so an unchecked handle silently yields somebody else's history. Codeforces' canonical casing is taken from the API, so `Tourist` over `tourist` is not read as a change.
- **CodeChef answers for whoever holds the session cookie**, so the configured handle is additionally compared against the signed-in account. A mismatch throws with **`isIdentityMismatch`** and callers must always stop — `solved` is only ever set true, fully-solved contests are deleted outright, and the backup is written after the sync, so one sync under another account permanently corrupts the queue *and* overwrites the backup with the corruption.

Settings confirms the resolved account for all three, in one shape: *“Connected as tourist”* where the handle is looked up, *“Signed in as tourist”* on CodeChef where the browser session really is the identity. Each runs the **same `verifyIdentity` the sync runs** — a check that exercises a different call can pass while the real path fails — and Codeforces runs it against the values typed in the form rather than the saved ones. AtCoder previously showed nothing at all, which mattered most there: its history is read *about* a handle, so the resolved account is the only thing between a typo and a queue synced against a stranger.

**What the check can and cannot establish differs by platform, and the difference is not cosmetic.** On CodeChef the browser session *is* the identity, so the signed-in account is compared against the configured handle and a mismatch throws. On Codeforces and AtCoder there is no session involved — `user.status?handle=X` returns X's submissions whoever's key signs the request, and AtCoder's submissions are read *about* a handle through `f.User=`, which returns that handle's rows whoever is signed in. Codeforces offers no "who am I" endpoint, so there **the handle is verified to exist, not to be yours**. **AtCoder no longer has that gap:** every page it serves carries `var userScreenName`, so `atcoder/scraper.js#parsePageGlobals` reads the signed-in account and `verifyIdentity` refuses a handle that contradicts it. The policy is narrower than CodeChef's on purpose — there the session *is* the identity, so a mismatch means the data is the wrong person's; here `f.User=` means the data is right either way and a mismatch just says Settings has the wrong handle. So it throws only on **positive evidence**: signed out (`""`) or a missing marker (`null`) both proceed, because adding a contest has to keep working without a session and "we could not tell" is not evidence: enter someone else's and you will sync their solves. What contains that is the *changed*-identity path, which clears that platform's flags rather than merging them, so the mistake is recoverable.

The guarantee rests on three independent layers, each confirmed by removing it and watching `tests/identity-guard.test.js` fail:

1. `adapter.verifyIdentity` runs before any user-specific read, on the refresh (`progress-manager.js`) *and* the add (`contest-manager.js#establishIdentity`).
2. `classifyIdentity` throws on a blank username, so an identity that was swallowed rather than verified still cannot get through.
3. CodeChef's `fetchSolvedKeys` verifies again on its own — the layer that survives when the first two are both defeated, and the reason a caller cannot accidentally read another account's solves. **It is the only platform that checks twice, so it reads like an oversight**; the comment beside it now says it is not. It makes reading the wrong account's solves impossible from *that function* rather than merely unlikely from its callers, and it costs nothing extra, reading the session object the add already built.

`services/platform-identity.js` answers the one remaining question: **has that handle changed since the solved flags were derived?** If so they belong to the previous account and are cleared, for that platform only, so the next sync re-derives them. That restores what this file already claims — solved state derived fresh each sync rather than cached — which the stickiness had quietly made false. Contests already deleted for being fully solved cannot come back.

`updateSolvedStatus` returns `{removed, failures}` rather than a bare array. **Failures are surfaced, not just logged**: a silent refusal looks the same to the user as a silent corruption. The shell reports them **last**, after the backup write and the view refresh — reporting earlier let `"Writing backup…"` overwrite the message for exactly the users whose backup was at risk.

Note the Codeforces page client (in `codeforces/scraper.js`) sends cookies, but the one page it still reads — `/gym/<id>`, parsed by `parseProblemsPage` in the same file — yields only the contest name and its problem list, nothing about the viewer. So it needs no identity, and neither does AtCoder's public tasks page. (That file used to read competitors' handles, solve counts and pagination too; the standings scrape is gone, which is what the rename recorded.)

### Platforms

**Every platform extends `Platform` (`core/platforms/platform.js`), and the base is where the
contract lives** — not in a test, not in a destructure. A platform declares what it *is* — the
`DESCRIPTOR_MEMBERS`: `id`, `matchUrl`, `solvedKey`, `capabilities` and the rest — and what it
*does*, in one class. `registry.js` builds one instance of each and runs `Platform.check` on it,
which refuses a class missing a member or a hook, or one whose `canEstimate` disagrees with
whether it estimates. Every shape that crosses the boundary is checked and names the platform
when wrong, so a platform that returns the wrong thing fails at the boundary rather than three
modules later.

The registry used to be kept free of network code by holding descriptors in a separate file.
That purity was measured and retired: everything that imports the registry ships in the same
bundle as the network stack, and every source module loads in plain Node with no `chrome`
access at load time, so the build config reads `hostPermissions` straight off the instances.

**A site and a platform are two words for two things.** A site is a host the extension talks
to — an account, its JSON, its pages, a fit. A platform is a registered kind of contest on
a site. AtCoder and CodeChef are a site with one platform; Codeforces is a site with two. Each
class names its site (`static site`, the pure object in the site's `site.js`, which the base
copies onto the instance: origin, host permission, mark, settings section), its site's `Api`
class (`static Api`) and, where the platform reads pages, its site's `Scraper` class
(`static Scraper`; null where it does not).

What callers use — the orchestrators and the settings page:

| method | answers |
|---|---|
| `createSession()` / `createSessionFrom(values)` | a Session, from saved or unsaved settings. **The orchestrator never sees a credential.** Settings verifies what you *typed*, so a wrong key tells you before you rely on it. |
| `verifyIdentity(session)` | `{username, rating}`, or a throw whose **message is the user-facing verdict**, in Settings and in the queue's status strip alike |
| `describeIdentity(identity)` | how Settings names the account — "Connected as X", or "Signed in as X" on CodeChef, where the browser session *is* the identity |
| `fetchContestRecord({contestId, subtype, session, onProgress})` | the whole add: one of the five statuses, with the stored-shape contest on `ready` |
| `fetchSolvedKeys(session, contests, onProgress)` | a Set of `solvedKey` values |
| `syncMetadata(session, contests, onProgress)` | fills in what arrives after the add |
| `reset(spacingMs)` | the one test seam |

What a platform implements — three hooks have defaults that work through the site's API,
so a platform overrides them only where its site's account works differently:

| hook | returns | required |
|---|---|---|
| `fetchContest({contestId, subtype, session, onProgress})` | a status, or `{ id, name, problems, startTimeSeconds, publishedDataCheckedAt, sourceId?, startTimeUnavailable?, context? }` | yes |
| `buildSession(values)` | `{ handle, api, scraper, ... }` — **the site's `Api` and `Scraper` ride on the session**, so every read goes through `session.api` or `session.scraper` and a fake is injected the same way on every platform | default: the handle from the section's local field, `Api.fromSettings(values)`, and `Scraper.fromSettings(values)` or null |
| `identify(session)` | `{username, rating}` | default: refuse a blank handle, ask `api.identity(handle)`, refuse null |
| `fetchAccepted(session, contests, onProgress)` | `{contest: {id}, problem}` pairs — never a bare `null` contest | default: `api.accepted(handle)` |
| `readField({contest, context, session, onProgress})` | what the estimator fits against; or a status — `sourceUnreachable` where the data will come, `unavailable` where it never will; or null when there was nothing to measure | iff `canEstimate` |
| `estimate(contest, field)` | fills the gaps in place; **pure** | iff `canEstimate` |
| `syncStartTimes`, `syncMetadata`, `describeIdentity` | overrides | optional |

Codeforces' two platforms override none of the account hooks: their source answers `identity`
and `accepted`, and `fromSettings` builds it from the key pair. AtCoder overrides `identify`
(a mismatch only on positive evidence) and `fetchAccepted` (per contest). CodeChef overrides
`buildSession` (dashboard facts on the session), `identify` (the session *is* the identity) and
`fetchAccepted` (verifies again).

**The base owns exactly what means the same thing everywhere** — this file's naming rule
applied to steps: the stored contest shape (`buildContestRecord`), the per-problem defaults,
the `isSourceUnreachable` → `sourceUnreachable` translation, the `readField → estimate`
composition (`estimateMissing`, which a re-check reuses), mapping accepted pairs through
`solvedKey`, and dating contests from a site's bulk contest list. **Every gate stays inside
`fetchContest`**, returned as one of the five statuses; the base passes one through. **The gap
policy is deliberately not in the base** — `contest-manager.js` applies it against
`capabilities.canEstimate`, and two places would be free to disagree.

`contest-manager.js` is just the orchestrator: match the URL, mark solved, decide whether the
record is complete enough to store. Adding a site is a folder (below), one `new` per platform in
`registry.js`, and a settings section; the registry refuses at load if a member or hook is
missing.

#### The shape of a site folder

**A folder is a site, and a site registers one or more platforms.** `module-boundaries.test.js`
classifies every folder under `core/platforms/`: a folder with `site.js` is a site; a folder whose
`platform.js` exports a registered class is a platform folder, and is the site folder itself or a
direct child of it. AtCoder and CodeChef are both at once. Codeforces is a site with two
platforms beneath it:

```
atcoder/     site.js  api.js  scraper.js  estimator.js  platform.js  CLAUDE.md
codechef/    site.js  api.js  scraper.js                platform.js  CLAUDE.md
codeforces/  site.js  api.js  scraper.js  estimator.js               CLAUDE.md
  official/  platform.js
  gyms/      platform.js
```

`CLAUDE.md` is the one non-code name the set allows, and it is that site's own
notes — the routes, the traps, the dead ends already investigated. It sits here
rather than in the root because a subdirectory's `CLAUDE.md` is loaded only when
a file in that directory is read, so a site's findings are in context exactly
when its code is and cost nothing otherwise. `.js` remains closed against
invention; `module-boundaries.test.js` records the widening and the reason.

**Data arrives two ways — as JSON from a site's API, or as HTML from a page it scrapes — and
each way is one file.** `api.js` fetches JSON through its own client and reads what came back;
`scraper.js` fetches pages through its own client and parses what came back. Each hands
finished facts to `platform.js`, which only decides. `ls` says what a site does: `scraper.js`
present means it reads pages, `estimator.js` present means it estimates, and where a site does
not do the thing the file is simply absent.

| file | level | holds |
|---|---|---|
| `site.js` | site | a pure object every platform of the site takes on: `origin`, `hostPermissions`, `icon`, rank bands where the site has them, keys that only need a platform id, `settingsSection`, and the `label` the account's messages use |
| `api.js` | site | `class XApi extends Api`: its own client, one route per method returning what the site said, `fromSettings`, `reset`, the account answers the base's defaults call — and below the class, pure functions that read a payload (`problemsFrom`, `summariseSubmissions`, `parseDifficulty`). Always |
| `scraper.js` | site | `class XScraper extends Scraper`: its own client, one method per page fetching and parsing it — and below the class, one pure `parse*` function per page with its selectors declared in a block above it. Iff the site reads pages |
| `estimator.js` | site | only the fit: the site's scale, bounds and policy around `core/rating-models/`, which is all it imports. Iff the site's platforms estimate |
| `platform.js` | platform | `class X extends Platform`: the describing members first, in `DESCRIPTOR_MEMBERS` order, then the hooks, then helpers below the class — every decision (gates, fallbacks, the record shape, `readField`) and every post-add pass |

Rules that hold, each pinned by a test that was seen to fail:

- **Pages are read only in a `scraper.js`, JSON only in an `api.js`**: no other file under
  `core/platforms/` calls `document()` or `json()`, so a platform never sees a `Document` and
  an API never reads a page.
- **A `parse*` export never fetches.** Its body names no `fetch`, no `this`, no client and no
  `await`: it takes a document or a payload and returns facts. That is what lets every parser
  run in Node against `linkedom` with no network stack.
- **A client is built in `api.js` or `scraper.js`, and routes through its own site.**
  `createSiteClient` appears nowhere else, six times in all — two per site — and a client that
  names a site names the one its file imports from `./site.js`. Two clients of one site share
  one pacing budget by default (`site-client.js` names the site's id), so a site is never hit
  faster than one client would hit it; Codeforces' signed API names its own, since it is a
  different surface on a different pace from the page client.
- **An `api.js` is one `Api` class and its readers; a `scraper.js` one `Scraper` class and
  its `parse*` functions.** Each exports at most one instance, named `api` or `scraper`, and
  answers `fromSettings` and `reset` itself. Neither imports `contest-status.js`: a status is
  a decision, and deciding is the platform's.
- **A platform's `static Api` and `static Scraper` are its site's classes**, and a site's
  `scraper.js` is declared by at least one of its platforms.
- **A singleton is reached through the session, never imported.** A platform's session
  carries it; a module that imported it instead would work in production and be untestable.
- **Every platform of a site took the site on**: the same `origin`, `hostPermissions` and `icon`
  as its `site.js`.
- **Describing members first, in `DESCRIPTOR_MEMBERS` order, hooks after**, read off each class
  body, so a reader finds `matchUrl` in the same place in every class.
- **An estimator is only the fit.** It imports `rating-models/` and nothing else; the
  platform's `readField` reads and answers a status when it cannot, and which rows a field is
  read from is the API's question. `Platform.check` refuses half an estimator, and the file
  exists in the site's folder iff its platforms estimate.
- **`DOMParser` is constructed in exactly one place**, `services/site-client.js#getDocument`.
- **Codeforces signs in exactly one place**, `codeforces/api.js`, and its official platform
  reaches no HTML: `official/platform.js` names no scraper, reads no page, builds no Document.

**`Api` and `Scraper` are the two other bases**, one per way data arrives. Both hold a client
and an origin; `Api` answers `json()` and offers `memo()` for a payload one add reads two or
three times, `Scraper` answers `document()` and exports the reading vocabulary every parser
shares (`first`, `all`, `text`). Both are instantiable because on Codeforces the API holds a
**key pair** — `fromSettings` builds one per credential set, and Settings builds a second to
check credentials typed but not saved; sites without credentials, and every scraper, return a
singleton from `fromSettings`. A parser returns `null`, never a plausible default, and a null
*page* means "not the shape I know" where a null *field* means the page rendered without it.

Post-add passes are helper functions below the class, called in order from `syncMetadata`.
CodeChef's two are worth knowing apart: they differ in every way that matters — weekly against
every refresh, write-once against both directions, gated on a timestamp against gated on the
flags already stored — and must never share a gate, or the slower pass suppresses the faster.

`progress-manager.js#updateSolvedStatus()` loops over every platform with tracked contests, **isolating failures**: one site being down or unconfigured must not stop the others, and if *every* platform fails it returns before the write so a bad sync can't touch storage. `applySolvedStatus()` is split out and pure because it's the step that fails quietly.

Two invariants there:

- **`solved` is only ever set true, never cleared.** That stickiness is load-bearing. CodeChef answers a logged-out request with an *empty* solved list rather than an error, and clearing on that would resurrect every finished problem.
- **`solvedKey` is namespaced by platform** (`codeforces:2193-A`). One `Set` holds solved history from every site, so a bare `contestId-index` would let two platforms sharing a contest number mark each other's problems solved.
- **An accepted pair's `contest` is always an object, never a bare `null`.** `fetchAccepted` returns `{contest, problem}` and the trunk hands both to `solvedKey`. The three platforms once had three encodings for "this problem needs no contest" — `{id: contestId}`, `{id: null}`, and `null` — which was harmless only because neither AtCoder's `solvedKey` nor CodeChef's reads `contest`. The day one starts to, it would work on AtCoder and throw on CodeChef from a line naming neither. `record-contract.test.js` pins the one shape.

Note every relative import must carry its `.js` extension. Vite resolves extensionless paths, Node does not — three of them had been sitting in what are now `codeforces/api.js`, `codeforces/api.js` again and `options.js`, invisible until a test imported that part of the graph.

`backup-validation.js` refuses a backup whose contests omit `platform` or name one this build doesn't know, since either would otherwise throw later while rendering the list.

### Waiting on a contest the platform hasn't published yet

`core/waiting-contests.js`. Adding a round minutes after it ends fails for the same reason everywhere: the data isn't there. AtCoder Problems has not indexed it; a Codeforces standings totals row has not settled. The message was correct and the only recovery was to come back and click Add again — at the one moment you most want the contest queued. So the attempt is remembered under `upsolve_tracker.waiting_contests`, and every global refresh retries it.

**Waiting entries are their own storage key, never `trackedContests`.** They carry no `problems` array, so filing one in the queue would break `backup-validation.js`, `collectPendingProblems`, the platform ring and the stats histograms at once. They still ride along in the backup, since the backup dumps `chrome.storage.local` wholesale. Keying is `makeContestKey`, identical to a tracked contest, so the two can never be filed under different names for the same round.

Four things are easy to get wrong:

- **Which failures may wait is a property of the fact, not of the platform.** `shouldWait()` in `contest-status.js` answers it, identically everywhere: `notEndedYet`, `notPublishedYet` and `sourceUnreachable` wait; `unavailable` refuses, and is the one status that also **drops an existing waiting entry** on retry, since another attempt cannot change the answer.
- **A contest can also enter this state fully fetched**, which is the one entry point that is not an adapter's verdict. On a platform that cannot estimate, a problem still unrated inside `capabilities.ratingGraceMs` makes `contest-manager.js` throw `notPublishedYet` rather than store a "???" — see the `canEstimate` discussion above. The *window* is a deadline, not a delay: inside it the contest is retried by this same machinery on every refresh, a **full re-add** each time, and resolves the moment the site publishes. Costs about ten requests per CodeChef entry per refresh (one contest plus one per problem) — between AtCoder's one and Codeforces' tens, and unlike the Codeforces case it is bounded, since the contest provably leaves the window. Note the window is wall-clock while the refresh is user-driven (only the ↻ button; there is no alarm, and `targets/chrome/background.js` is four lines), so a queue left untouched for eight days gets its "???" having never retried inside the window at all. No worse than the behaviour this replaced, which stored one immediately — worth stating so it is not later read as a bug.
- **Entering the state is a flag on the error, never a message match** — `error.isNotPublishedYet`, the same idiom as CodeChef's `isIdentityMismatch`. A copy edit to "doesn't list contest" must not silently turn a contest that would have resolved into one that is never retried. `error.isAlreadySolved` exists for the same reason on the other side.
- **It must not be logged as a fault.** `console.error` from an extension page is filed under `chrome://extensions` as an extension error, with a stack trace and a red badge — once on the add, then again on *every refresh* for as long as it waits. So `contest-manager.js` logs it at **`info`** when `isNotPublishedYet` is set, and errors as before for everything else. `warn` is not enough — that page collects error *and* warning levels, so downgrading to `console.warn` only changed the icon from a red circle to a yellow triangle, and the test that watched `console.error` alone passed while the entry was still being filed. `tests/waiting-quiet.test.js` drives the real `processNewContest` for both halves of that branch, since the logging is in its catch.

  **The same trap is still live in one place, knowingly.** `codeforces/api.js` logs every failed API call at `console.error`, so typing a wrong key into Settings and pressing *Test connection* files an extension error against the extension — a red badge for what is just a typo the page already explained. It was left alone because it is not only a Settings path: the same line fires when a sync genuinely fails, where an error *is* the right level. Splitting the two means deciding at the call site rather than in the client. Worth doing, not urgent.
- **A retry drops an entry only when it will never resolve** — added, already tracked, or every problem solved. **Every other failure keeps it waiting.** `processNewContest` verifies identity before it fetches anything, so a 503 or an expired session throws something that is *not* a publication delay; dropping on that would lose the wait to a network blip, silently. The recorded `lastError` renders on the row, which is the only thing that tells a stuck entry from a young one.

The retry runs **before** `updateSolvedStatus` in the shell's refresh, so a contest added here gets its solved status marked and lands in the same backup write rather than sitting a refresh behind. Failures are isolated per entry, the way `progress-manager` isolates them per platform. `retryWaitingContests(onProgress, {addContest})` takes the adder as a **test seam** — production always passes `processNewContest`, and `tests/waiting-contests.test.js` substitutes it so the outage case can be exercised without a network stack standing in for one.

**Both halves of this are now confirmed against a live site.** A waiting entry has resolved on its own — left the strip and entered the queue on a later refresh, unaided — and a Codeforces official round has entered the waiting state. An earlier version of this file warned that neither had ever been seen and that the Codeforces branch "may never fire in practice", on the reasoning that a just-finished round normally succeeds anyway because an empty `contest.ratingChanges` is what the standings sampling covers. That reasoning was wrong about the outcome; the branch fires.

**Which makes the cost asymmetry a live characteristic rather than a footnote.** An AtCoder entry costs one small tasks-page fetch per refresh. A Codeforces one costs **tens of deliberately throttled requests**, every refresh, until it resolves or is cancelled by hand — so a CF round that is never going to resolve is worth cancelling rather than leaving to sit. That arithmetic is why `unavailable` exists as a distinct status: a gym with no visible field refuses immediately instead of retrying forever, which is what a `mayBeUnpublished` capability used to approximate by asking whether the subtype was a gym.

**133 of 2,138 finished official Codeforces contests (6%) never enter `problemset.problems` at all** — 12 ICPC Challenges including World Finals, 14 Kotlin Heroes, and 54 mirrors of external events ("based on Technocup", "based on VK Cup"; the newest is 1,040 days old, so current rounds are unaffected). Since an official round now waits until the problemset has it, such a contest waits **indefinitely**. That is a knowing trade — an honest stall over a wrong rating — not an oversight. Cancel it from the ⋮ menu if one turns up.

The `revalidate` flag that used to thread through this path is gone. It existed solely so AtCoder's 15-minute resource cache could be bypassed on a retry, and when that cache went it had no consumers left anywhere in the tree — `waiting-contests.js` and `contest-manager.js` were both passing a parameter no adapter read.

**The banner *and* the mounted view are rebuilt from `chrome.storage.onChanged`, not from anyone remembering to say so.** Both are derived from what is tracked and what is waiting, and both had a mirror-image staleness bug:

- The banner lives in the shell while the lists are edited from the Contests view, which cannot reach up to it — so cancelling a wait left it reading "Waiting" for a contest that had stopped waiting until the panel was reopened. Removing a tracked contest had the same latent bug, reading "Added".
- In the other direction the shell writes and the view has to notice: adding a contest that turned out to be waiting showed no sign of it on the Contests tab until you navigated away and back. The path that *succeeds* had always refreshed explicitly, which is exactly why the waiting branch was missed — one call site, one omission.

So `index.js#refreshCurrentView()` is called from the listener rather than from each writer. Watching storage covers every writer for free, including Import, which replaces both lists wholesale. It filters to `trackedContests` and `upsolve_tracker.waiting_contests`, since a sync writes storage constantly and re-querying the active tab each time is wasted work. The global refresh still calls `refreshCurrentView(removed)` **directly as well**, because the removed-contest list is what the queue announces and a storage event cannot carry it.

In the UI the state is an indicator, not a control: the shell's banner shows a disabled `⏱ Waiting` exactly as it shows `✓ Added`, and cancelling lives on the Contests tab, in the same ⋮ menu and behind the same dialog as removing a tracked contest — whose title, help text and confirm label are swapped, since "its unsolved problems leave the queue" describes something that never happened. The waiting strip is a collapsible shaded band above the list, and its rows are **not** buttons: there is no accordion, because a waiting contest has no problems to expand onto.

Three details there are deliberate. **Its header carries a chevron**, which is the opposite of the contest row's rule above — and for the reason that rule gives: a contest row needs none because the expansion appearing under it *is* the indicator, whereas this header collapses to a bar with nothing beneath it, so there was nothing to see and no reason to guess it opened. It points **down when closed and up when open, never sideways**: a chevron pointing right at a row's far right edge is the drill-in affordance — it is what the Stats legend rows use to open a platform panel — so pointing it that way promised another screen when this expands in place. It rotates rather than swapping glyphs, so the two states cannot drift. **The rows carry no "waiting" pill**, since the heading directly above them already says so — the same reasoning that drops the platform mark from a contest's compact expansion. And the band keeps a `margin-bottom` matching the one `#contest-items` already has: flush against the scrolling list, the first real contest read as another waiting row.

### The three sites, each in its own file

A site's deep dive — its routes, its traps, and the dead ends already
investigated so they are not investigated again — lives beside its code:

| site | file |
|---|---|
| AtCoder | `core/platforms/atcoder/CLAUDE.md` |
| CodeChef | `core/platforms/codechef/CLAUDE.md` |
| Codeforces, both platforms | `core/platforms/codeforces/CLAUDE.md` |

**These are not loaded at session start.** A subdirectory's `CLAUDE.md` is pulled
in when a file in that directory is read, which is the whole reason the split
exists: this file had grown past its size limit, and most of what was in it is
true of exactly one site. So anything that must hold across all three stays
here; anything true of one site belongs in that site's file. Read a site's file
before changing that site's code — much of it is measured findings that are
expensive to rediscover and impossible to guess.

### Requests go through a page, not from the panel

`services/site-client.js` is the one client every platform configures, and
`services/page-transport.js` is how it issues requests.

**A `fetch` from the extension's own origin is cross-site.** Chrome withholds
cookies whose `SameSite` is unset — the default — and `credentials: "include"`
does not override that; it governs whether cookies *may* be sent, not whether
the browser considers them same-site. So the panel talks to every platform as an
anonymous stranger. Measured in the user's browser, same second, three ways:

| request issued from | status | challenged | carried the session |
|---|---|---|---|
| the extension side panel | 403 | yes | **no** |
| a content script on the page | 200 | no | **yes** |
| the page's own context | 200 | no | yes |

So requests route through a content script on the target site, declared from the
same `hostPermissions` the manifest already composes. That is not a way around a
site's defences — it is how an extension acts as the user on a site they are
already signed in to, and the resulting request is the one their own tab makes.

**A client names its `site` and the routing follows.** `createSiteClient({ site:
site })` derives the match patterns from that site's
`hostPermissions`, and defaults `credentials: "include"`; the three platforms
each used to spell out `createPageFetch({ matchPatterns: X.hostPermissions })`.
Naming **no** site throws at construction, since the alternative is a direct
cookie-less fetch. Naming the **wrong** one is the failure worth pinning, and
`module-boundaries.test.js` does: there is no matching tab, so every request
falls back to a direct fetch and still succeeds — it just stops carrying the
session, and the session-gated routes then fail exactly the way they do when the
user has no tab open, which is a supported state that reports itself politely.
Confirmed by pointing AtCoder's client at Codeforces and watching all 420 tests
stay green.

`site-client` answers two ways, and between them they cover what the consumers
want: `getJson` an object, for every route in an `api.js`, and **`getDocument` a
`Document`**, which is what every `parse*` function in a `scraper.js` takes. That
second one is why `DOMParser` no longer appears in platform code at all. A raw-string
`get` existed too and lost its last caller in the `Api`/`Scraper` split; a rule in
`module-boundaries.test.js` now fails on any export of a shared module that nothing in
production reads, short of a named test seam, so the next split cannot leave one behind.

Four things about it are load-bearing:

- **The seam is `fetchImpl` on the pacer, not a wrapper around it.** Wrapping
  would either skip the delay or double it, and those delays are what keep the
  extension from being blocked.
- **It falls back to a direct fetch, and never opens a tab.** With no tab on the
  site, public routes still work and session-gated ones fail through the
  platform's own `refusal` hook, which can say what was wanted. Opening a tab on
  a background refresh would be the extension hijacking the browser.
- **A tab open *before* the extension was installed or reloaded has no content
  script** — Chrome does not inject retroactively — so `sendMessage` rejects and
  the request goes direct. Reloading the page fixes it; the fallback means it
  degrades rather than breaks.
- **The reply is a Response-*shaped* object, not a `Response`.** One constructed
  from a body cannot carry `url`, and `url` is exactly what AtCoder's refusal
  check reads to notice it was bounced to `/login`.

**Every platform now goes through `site-client.js`, the signed Codeforces API
included.** It used to talk to a bare `createPacer`, on the reasoning that it is not
challenged, needs no session, and expresses failure in the payload
(`status: "FAILED"`) rather than the transport. All of that is still true — it just
turned out to be expressible as *parameters* rather than as a separate transport: a
direct `fetchImpl`, because routing it through a tab would add a dependency it does
not need, and `refusal: () => null`, because it genuinely does not refuse at the
transport. That is what lets one `Api.json()` serve all four platforms.

**`services/ttl-cache.js` is the only short-lived cache.** Two platforms had
grown the same eleven lines independently — the same `{body, at}` entry, the same
`Date.now() - at < ttl` predicate, the same `60 * 1000`, the same
clear-for-tests seam. CodeChef keyed its by contest code, Codeforces held one
slot, which is that with a single key. Both are deliberately *short*: one add
reads a payload two or three times and should not pay twice, while a stale
answer outliving the add is worse than a second request — Codeforces' is a
publication check, where holding "not published yet" strands a contest for the
length of the window. It does **not** dedupe in-flight requests, which is what
the copies it replaced also did not do. Arguments after the key are forwarded to
the loader and take no part in the keying; that is how one problemset is cached
across every `CodeforcesApi` while the instance that asked still signs the
call. Neither copy had any test at all — a cache that never hits is invisible in
the result and visible only in the request count — so `tests/ttl-cache.test.js`
drives a stubbed clock and was confirmed by breaking it both ways, never hitting
and never expiring.

**`services/request-pacer.js` is the only pacing mechanism**, and every caller configures it. An earlier version of this file claimed each platform already paced through it; that was false for Codeforces, which had two paths and used neither. The scrape carried its own `HttpClient` with a hard-coded jitter range and cooldown, and **the signed API was paced by nothing at all** — the tell being three hand-rolled `await delay(2000)` calls standing in for it at the call sites that had noticed.

| caller | configuration |
|---|---|
| `atcoder/api.js` and `atcoder/scraper.js` | `gapMs: 1500`, `credentials: "include"`, one shared budget (`atcoder`) |
| `codechef/api.js` and `codechef/scraper.js` | `gapMs: 1500`, `credentials: "include"`, one shared budget (`codechef`) |
| `codeforces/scraper.js` (the page client) | `gapMs: [1000, 2500]`, `measureFrom: "end"`, `cooldown: { everyNth: 15, gapMs: [6000, 12000] }`, `credentials: "include"` |
| `codeforces/api.js` (the signed API, both platforms) | `gapMs: 2000`, `budget: "codeforces-api"`, `credentials: "omit"` |

Each caller makes its own pacer, so budgets are independent by default — `HttpClient`'s counter was a single static shared by everything, which is now per-instance state and structurally impossible to cross. The one default that crosses is deliberate: `site-client.js` names a client's budget after its site's id, so a site's `api.js` and `scraper.js` queue as one, which `site-client.test.js` pins.

**`budget` is the one deliberate exception, and it exists because independence is wrong for two clients addressing one *host*.** Codeforces is two platforms with an API client each, and two clients each honouring a 2 s gap serve one request per second to codeforces.com — the same failure per-instance state was introduced to prevent, arrived at from the other side. A caller may name a `budget` (`codeforces-api`); every pacer naming it shares one queue, marker and count, while keeping its own gaps, cooldowns and transport. The name comes from the caller, so `request-pacer.js` still never learns which platforms exist, and a pacer naming none keeps private state exactly as before. Both halves are pinned in `request-pacer.test.js` and were confirmed by breaking each: ignoring the budget, and letting it leak into unnamed pacers.

**`measureFrom` exists because of a real difference, not for symmetry.** `"start"` waits until `previousStart + gap`, so a slow request eats into the next gap. `"end"` waits the full gap after the previous request *finished*, and waits it before the first request too — which is what `HttpClient` did. They diverge exactly when a request outlasts the gap, and collapsing them onto `"start"` silently makes the Codeforces scrape **faster**. Even sampled, adding a contest issues tens of requests, and these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing. `tests/request-pacer.test.js` fails on that specific collapse; it was confirmed by making it and watching exactly those two assertions go red.

Requests queue through a promise chain rather than each checking the clock. `HttpClient` had a variant of the flaw that guards against: it slept a random interval per call with no queue, so two concurrent callers slept in parallel and then fired together. It was latent rather than live, since every scrape call site is a sequential `await` — but absorbing it closed the hole rather than preserving it.

**Confirmed in the real extension**, by removing a tracked contest and adding it back on all three platforms. That exercises the newly paced signed API end to end alongside the throttled scrape, solved marking and the backup write — the pacing was the one behaviour change here with real risk, since nothing about a response says whether a delay was served.

What that does *not* reach is the waiting branches: those contests were already published, so the problemset gate passed immediately and the gym phase check saw a finished contest. A round fresh enough that Codeforces has not indexed it yet is still the only way to see `notPublishedYet` fire on the add path.

Codeforces' page client, in `codeforces/scraper.js`, sets `credentials: "include"` so the user's session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error.

**A Cloudflare challenge now waits rather than failing the add.** It used to throw
bare from the HTML client, and nothing converted it — so `contest-manager.js` never set
`isNotPublishedYet`, no waiting entry was created, and the user had to notice the
red message and press Add again, at the one moment they least wanted to.
`contest-status.js` had always defined `sourceUnreachable` for exactly this case
(*"We failed to ask — network, 403, anything. Not 'there is no answer'"*); only the
wiring was missing. The block is now flagged `isSourceUnreachable` — a flag rather
than a message match, the same idiom as `isStandingsHidden` — and
the `Platform` base turns it into that status. Both halves are confirmed the
usual way: removing either makes a test report the original symptom. Note only the
challenge is reclassified; a layout change or a genuine fault still escapes, or the
distinction that makes an escaping exception a bug would be lost. The cooldown logs at `console.info` rather than `console.warn`, because `chrome://extensions` collects warnings alongside errors and a normal add was otherwise filing a row there every 15 requests — the same trap the waiting-contest logging was fixed for.

### Rating estimation pipeline

`core/contest-manager.js#processNewContest(url)` is the orchestrator, and the adapter answers it
with one of the five statuses above. Given a `/contest/<id>` or `/gym/<id>` URL:

1. **Is it ready at all?** — asked before any work, because the answer is usually cheap and the
   work is not.
   - *Official*: is the contest in `problemset.problems`? Codeforces publishes problems there
     problems there, but **not necessarily rated ones** — 41 of 2,007 listed contests have no
     rated problem at all, and the newest of those are ordinary recent rounds. So presence is
     the whole question this gate asks, and a listed-but-unrated round is added with estimates
     that the published-data pass settles later. Absent →
     `notPublishedYet`, and **nothing is scraped** — the alternative was tens of throttled requests
     spent producing an estimate the re-check would overwrite. The response is cached for
     60 s so the check and step 3 don't fetch ~2 MB twice.
   - *Gym*: has it finished? Gyms are never in the problemset, so they skip that check entirely —
     applying it would make every gym unaddable. Phase comes from `contest.standings`' own `contest`
     object, or from the problems-page sidebar (`.contest-state-phase`) when standings are hidden.
     Still running → `notEndedYet`. An unreadable phase proceeds: refusing on a label we can't read
     would make a contest unaddable for a reason we can't state.
2. `CodeforcesOfficial#fetchContest` — read the problems off `contest.standings`. Official
   contests read solve counts from the "Accepted" totals row; gyms instead count
   `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties. Returns
   `solveCountsRead`, false when the totals row wouldn't parse.
3. `codeforces/api.js#applyStandingsProblemData` — apply Codeforces' published ratings and tags, off the standings response already in hand.
   Anything rated here needs no estimate, which is why it runs *before* the expensive steps.
4. `platform.js#readField` — produce the participant rating distribution, as
   **strata**: `{ strata: [{ ratings, scale }] }`, where `scale` is how many real competitors one
   read competitor stands for. Official: `contest.ratingChanges` `oldRating`s at scale 1; if empty,
   fall back to sampling the standings (below). Gym/ICPC: build from `contest.standings`, collapsing
   each team into one effective rating via `api.js#teamRating` (binary search for R where the
   product of per-member loss probabilities is 0.5). Hidden-standings gyms recover the same field
   from who submitted, via `api.js#partyField`.
5. `codeforces/estimator.js` over `rating-models/rasch.js` — binary-search the rating R whose Elo-expected solve count, summed over
   the strata and weighted by each one's scale, matches actual solves; round to the nearest 100,
   floor 800. Zero solves targets 0.5 expected solves rather than 0 — which drives the estimate to
   the **ceiling**, not the floor.
6. Mark already-solved problems from `user.status`. A gap surviving all of that means no measurable
   field, and for a **gym** that is permanent — private or empty standings don't become visible
   later — so it answers `unavailable` and refuses rather than waiting. Codeforces stores only when
   every problem has a rating (`canEstimate: true`, see above); there is intentionally no
   default-1500 fallback, and reintroducing one would silently corrupt the queue's sort order.

### Rating models: one method, two callers

`core/rating-models/`. Codeforces' estimator and AtCoder Problems' were written
independently and turn out to be **the same estimator**:

```
AtCoder Problems:  1 / (1 + 6^((b − θ)/400))    integer bisection over ±10000
Codeforces (ours): 1 / (1 + 10^((b − θ)/400))   25 float bisections over 0…4000
```

Both fit the difficulty parameter of a **Rasch model** — one fitted item parameter,
discrimination fixed and shared — by searching until expected solves equal observed
solves. AtCoder Problems' own function is called `_fit_1plm_binary_search`. Every
difference is a constant, so `rasch.js` takes them as arguments.

**Nothing is defaulted, deliberately.** A default base or bound would let one
platform silently inherit the other's scale, and a difficulty on the wrong scale is
not visibly wrong — it is a plausible number that mis-sorts the queue. `rasch.js`
was extracted from `core/rating-estimator.js`, which had sat in shared space with
exactly one importer while naming no platform, so `module-boundaries.test.js` could
not see it: the same shape as the old `start-time-service.js`, except that one at
least had a genuinely shared export.

**The folder holds the two models and nothing else**, and `module-boundaries.test.js` lists
its contents to keep it so. Two Codeforces files sat here for a while — the strata shape a
field arrives in (`fullField`, `distributionSize`) and the collapse of an ICPC team into the
single rating a lone competitor would need to be as likely to fail as the team is,
`∏ 1/(1 + 10^((rᵢ − R)/400)) = 0.5` by binary search — on the argument that Codeforces' two
platforms built their fields in folders that may not import each other, so a definition either
owned would be one the other copied. That argument ended when one `codeforces/api.js` began
reading every Codeforces field, and both moved there as `fullField`, `distributionSize` and
`teamRating`. AtCoder never imported either, which is the tell that they were never shared
maths: its estimator fits abilities directly and has no strata, because a field that is always
read whole has nothing to scale up from. Note `teamRating` lands **above** the strongest
member, which is the point; `mean` and `max` were both tried and measured worse.

`rasch-upper-asymptote.js` is the second model, `P = (1 − r) · σ(a(θ − b))`, used
only for AGC's first problem where non-attempts are otherwise read as failures.
**It is not called `3pl`, though the source calls it `fit_3plm_irt`.** A 3PL's third
parameter is a *guessing floor* — a lower asymptote — whereas `r` sets an **upper**
one, putting the model in the 4PL family with `c = 0`. And because each grid step
delegates to the Rasch fit, discrimination stays constant: it fits two parameters,
not three.

**The port is pinned, not trusted.** `tests/rating-models.test.js` checks both models
against 60 fields whose expected values were produced by running AtCoder Problems'
Python verbatim — 11 of them fitting to a *negative* difficulty, which is where a
Python-to-JavaScript port is likeliest to drift. Any disagreement **there** is a
porting bug, because the input is identical by construction.

**That does not extend to live numbers, and expecting it to would be wrong.** Our
estimates differ from AtCoder Problems' published ones by well under a percent —
ABC461 F is 1931 here against their 1940, G is 2413 against 2391 — because for a
modern rated contest they overwrite two of the six inputs before fitting
(`main.py:546-560`): `prev_contests` becomes their own running count of contests
the user has appeared in *across their whole crawl*, not AtCoder's `Competitions`
field, and an `OldRating` of 0 is backfilled from that user's last known rating in
an earlier contest. Both need state accumulated over every contest in chronological
order, which is the bulk replay this design exists to avoid — the same reason
`rating.py` is not ported. Since `prev_contests` feeds `inverseAdjustRating`, a
different count shifts every ability slightly and the fit moves with it. Neither
number is wrong; they are fitted from slightly different views of the same field.

**A hazard that turned out not to be one, measured rather than assumed.** Python's
`//` floors while `Math.trunc` rounds toward zero, so they disagree on every negative
odd midpoint — and this bracket starts at −10000. That state *is* reached: across 300
random fields the search hit it 251 times in 48 cases. **Every final answer still
agreed.** Bisection converges on a unique boundary point and both forms land strictly
inside the bracket, so they differ in path, not result. `Math.floor` is kept for
fidelity to the source and for line-by-line diffability, not for safety — don't
record it as a trap.

### Sampling, published ratings, and the Codeforces HTML

All Codeforces' own, and all in `core/platforms/codeforces/CLAUDE.md`: how a
freshly-finished official field is sampled down to ~1,500 competitors and why a
uniform random sample was measured and rejected; why a dev machine cannot fetch
Codeforces HTML at all; where the scraped markup is quarantined; and how tags
and published ratings arrive, including the six-week cutoff that makes the
re-check terminate.

### Start times

`Platform#syncStartTimes` — the base default from a site's `contestList`, which `CodeforcesGyms` extends — fills `contest.startTimeSeconds`, which orders the contest list. Contest IDs are *not* chronological (2205 ran a day before 2200), so sorting by ID is not a substitute.

- **Official** — `contest.list`, one ~400 KB request. A finished contest's start time never changes, so unlike tags there's no re-check: a contest is asked about only while it is both undated *and* unanswered, which in practice means once.
- **Gym** — `contest.list?gym=true`, but private gyms and mashups don't appear there at all — of 26 tracked gyms on this install, *none* does, and 25 are dated anyway. Those are covered at add time from `standings.contest.startTimeSeconds`, which `api.js` already has in hand: privacy gates *listing*, not access, so the signed standings call reaches a private gym perfectly well. Anything still unresolved sorts to the bottom rather than being treated as ancient.

**A site never publishes a start time late, and that is what bounds the ask.** It is set when a contest is scheduled, or the contest was never scheduled and there will never be one — all 2,153 contests in `contest.list` carry one, while 1,511 of the 2,633 in `contest.list?gym=true` have none and never will. So unlike tags, unlike CodeChef difficulty, there is no publication lag to wait out. Codeforces expresses "none" by **omitting the key** — never a null, never a 0.

A null `startTimeSeconds` therefore has to carry two meanings, *not asked yet* and *asked, and the site has none*, and read as the first it re-asks an answered question on every refresh for the life of the queue. So the answer is recorded as **`contest.startTimeUnavailable`** — `unavailable` in the sense `contest-status.js` gives it, the data will never exist — and `syncStartTimes` pends on both facts. Two things about it:

- **It is set only where a source that would have carried the time was read successfully and had none**, and the evidence is the *enclosing object*, never the field: a contest listed with no time, or a `standings.contest` without one. A thrown call, a null list, or a response with no `contest` object at all are not answers, and must leave the record pending — that transient case is the retry's one remaining job, since a bad key or a missing handle fails the whole platform upstream in `progress-manager.js` long before this runs. Marking on a throw is the one way this loses data, and `tests/platforms/platform.test.js` pins it.
- **The gym override is now near-vestigial.** `fromStandings` answers from the response the add already holds, so a mashup add stops paying for the gym list *and* a duplicate `contest.standings`. What still reaches the per-gym loop is a hidden-standings gym, whose time is derived from submissions rather than declared.

Routing a failed lookup through `waiting-contests.js` instead was considered and rejected: a waiting entry is not "retry this field later" but *don't store the contest at all*, and a full re-add every refresh — tens of throttled requests for an official round — is a poor trade for a cosmetic sort key on a contest that was fetched successfully.

`progress-manager.js#updateSolvedStatus()` re-syncs on demand: re-fetches accepted submissions, flips `prob.solved`, drops fully-solved contests from storage, and returns the removed ones so the UI can announce them.

### Storage split — this is deliberate

- **`chrome.storage.local`** (`services/storage.js`, `LocalDB`) — `trackedContests` array, keyed by `platform:id` (see the platform registry above), plus settings under dotted keys `upsolve_tracker.handle` and `upsolve_tracker.auto_export`. This is what the Export/Import JSON backup dumps wholesale.
- **IndexedDB** (`services/secure-store.js`) — API key/secret, by the slug `core/settings/schema.js` declares, and the `FileSystemDirectoryHandle`. Credentials live here specifically so they never land in an exported backup; the directory handle lives here because handles aren't serializable into `chrome.storage`.

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

All three sites define difficulty as roughly the rating at which a contestant has a 50% chance in-contest — the same quantity `rating-models/rasch.js` searches for — so feeding a problem's difficulty and your rating *on the same platform* cancels the scale. It is common-person equating with one anchor, you: a poor way to build a general conversion table, a good way to order one person's practice.

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

`services/user-ratings.js` holds your rating per platform, and is deliberately conservative because **one rating moves an entire platform's block**: a failed lookup keeps the previous value rather than clearing it, and nothing is ever defaulted. Ratings arrive from `verifyIdentity` (above), so a rating always comes attached to a confirmed account rather than floating free. There is no manual override — all three platforms fetch automatically. It also holds `ratingChangeMessage`, which says when a rating moved and re-ordered a platform's block — see *UI shell* below.

### Stats: an overview, plus one panel per site

**A site panel is a child of the overview, not a peer of it**, so it is reached by drilling in rather than by a fourth chip beside "Overview": the two have different structure, and four equal chips both said otherwise and wrapped to two rows at panel width. The ring's legend rows *are* the navigation — each is a button — and a panel opens with a `‹ Overview` back link above a header naming the platform. Both directions share one delegated `[data-scope]` handler. The header carries no count, because once scoped the summary line directly above already reads "240 pending · median 1600 · 3 unrated".

**Panels never mix platforms** — no chart bins numbers from different sites on one axis.

- **Per-site panels** show a native rating histogram in that site's own units, plus tags and the rating-range control. Only the Codeforces panel colours its bars by rank; the others use a single neutral fill, since the bar length already carries the magnitude and the colours would only import a foreign meaning.
- **The overview** carries only what is genuinely comparable across sites: the site ring, and the solve-chance histogram.

**There is no tag chart on the overview.** Vocabularies do not match — Codeforces' `dfs and similar` versus CodeChef's `graphs`, and AtCoder publishes none at all — so pooling them produces an authoritative-looking chart built from incompatible lists. The per-platform panels state tag coverage outright ("tags cover 47% of these problems"), because an empty "graphs" bar otherwise reads as "I have no graph problems" rather than "half of this is untagged".

**A site none of whose platforms publishes tags gets no tag section at all** — heading, coverage line and rating-range control included. Drawing the frame and then explaining it is empty reads as a load that failed. That is `capabilities.publishesTags` on each platform, asked of the registry rather than checked against an id, so a new platform declares it instead of the view guessing. AtCoder sets it false.

The rating range is a **dual-thumb slider**: two stacked native `<input type="range">`, not a bespoke widget, so arrow keys still step exactly one bucket — which is what the pair of selects it replaced was good at and a slider is bad at, since ~28 buckets across a panel is about 12px each. The inputs take no pointer events and only their thumbs do, so the lower stays grabbable through the upper. Thumbs **clamp rather than cross**; swapping them mid-drag makes the thumb under the pointer jump sides. When both sit at the top end the min thumb is raised above the max, or it could never be dragged back.

**The ring** (`ui/platform-ring.js`) shows pending problems **per site**, from the same `collectPendingProblems()` the queue uses, so the two cannot disagree. Codeforces' official rounds and gyms are one slice and one panel: a site is one account, one rating scale, one tag vocabulary — and one identity colour, which is why the ring keyed on platforms once showed two adjacent arcs of the same yellow and needed a fourth validated hue that never came. Colour encodes **identity**, so each site's `chartColor` is fixed in its `site.js` and never assigned by size — filtering must not repaint the survivors. Those hues come from a validated categorical theme rather than the brand colours, which fail the chroma floor as fills (AtCoder brands achromatically, CodeChef's brown reads gray); the icons keep carrying brand identity in the legend. The three are **checked together, not individually** — changing one means re-checking all three together against the dark surface — with the dataviz skill's validator, which is **not a script in this repo**, so the numbers recorded here are the durable artifact rather than something a reader can regenerate from the tree. Codeforces yellow `#c98500`, AtCoder blue `#3987e5`, CodeChef red `#e34948`; that last pair sits at CVD deutan ΔE 6.2, inside the 6–8 band, which is legal only because every swatch carries an icon, a full name and a count beside it. `#c0392b` is the zero-warning fallback if the legend ever loses its labels.

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

### Nothing is fetched but the three sites

There is no server, no CDN, no analytics, no telemetry and no runtime font fetch. The only
remote addresses in the built bundle are the platform APIs, which is why `host_permissions`
is composed from the platforms and diffed against the previous build — that diff is the
check on this invariant, not a formality.

It constrains ordinary-looking changes. A web font, an icon set from a CDN, an error
reporter, a "check for updates" ping: each would be individually reasonable and would each
break the claim `DATA.md` makes to the user in its opening lines. The fonts are bundled and
every platform mark is inline SVG for this reason, not for load time.

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

### The settings page: a hand-written schema, generated markup

`core/settings/schema.js` declares the page — sections, fields, and a **slug**
per field — and `core/settings/store.js` reads and writes by slug, routing each
to `chrome.storage.local` or IndexedDB from the field's declared `store`.
Anything that needs a value asks for the slug, the way a WordPress theme calls
`get_option`. Each platform names its settings section, and the `Platform` base reads
that section's slugs; `options/index.html` holds only the intro and the Backup section, and
`options/sections.js` renders the rest.

**A section is a credential set, not a platform**, and that is the whole point.
The page *was* generated from each platform's `settingsFields`, which was the
right shape while the two were the same thing. They stopped being the same thing
when Codeforces became two platforms over one account: generating per platform
asks for one key pair twice, on a page where the two copies then have to agree.
The abstraction was also thinner than it looked — Codeforces wants a handle *and*
a key pair behind a button, the other two want a handle checked on change — so it
spanned a difference rather than a similarity.

**What is hand-written is the schema; the markup is still generated.** That
distinction is load-bearing, because hand-written *markup* is what let AtCoder
ship with no verdict line and no CSS rule for it, while Codeforces and CodeChef
each had their own. `tests/options-settings.test.js` asserts the rendering, and
`tests/module-boundaries.test.js` asserts the schema is complete, that every
`verify.adapter` names a registered platform, and that no two fields share a
slug — a duplicate slug means two inputs writing one storage key.

**`schema.js` is the third module allowed to name a platform**, alongside
`registry.js`, because `verify.adapter` has to. The exception
is scoped to that one file and recorded in `module-boundaries.test.js`'s
`ALLOWED`; `store.js` and `options.js` route by slug and by section and still
fail the test if they name one. Confirmed by adding a platform name to
`store.js` and watching it go red.

A field declares `slug`, `label`, `type`, `placeholder`, `help` and **`store`**:
`"local"`, or `"secret"` for IndexedDB, which is what keeps a key pair out of the
exported backup. The slugs are the ones already in use
(`upsolve_tracker.handle`, `api_key`, `api_secret`), so nothing stored had to
move — and a **typo in a secret's slug is the one failure here that is silent**,
since the value comes back empty and reads as a setting you never saved.
`npm run smoke` checks exactly that, and separately fails if any slug is asked
for twice. Both were confirmed by breaking them.

`help` and `label` are authored in this repo and injected as **trusted HTML** so
the Codeforces key-pair note can carry a link to its API settings page. That is
the deliberate exception to the escaping rule; anything originating outside the
extension still goes through `escape-html.js`.

**Verification is four lines, because the adapters already word every failure
well** — no handle, unknown handle, signed out, wrong account. Adapters supply
`createSessionFrom(values)`, building a session from what is *typed* rather than
what is stored, so a wrong key tells you before you rely on it; `createSession()`
is that same function over saved values. This deleted real duplication: the page
used to re-check `session.signedIn` itself and compose its own CodeChef "signed
out" message, so one condition read differently here and in the queue's status
strip. Settings shows the adapter's wording, which is what the queue already
showed.

The *"Connected as"* / *"Signed in as"* distinction survives as `describeIdentity`
on the adapter — the handle is looked up on two platforms and **is** the session
on CodeChef — because putting it anywhere else makes it a branch on the platform
in shared code.

**How a section verifies is the schema's call.** `verify: { trigger: "button",
adapter, label, help, incomplete }` for Codeforces, where three fields must be
filled before a signed request means anything; `{ trigger: "change", adapter }`
for the other two, which check on load and on change. That keeps the *"Test
connection"* button rather than unifying it away.

The CSS is one rule, `.status-text[data-status]`, with spacing scoped to
`.form-group > …` so the button's inline verdict — which `.test-row` already
spaces with `gap` — is excluded. The three parallel id rules this replaced are
precisely how they drifted: Codeforces and CodeChef each had their own `0.85rem`
block while AtCoder's had **no rule at all** and fell back to the body's 16px.

### UI shell

`core/ui/index.js` defines `<upsolve-app>`, which clones the `#tpl-app` template from `index.html` and hand-rolls a router over three views in `#router-outlet`: `<upsolve-queue-view>`, `<upsolve-contest-list>` and `<upsolve-stats-view>`. Navigation is the tab bar; the header holds only refresh and settings, which act on the app rather than on a view. Views import their markup with Vite `?raw` imports and set `innerHTML`, and are **destroyed and rebuilt on every tab switch** — which is why selections that should survive (the contest type filter, the tag rating range) are persisted to `chrome.storage.local` rather than held on the instance.

**Adding a contest is a contextual action, not a navigational one.** The offer only exists when the active browser tab is on a contest page, so it lives in the shell as a banner above the tab bar — visible from any view — rather than inside the Contests view, where the button spent most of its life greyed out. The `chrome.tabs` listeners live in `index.js` for the same reason: they have to outlive any single view.

Two conventions the shell depends on:

- **`refreshData()`** — called on the current view after a global refresh. A view that needs post-sync updates must expose it; `queue-view` also takes the removed-contest list to announce.
- **`cf-status` event** — views report long operations by dispatching a bubbling `CustomEvent` that the shell renders in its status strip (`null` clears it). That's how adding a contest narrates its stages without each view growing its own progress UI. The same `onProgress` callback is threaded through `processNewContest` and `updateSolvedStatus`; stages that no-op stay silent rather than claiming work they skipped.

**A rating change is announced in the status strip.** A contest's rating update moves that platform's whole block of the queue at once, and with nothing said it reads as the queue reshuffling itself — a Codeforces round once pushed a CodeChef problem off the top overnight. The refresh and the add read `getEffectiveRatings()` before they start, and `user-ratings.js#ratingChangeMessage` compares that against what is stored afterwards, naming each **site** whose number moved (Codeforces' two platforms are one line, since they share one rating): *"Codeforces rating change detected (1223 → 1346). Queue reordered."* Only a number becoming a different number counts, since a first rating had no earlier order.

**On refresh the note *is* the "Updating your queue…" step, not a message after it.** Re-sorting the queue is that step's work, and every separate placement flashed: posted after the backup it replaced "Writing backup…" within a split second, and posted before it, it replaced "Updating your queue…" — a step lasting milliseconds — the same way. So `progress-manager.js#updateSolvedStatus` posts the note *instead of* that step's message when a rating moved, saves, and then awaits `onProgress.hold?.()` so the step stays up while the note is read — after the save, so the queue re-orders underneath it. The length (three seconds) is the shell's, attached to the callback it passes; progress-manager only asks, and a plain callback gets no hold. The shell hands in its own before-reading as `ratingsBefore`, since the waiting-contest retry runs first and can already have stored the new rating. The add has no such step, so there the note and the backup outcome share one message instead. `tests/rating-change-step.test.js` drives the real `updateSolvedStatus` against a stubbed CodeChef, and fails if a separate "Updating your queue…" is posted beside the note.

**Every write that changes storage says how the backup went, in one wording.** Refresh, add (including an add that ends up waiting), remove and import all go through `auto-export.js#backUp(dirHandle)`, which writes the file and answers null, or `{tone, message}`: a **yellow** warning when auto-export is off — a choice, but one that leaves the queue with no backup, so it is said every time — and a **red** error when the write fails or Chrome refuses the folder. `setSyncStatus` takes that `tone` (`"error"`, `"warning"` or null; `sticky` alone still defaults to error), and `cf-status` accepts `{message, sticky, tone}` as well as a string so a view can post one. The outcome shares one message with the refresh's *"Added X — it's published now"* note, since the strip shows one at a time and either would flash the other away; failures still overwrite both. There is deliberately no "on, but no folder chosen" case — Settings makes it unreachable (see *Auto-export gotchas*).

`queue-view` flattens all unsolved problems across contests and sorts by solve probability (see above), and shows a setup prompt when `hasCompleteSetup()` is false — which now means *any* platform is usable, not specifically Codeforces, since AtCoder needs only a handle and CodeChef needs nothing at all — without it, a missing handle or API key made refresh look like a dead button. **The prompt names the platforms from `listPlatforms()`** rather than spelling them out in `queue-view.html`, which is how it came to offer two out of three: CodeChef was added and that sentence was not. The platform filter (`ui/platform-filter.js`) is shared by both list views. It is a **dropdown**, not a chip row: chips grew with every platform added and competed for width with the very list they filter, whereas one control stays one line however many platforms exist. The collapsed button shows the active selection as marks plus "2 of 4", so what is filtered stays readable without opening it.

Its groups come from `listFilterPlatforms()`, so a new platform appears without touching either view. The list is **flat**: every group is one row carrying its platform's mark and naming itself in full, so no row depends on a header above it. Codeforces contributes two rows (Official and Gym) because that distinction is worth practising against; platforms with many subtypes contribute one, since nobody wants five AtCoder rows. An empty selection means **no filter**, not "show nothing".

`ui/dismissable.js` supplies close-on-outside-click and close-on-Escape, shared with the contest row's ⋮ menu; it listens in the capture phase so a handler that stops propagation cannot leave a popover stuck open.

**A contest row is an accordion.** Clicking it expands in place to show what that contest still owes the queue, rendered with `problem-row.js` so the expansion and the Queue cannot disagree — positions are omitted there, since the queue's numbering is global. The expansion is scoped to one contest rather than deduplicated against the others: a problem shared with another division really is in both, and hiding it would make the contest look shorter than it is. Expanded keys persist to `upsolve_tracker.expanded_contests`, because the view is rebuilt on every tab switch. **There is no chevron** — the expansion appearing is the indicator, with `aria-expanded` for anything that can't see it.

The row carries a **⋮ menu** holding *Open contest* and *Remove from queue*; the row is a `<button>`, not an anchor, so clicking it no longer leaves the panel. The menu button stops propagation, or opening it would toggle the accordion underneath.

**Removal asks first**, replacing a 700 ms hold on a ✕. The hold existed so "a stray press does nothing at all", and a dialog is a better guard than a timer because it says what is about to happen. Confirming still has to call `backUp()`, or the exported JSON drifts from the panel.

`contest-list` sorts by `startTimeSeconds` through `queue-order.js#byStartTimeDesc` — newest first, unknown last.

### Platform marks

Each mark lives on its **site**, beside its `chartColor` — a platform's own appearance is its own to declare. `core/ui/platform-icons.js` keeps only the fallback and the design rules that apply to all of them, and asks the registry. It uses `listPlatforms().find(...)` rather than `getPlatform()`, which **throws** on an id it does not know: the text-chip fallback is the whole point of the function, so a platform without a mark yet must show something rather than take the panel down.

AtCoder's is deliberately light-on-dark, inverting its black-on-white branding, because a `#222` square on the `#1e1e1e` panel is close to invisible.

A platform with no mark yet falls back to a text chip rather than rendering nothing.

### Untrusted input

Views build rows with template strings and `innerHTML`, so anything originating outside the extension goes through `ui/escape-html.js` first. That covers contest names, problem names and tags (scraped or API-supplied), and the problem URL and source label, which are both built from a scraped problem index. Values the extension derives itself — counts, ratings, the type badge — don't need it.

**One deliberate exception, and it is the only one:** the settings page injects each section's `label` and `help` as trusted HTML, so the Codeforces key-pair note can carry a link to its API settings page. That text is authored in this repo, in `core/settings/schema.js`. Nothing reaching that path comes from a platform or a user — and if the schema ever grows a field whose text does, it must be escaped like everything else.

`backup-validation.js` guards Import, which writes straight into `chrome.storage.local` with no undo. Note it uses `.some()`, not `.find()`: a `null` entry in `trackedContests` is itself falsy, so a truthiness check on `find`'s return value silently accepted malformed backups. There's a test for exactly that case.

**The exported backup is how you inspect the real queue from outside the browser.** `chrome.storage.local` is unreachable from a shell, but auto-export writes the whole store to `upsolve_tracker_backup.json` in whichever folder the picker points at — on this machine, `~/Workbench/__pinned__/upsolve-tracker/`. That is what made it possible to confirm the practice-mirror work against the actual 65 tracked contests rather than against fixtures, and to cross-check every stored flag against the live CodeChef API. It is only as fresh as the last refresh or add, since those — with remove and import — are what write it.

**Auto-export gotchas** (`services/auto-export.js`, used by the refresh, the add, removal and import):

- `verifyExportPermission()` must be called *before* the slow await in a click handler, because a `FileSystemDirectoryHandle` re-permission prompt only succeeds while the user gesture is still fresh. Moving it after the network work breaks auto-export after every browser restart.
- Any path that mutates `chrome.storage.local` must call `backUp()` afterwards, and report what it returns. The refresh writes solved status and tags straight to storage, so without that call the on-disk JSON silently drifts from what the UI shows — which is exactly how tags ended up visible in the extension but missing from the backup. An add that ended up *waiting* and Import both skipped it until 2.14.
- **The auto-export flag and its folder are staged together and written together on Save**, like the rest of the Settings page. The folder used to be saved or cleared the moment it was picked while the flag waited for Save, and that split is what allowed auto-export to be on with no folder: untick, close without saving, and the folder was gone while the flag still read true. The box cannot be ticked without a successful pick, so a Save can never write "on" without a folder either. So "on" always has a folder, and a null handle with the flag on means Chrome refused access. Import strips `upsolve_tracker.auto_export` for the same reason — the folder lives in IndexedDB and never travels in the file, so importing the flag would switch auto-export on with nothing behind it.
