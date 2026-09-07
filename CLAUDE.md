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

`npm test` covers the parts that fail *silently*: the estimator's maths, the standings parsing, the sampling arithmetic (via `sampling.test.js`, against captured fields, so no network is touched), backup validation and queue ordering — plus three things that are invisible by nature. **Request pacing** (`request-pacer.test.js`, `codeforces-http.test.js`, `codeforces-api.test.js`): nothing about a response says whether a delay was served, so pacing can be removed without any other test noticing. These are the only tests here that assert on **wall-clock time**, so they are also the only ones that can flake on a loaded machine — and the two kinds behave differently. `codeforces-http` and `codeforces-api` assert a **lower bound** (`gap >= 50` against a pinned 60ms), which a stall can only make more true. `request-pacer.test.js` asserts **both directions** via its `near()` helper, including two `near(…, 0, 40)` checks that a request should *not* have waited — a 40ms stall fails those. **If one goes red on CI and nowhere else, widen the tolerance; do not touch the pacing.** The pinned gaps are test-only anyway, set through `platform.reset(ms)` and the sources' static `reset(ms)`; production values are in the table below. **The platform boundary** (`module-boundaries.test.js`). And **the settings page's markup** (`options-settings.test.js`), which is generated from the descriptors and so is assertable in Node. There is no linter or formatter configured.

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

`tests/estimator-accuracy.test.js` records a **known bias**: estimates run below Codeforces' published ratings, by up to ~300 on the hardest problems.

**Do not confuse two different 14-of-15 figures.** The one in *Sampling the field* is
**sampling fidelity** — the ~1,500-competitor sample reproduces what reading the whole field
would have produced, for 14 of 15 problems. It says nothing about whether the model agrees
with Codeforces. Measured directly against the 15 published ratings in
`fixtures/real-contest-fields.json`, the estimator scores **mean |error| 100, mean signed
error −73, 6 of 15 exact, none out by 400**. Good, and visibly biased low — which is the
bias this file records, not an absence of one. An earlier version of `DATA.md` had merged the
two and claimed the model reproduced 14 of 15 *published* ratings; it does not. The Elo model assumes everyone attempted every problem, when most never open the hard ones — non-attempts read as difficulty-driven failures, so the model over-predicts solves and the search settles too low.

**"Model attempts, not ability" was the suggested fix, and it is wrong.** It was measured against 62 gym problems where CF publishes a rating — a real labelled set — and fitting only the parties that actually submitted took mean absolute error from 213 to **374**, with the bias swinging to −310. CF's own ratings are calibrated over everyone who *entered* the round, not everyone who opened the problem, so conditioning on attempters leaves the definition rather than correcting for it. Six other levers were tried and all were neutral or worse (attempt blending, shrinkage to the contest mean, the zero-solve target, the 800 floor, team collapsing by max/mean, Elo divisors 200–1000); the file lists the numbers so none is retried. Enforcing difficulty order across a contest was rejected before measuring — only 2 of 8 contests are actually sorted.

The residue is not reweightable: fed data from its own model at those field sizes the estimator has an irreducible error of 87 against an actual 213, so ~126 points is model misfit — most likely because the two numbers measure different things, difficulty for a two-hour CF round versus for a handful of teams sharing a machine over five ICPC hours. The response is honesty rather than accuracy: `ui/problem-row.js` marks an estimated rating with `~`, so a ±200 number does not read as exact.

It matters less than it did, because published ratings are now preferred wherever they exist — official contests and the ~32% of gym problems CF recognises, both via `sources.js#applyStandingsProblemData`.

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
- **Everything outside `core/platforms/` is platform-agnostic, and that is now enforced across the whole subtree.** `registry.js` and `adapters.js` are the only two modules allowed to know which platforms exist; everything else asks them. Five wholly-Codeforces modules used to sit in shared space — the signed API client, the scrape, its HTML parser, its HTTP client and the start-time sync — plus `secure-store.js` hardcoding three ids and their storage keys (it now stores a secret by slug and knows nothing else), `platform-icons.js` as a three-key map, and a settings page importing all three adapters by name.

  `start-time-service.js` was the instructive one, and an earlier version of this file argued it should stay. It exported `syncStartTimes` (Codeforces-only) *and* `byStartTimeDesc` (a pure comparator `contest-list.js` uses). One genuinely shared export is what kept a Codeforces module looking like shared infrastructure. It is split: the comparator is in `queue-order.js`, the rest is `platforms/codeforces-official/sync/start-times.js`.

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

- **The gates throw rather than answering false.** `needsSync` and `syncStartTimes`
  refuse a contest with no `type`, the same rule `platformOf()` follows for a record
  with no `platform`. This is the load-bearing one: it makes the whole class loud at
  runtime regardless of what any test covers.
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
- `linkedom` is a devDependency used only by the tests (`problems-page.test.js`, `gym-hidden-standings.test.js`, `options-settings.test.js` and others) to parse HTML in Node; shipped code uses the browser's `DOMParser`.

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

`registry.js` and `platforms.js` are the **only** two modules allowed to enumerate platforms. Nothing else — not a view, not a service, not the build — should branch on one, and `tests/module-boundaries.test.js` fails if it does.

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
find out", which is why a failed request waits rather than producing one. **It is now a CodeChef
phenomenon only.** AtCoder used to produce one whenever its standings could not be read — the
normal outcome when signed out — which was precisely the "we couldn't find out" case wearing the
other meaning's clothes. That reads `sourceUnreachable` and waits now, and the estimator bounds
rather than refuses, so nothing on AtCoder stores a null.

### Whose data is this? (`services/platform-identity.js`)

**Every platform has a handle you enter in Settings, and that handle is the authority.** Nothing that writes `solved`, or sets a rating the queue orders by, runs without one — and **a contest cannot be added for a platform whose handle is missing**, because it would store unmarked, its solved problems would never clear, and it would look like the sync was merely slow.

Adapters check it through `verifyIdentity(session)`, which returns `{username, rating}` or throws, before any user-specific read — on the refresh **and** the add path, since adding a CodeChef contest reads `problemsstats` too. Verification is free: the same call already fetched the rating. Codeforces uses `user.info`, AtCoder the profile page, CodeChef the bootstrap object `createSession` already read.

The check differs by how each platform is addressed:

- **Codeforces and AtCoder are asked *about* a handle**, so who is signed into those sites is irrelevant and verification only confirms the handle exists. That matters more than it sounds: `user.status?handle=X` returns X's submissions no matter whose key signs the request, so an unchecked handle silently yields somebody else's history. Codeforces' canonical casing is taken from the API, so `Tourist` over `tourist` is not read as a change.
- **CodeChef answers for whoever holds the session cookie**, so the configured handle is additionally compared against the signed-in account. A mismatch throws with **`isIdentityMismatch`** and callers must always stop — `solved` is only ever set true, fully-solved contests are deleted outright, and `writeBackup()` runs after the sync, so one sync under another account permanently corrupts the queue *and* overwrites the backup with the corruption.

Settings confirms the resolved account for all three, in one shape: *“Connected as tourist”* where the handle is looked up, *“Signed in as tourist”* on CodeChef where the browser session really is the identity. Each runs the **same `verifyIdentity` the sync runs** — a check that exercises a different call can pass while the real path fails — and Codeforces runs it against the values typed in the form rather than the saved ones. AtCoder previously showed nothing at all, which mattered most there: its history is read *about* a handle, so the resolved account is the only thing between a typo and a queue synced against a stranger.

**What the check can and cannot establish differs by platform, and the difference is not cosmetic.** On CodeChef the browser session *is* the identity, so the signed-in account is compared against the configured handle and a mismatch throws. On Codeforces and AtCoder there is no session involved — `user.status?handle=X` returns X's submissions whoever's key signs the request, and AtCoder's submissions are read *about* a handle through `f.User=`, which returns that handle's rows whoever is signed in. Codeforces offers no "who am I" endpoint, so there **the handle is verified to exist, not to be yours**. **AtCoder no longer has that gap:** every page it serves carries `var userScreenName`, so `atcoder/scrapers/page-globals.js` reads the signed-in account and `verifyIdentity` refuses a handle that contradicts it. The policy is narrower than CodeChef's on purpose — there the session *is* the identity, so a mismatch means the data is the wrong person's; here `f.User=` means the data is right either way and a mismatch just says Settings has the wrong handle. So it throws only on **positive evidence**: signed out (`""`) or a missing marker (`null`) both proceed, because adding a contest has to keep working without a session and "we could not tell" is not evidence: enter someone else's and you will sync their solves. What contains that is the *changed*-identity path, which clears that platform's flags rather than merging them, so the mistake is recoverable.

The guarantee rests on three independent layers, each confirmed by removing it and watching `tests/identity-guard.test.js` fail:

1. `adapter.verifyIdentity` runs before any user-specific read, on the refresh (`progress-manager.js`) *and* the add (`contest-manager.js#establishIdentity`).
2. `classifyIdentity` throws on a blank username, so an identity that was swallowed rather than verified still cannot get through.
3. CodeChef's `fetchSolvedKeys` verifies again on its own — the layer that survives when the first two are both defeated, and the reason a caller cannot accidentally read another account's solves. **It is the only platform that checks twice, so it reads like an oversight**; the comment beside it now says it is not. It makes reading the wrong account's solves impossible from *that function* rather than merely unlikely from its callers, and it costs nothing extra, reading the session object the add already built.

`services/platform-identity.js` answers the one remaining question: **has that handle changed since the solved flags were derived?** If so they belong to the previous account and are cleared, for that platform only, so the next sync re-derives them. That restores what this file already claims — solved state derived fresh each sync rather than cached — which the stickiness had quietly made false. Contests already deleted for being fully solved cannot come back.

`updateSolvedStatus` returns `{removed, failures}` rather than a bare array. **Failures are surfaced, not just logged**: a silent refusal looks the same to the user as a silent corruption. The shell reports them **last**, after the backup write and the view refresh — reporting earlier let `"Writing backup…"` overwrite the message for exactly the users whose backup was at risk.

Note the Codeforces HTML client (in `codeforces/gyms/sources.js`) sends cookies, but the one page it still reads — `/gym/<id>`, read by `scrapers/problems-page.js` — yields only the contest name and its problem list, nothing about the viewer. So it needs no identity, and neither does AtCoder's public tasks page. (That file used to read competitors' handles, solve counts and pagination too; the standings scrape is gone, which is what the rename recorded.)

### Platforms

The registry is *pure* — URLs, identity, capabilities — so anything can import it. Network
work lives behind a **platform instance**, one per site, held by `core/platforms/platforms.js`.
The split is deliberate: `backup-validation.js` imports the registry, and must not drag the
network stack in with it.

**Every platform extends `Platform` (`core/platforms/platform.js`), and the base is where the
contract lives** — not in a test, not in a destructure. It names every hook a platform
implements, refuses at construction a subclass missing one or one whose `canEstimate`
disagrees with whether it estimates, and checks every shape that crosses the boundary,
naming the platform when one is wrong. Before it, each folder had the same seven file names
and a different design inside: three session shapes, two ways of reaching the site, four
`fetchContest` signatures, a `field.js` that meant something different in each folder.

What callers use — the orchestrators and the settings page:

| method | answers |
|---|---|
| `createSession()` / `createSessionFrom(values)` | a Session, from saved or unsaved settings. **The orchestrator never sees a credential.** Settings verifies what you *typed*, so a wrong key tells you before you rely on it. |
| `verifyIdentity(session)` | `{username, rating}`, or a throw whose **message is the user-facing verdict**, in Settings and in the queue's status strip alike |
| `describeIdentity(identity)` | how Settings names the account — "Connected as X", or "Signed in as X" on CodeChef, where the browser session *is* the identity |
| `fetchContestRecord({contestId, subtype, session, onProgress})` | the whole add: one of the five statuses, with the stored-shape contest on `ready` |
| `fetchSolvedKeys(session, contests, onProgress)` | a Set of `descriptor.solvedKey` values |
| `syncMetadata(session, contests, onProgress)` | fills in what arrives after the add |
| `reset(spacingMs)` | the one test seam, replacing five per-platform ones |

What a platform implements:

| hook | returns | required |
|---|---|---|
| `static settingsSection` | the slug of its section in `settings/schema.js`; the base reads that section's slugs, so a slug is declared once | yes |
| `buildSession(values)` | `{ handle, sources, ... }` — **the site's `Source` rides on the session**, so every read goes through `session.sources` and a fake is injected the same way on every platform | yes |
| `identify(session)` | `{username, rating}` | yes |
| `fetchContest({contestId, subtype, session, onProgress})` | a status, or `{ id, name, problems, startTimeSeconds, publishedDataCheckedAt, sourceId?, context? }` | yes |
| `fetchAccepted(session, contests, onProgress)` | `{contest: {id}, problem}` pairs — never a bare `null` contest | yes |
| `readField({contest, context, session, onProgress})` | what the estimator fits against; or a status — `sourceUnreachable` where the data will come, `unavailable` where it never will; or null when there was nothing to measure | iff `canEstimate` |
| `estimate(contest, field)` | fills the gaps in place; **pure** | iff `canEstimate` |
| `syncMetadata`, `describeIdentity` | overrides | optional |

**The base owns exactly what means the same thing everywhere** — this file's naming rule
applied to steps: the stored contest shape (`buildContestRecord`), the per-problem defaults,
the `isSourceUnreachable` → `sourceUnreachable` translation, the `readField → estimate`
composition (`estimateMissing`, which a re-check reuses), and mapping accepted pairs through
`descriptor.solvedKey`. **Every gate stays inside `fetchContest`**, returned as one of the
five statuses; the base passes one through. Codeforces has five decision points, AtCoder two,
CodeChef resolves a division first, and none of that reaches the base. **The gap policy is
deliberately not in the base** — `contest-manager.js` applies it against
`capabilities.canEstimate`, and two places would be free to disagree.

`contest-manager.js` is just the orchestrator: match the URL, pick the platform, mark solved,
decide whether the record is complete enough to store. Adding a platform is a folder (below),
one line in `registry.js`, one in `platforms.js`, and a settings section; the base refuses at
construction if a hook is missing.

#### The shape of a platform folder

**The root is a closed set of five names**, and `module-boundaries.test.js` fails on a sixth.
Anything a platform can have *N* of lives in a folder named for its kind, so `ls` says which
is which:

| file | role | where |
|---|---|---|
| `descriptor.js` | what the registry needs; pure | always |
| `platform.js` | `class X extends Platform` — the contract, nothing else | always |
| `sources.js` | `class XSources extends Source` — the site's reads; nothing else exported but at most a singleton `sources` | always |
| `field.js` | `readField` — the I/O that produces what the estimator fits against | iff `canEstimate` |
| `estimator.js` | `estimate` — pure; imports no source, client or field | iff `canEstimate` |

| folder | one file per | today |
|---|---|---|
| `scrapers/` | page scraped — a `Scraper` subclass each | 6 |
| `sync/` | pass filling in data that arrives after the add — each exports exactly `sync(session, contests, onProgress)` | 5 |

**A base folder holds what two platforms share.** `codeforces/` is one: its `platform.js`
exports a class no platform is built from and two extend, and it carries `sources.js`,
`estimator.js`, `field.js`, `sync/` and `site.js` — the descriptor pieces its platforms
spread — with `official/` and `gyms/` beneath it. It has no `descriptor.js`, because it is not
a platform and the registry must not be able to list it. `module-boundaries.test.js`
classifies every folder under `core/platforms/` from what `platforms.js` registers — a
platform folder, a base folder, or an offender — and keys every other check on that, so no
check assumes a folder is named after its id.

Rules that hold, each pinned by a test that was seen to fail:

- **Nothing in a `scrapers/` folder fetches**, and every file there exports one `Scraper`
  subclass with `scrape(doc)` overridden and its selectors declared. That is what lets every
  scraper run in Node against `linkedom` with no network stack, which is most of the coverage
  these platforms have.
- **A source singleton is reached through the session, never imported.** A platform's class
  attaches it to the session it builds; a module that imported it instead would work in
  production and be untestable.
- **An estimator is pure.** `field.js` reads and answers a status when it cannot;
  `estimator.js` fits what it read. The base refuses half an estimator, and the two files
  exist — in the platform's folder or its base's — iff `canEstimate`. Claiming the capability
  with no estimator refuses every add; estimating without claiming it stores `???` beside
  numbers already worked out.
- **`DOMParser` is constructed in exactly one place**, `services/site-client.js#getDocument`;
  a scraper only ever receives a finished `Document`.
- **Codeforces signs in exactly one place**, `codeforces/sources.js`.

**`Scraper` and `Source` are the two other bases.** A scraper owns one page: `scrape(doc)`
returns that page's facts or null, never a plausible default — the old code left solve counts
at `0` when a totals row went missing and stored confidently wrong ratings. Statics, because
scraping is pure and nothing needs `new`. `page-globals.js` is named for a fragment rather
than a page because AtCoder emits its marker on every page it serves; it is a scraper like the
rest, reading a `<script>` element. A source owns one site's reads: endpoints as methods,
what an answer's fields mean as statics (`CodeChefSources.parseDifficulty`, `ACCEPTED`), and
it is instantiable because on Codeforces it holds a **key pair** — `buildSession` builds one
per credential set, and Settings builds a second to check credentials typed but not saved.
Platforms without credentials export a singleton.

Two files earn their own name by cadence rather than by subject.
`codechef/sync/published-data.js` and `codechef/sync/practice-flags.js` are both re-checks
run from one `syncMetadata`, and they are separate files because they differ in every way
that matters — weekly against every refresh, write-once against both directions, gated on a
timestamp against gated on the flags already stored. Sharing a file invites sharing a gate,
and the slower pass would then suppress the faster.

`progress-manager.js#updateSolvedStatus()` loops over every platform with tracked contests, **isolating failures**: one site being down or unconfigured must not stop the others, and if *every* platform fails it returns before the write so a bad sync can't touch storage. `applySolvedStatus()` is split out and pure because it's the step that fails quietly.

Two invariants there:

- **`solved` is only ever set true, never cleared.** That stickiness is load-bearing. CodeChef answers a logged-out request with an *empty* solved list rather than an error, and clearing on that would resurrect every finished problem.
- **`solvedKey` is namespaced by platform** (`codeforces:2193-A`). One `Set` holds solved history from every site, so a bare `contestId-index` would let two platforms sharing a contest number mark each other's problems solved.
- **An accepted pair's `contest` is always an object, never a bare `null`.** `fetchAccepted` returns `{contest, problem}` and the trunk hands both to `solvedKey`. The three platforms once had three encodings for "this problem needs no contest" — `{id: contestId}`, `{id: null}`, and `null` — which was harmless only because neither AtCoder's `solvedKey` nor CodeChef's reads `contest`. The day one starts to, it would work on AtCoder and throw on CodeChef from a line naming neither. `record-contract.test.js` pins the one shape.

Note every relative import must carry its `.js` extension. Vite resolves extensionless paths, Node does not — three of them had been sitting in what are now `sources.js`, `rating-distribution.js` and `options.js`, invisible until a test imported that part of the graph.

`backup-validation.js` refuses a backup whose contests omit `platform` or name one this build doesn't know, since either would otherwise throw later while rendering the list.

### Waiting on a contest the platform hasn't published yet

`core/waiting-contests.js`. Adding a round minutes after it ends fails for the same reason everywhere: the data isn't there. AtCoder Problems has not indexed it; a Codeforces standings totals row has not settled. The message was correct and the only recovery was to come back and click Add again — at the one moment you most want the contest queued. So the attempt is remembered under `upsolve_tracker.waiting_contests`, and every global refresh retries it.

**Waiting entries are their own storage key, never `trackedContests`.** They carry no `problems` array, so filing one in the queue would break `backup-validation.js`, `collectPendingProblems`, the platform ring and the stats histograms at once. They still ride along in the backup, since `writeBackup()` dumps `chrome.storage.local` wholesale. Keying is `makeContestKey`, identical to a tracked contest, so the two can never be filed under different names for the same round.

Four things are easy to get wrong:

- **Which failures may wait is a property of the fact, not of the platform.** `shouldWait()` in `contest-status.js` answers it, identically everywhere: `notEndedYet`, `notPublishedYet` and `sourceUnreachable` wait; `unavailable` refuses, and is the one status that also **drops an existing waiting entry** on retry, since another attempt cannot change the answer.
- **Entering the state is a flag on the error, never a message match** — `error.isNotPublishedYet`, the same idiom as CodeChef's `isIdentityMismatch`. A copy edit to "doesn't list contest" must not silently turn a contest that would have resolved into one that is never retried. `error.isAlreadySolved` exists for the same reason on the other side.
- **It must not be logged as a fault.** `console.error` from an extension page is filed under `chrome://extensions` as an extension error, with a stack trace and a red badge — once on the add, then again on *every refresh* for as long as it waits. So `contest-manager.js` logs it at **`info`** when `isNotPublishedYet` is set, and errors as before for everything else. `warn` is not enough — that page collects error *and* warning levels, so downgrading to `console.warn` only changed the icon from a red circle to a yellow triangle, and the test that watched `console.error` alone passed while the entry was still being filed. `tests/waiting-quiet.test.js` drives the real `processNewContest` for both halves of that branch, since the logging is in its catch.

  **The same trap is still live in one place, knowingly.** `codeforces/sources.js` logs every failed API call at `console.error`, so typing a wrong key into Settings and pressing *Test connection* files an extension error against the extension — a red badge for what is just a typo the page already explained. It was left alone because it is not only a Settings path: the same line fires when a sync genuinely fails, where an error *is* the right level. Splitting the two means deciding at the call site rather than in the client. Worth doing, not urgent.
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

### AtCoder

`core/platforms/atcoder/`. Everything here is read from **atcoder.jp itself**, and
difficulty is fitted locally. AtCoder Problems (kenkoooo) was the source for all of
it — problems, contests, submissions and difficulty — and is now used for none of
it; `kenkoooo.com` is gone from the composed `host_permissions`, which is the
mechanical check that the dependency is really absent. AtCoder needs no key or
secret, only a handle (`upsolve_tracker.atcoder_handle`).

Three routes, and **none is matched by AtCoder's robots.txt**. Every directive
there ends in a slash — `/contests/*/standings/`, `/contests/*/submissions/`,
`/submissions/`, `/users/*/history/` — so a path that stops at `submissions` falls
outside them, while `/submissions/me` and per-submission pages fall inside and are
deliberately never requested.

| route | auth | gives |
|---|---|---|
| `/contests/<id>/tasks` | public | name, start/end, every problem with its task id |
| `/contests/<id>/submissions?f.User=&f.Status=AC` | session | what you have solved |
| `/contests/<id>/standings/json` | session | the field, from which difficulty is fitted |

**Why this is a scrape rather than an API call: there is no API.** Every candidate
JSON route 404s (`/submissions/json`, `/submissions/me/json`,
`/users/<handle>/submissions`, `/api/…`). The four that exist — `standings/json`,
`standings/extended/json`, `standings/virtual/json`, `score/json` — cannot see an
upsolve, because AtCoder freezes standings when a contest ends and upsolving
happens after that. `results/json` is public but carries only place, performance
and rating. Reading the site's own client JS settles it: every `$.ajax`/`$.post` in
`base.js`, `contest.js` and `utils.js` — five calls — is `clarifications/count`, a
waiting-judge poller, `/servertime`, and `settings/fav/{add,delete}`. AtCoder ships
jQuery 1.9.1 and no SPA framework; it is a server-rendered Java application, so
HTML is the interface, not a fallback from one.

**On the ToS, since this reverses an earlier position.** robots.txt (RFC 9309)
governs *crawlers*; it is a discovery-and-indexing convention, not access control,
and says nothing about a user agent acting on explicit instruction over pages the
user is authenticated for. AtCoder's Terms of Use were read and contain **no clause**
on automated access, scraping, bulk access, rate limits or data reuse — only a
general prohibition on damaging the service. CodeChef's caution does **not**
transfer: that rests on its ToS §14, an explicit contractual ban on crawling, which
is a materially stronger constraint.

Things that are easy to get wrong:

- **Reading a contest's own tasks page is what retired `contest-problem.json`.**
  1,906 of 9,383 problems belong to more than one contest, and a global list records
  only the one a problem debuted in. A contest's own page answers for exactly that
  contest, so the workaround is not needed rather than reimplemented.
- **Identity is the task id**, not contest + index — `solvedKey` and `problemKey` are
  both `atcoder:<task_id>`. In a daily-training rerun `abc432_c` is listed as problem
  E, so anything keyed on the displayed index silently treats them as different
  problems. `scrapers/tasks.js` and `scrapers/submissions.js` both read the id from the row's
  link for this reason.
- **Difficulty is unbounded below.** 931 rated problems are negative; ABC471-A is
  −817. Nothing here may apply the Codeforces estimator's `Math.max(800, …)` floor
  or its round-to-100 — which is exactly why the two estimators pass their constants
  explicitly rather than inheriting defaults.
- **`canEstimate` is `true`, and the estimator had to earn it.** This read `false`
  for as long as the reasoning was "flipping it would make an unrated problem a
  hard error, so a signed-out user could not add a contest at all". That was true
  of the arrangement, not of AtCoder: the signed-out case is *"we could not
  read the standings"*, which is a failure to ask, not a statement that the
  problem has no difficulty. It now answers `sourceUnreachable` and waits, and
  the add works without a session again — by queueing rather than by storing a
  contest of "???".
- **The estimator bounds where the source refuses**, which is what makes the flip
  safe. AtCoder Problems declines in four situations — nobody solved it, everyone
  did, fewer than forty usable rows, a fit past the ceiling — and each is a
  situation `codeforces/estimator.js` answers with a bound instead
  (`actualSolves === 0 ? 0.5`, the 800 floor, gyms of 5–76 parties). Same maths,
  opposite policy, so a problem was rateable on one site and not the other for no
  reason a user could act on. `fitTask` bounds now. **The port guarantee is
  untouched:** the *model* is pinned against that Python's own numbers by
  `rating-models.test.js`, which must keep passing unchanged; the refusals were
  policy wrapped around it. `atcoder-estimator.test.js` carries the one
  deliberate divergence by name.
- **The two failure modes are deliberately asymmetric.** Standings failing is *soft*
  after the add — an already-stored contest fills in on a later refresh — but on the
  add itself it waits rather than storing nothing. Submissions failing is *loud* —
  `fetch` follows the 302, so a signed-out request arrives as a healthy 200 containing the login form,
  and parsing it yields no submissions, which is indistinguishable from having
  solved nothing. `solved` is sticky, so that would strand the queue silently. Both
  clients check `response.url`'s path for `/login`; see each `sources.js`.

**Two costs of leaving kenkoooo, both known trades rather than bugs:**

- **Solved status is now per contest**, because AtCoder publishes no per-user
  submission list. That is one request per tracked contest per refresh — roughly 10s
  at seven contests, ~45s at thirty — where the feed cost one or two regardless of
  queue size.
- **A task solved in an untracked contest no longer clears.** The feed was
  user-wide; per-contest reading cannot see a solve made through a contest you do
  not track (having solved a problem in its original ABC, then tracking a rerun of
  it). The failure is a stale queue row, not a wrong one, and nothing AtCoder
  publishes would answer it.

**The original symptom that started all this was not a bug.** An upsolve appeared to
be ignored; it had been made ~3 minutes earlier and kenkoooo's crawl runs 2–3
minutes behind (measured 2026-09-03: frontier lag 2.5 → 2.8 → 3.1 min). **Contest
age was irrelevant** — of 525 submissions indexed in a two-hour window, 78% were to
contests older than 30 days, 76% older than 90 and 60% older than a year, including
one 10.5 years old. The natural "recent contests often, old ones on a slow sweep"
explanation is false, and worth stating so it is not reached for again.

### CodeChef

`core/platforms/codechef/`. No estimator here either: CodeChef publishes `difficulty_rating` and does so promptly — Starters 252 was fully rated within two days of running. `/api/rankings/` is CSRF-gated and returns 403, but nothing needs it.

CodeChef's public API was retired years ago and the site is an SPA, so the only route to its data is the same `/api/` endpoints the front end calls. **Its ToS §14 forbids crawling**, which is why `sources.js` is written to be strictly user-session shaped: only the contest the user is looking at, its problems, and their own solve history; `/api/` paths only (robots.txt disallows `/problems/*`, `/status/*` and `/recent/user`); and a 403 stops and surfaces an error rather than retrying. What would make it a crawler is **enumeration** — paging the ~21,000-problem catalogue. `/api/list/problems` *is* used, but only ever scoped by `group=attempted` and behind a page cap; see below.

Four traps, all confirmed against the live API:

- **`problemsstats.solved` changes type.** Signed out it is an empty **array**; signed in it is an **object** keyed by problem code. Array methods silently see nothing on the shape that actually carries data, so read it with `Object.keys`.
- **Signed out looks identical to "solved nothing."** `fetchSolvedKeys` therefore refuses outright when `signedIn` is false, so `progress-manager` isolates the failure and leaves existing flags alone. This is the case the stickiness invariant exists for.
- **`problemsstats` cannot see an upsolve, and neither can the per-problem endpoint.** Both report only what happened *during* the contest. A contest closes to submissions when it ends, so upsolving happens in practice — see the section below, which is why solved status is no longer read per contest at all.
- **Two out-of-band difficulty values**, both arriving as strings: `-1` for unrated (74% of the catalogue) and `9999`. Both become null. `9999` is the dangerous one — it is also the queue's own sort-last sentinel, so passing it through would read as a legitimate, very hard problem.
- **A failed per-problem fetch is not evidence that CodeChef has no rating.** Difficulty
  costs one request per problem, and conflating a failure with an absence stored `???` for
  problems CodeChef *had* rated. The contest waits and retries instead — the general rule at
  the top of this file (`???` means the site says unrated, never "we could not find out"),
  with the instance that produced it.
- **Whether a contest is still running is decided by CodeChef's clock, not yours.** The
  payload lists the problems *during* a contest, so nothing about the problem list says the
  contest has finished — adding mid-flight would record in-contest results as if they were
  final. CodeChef reports its own server time beside the contest's end time, and that pair is
  what the check reads. A local clock that is wrong, or merely in a different timezone, would
  otherwise decide it.
- **`/START252` is a parent contest** with an empty problem list and no error. Divisions are rating-banded, so the user's own rating (from `codeChefUserData`) selects the one they competed in; with no known rating it names the divisions rather than guessing.

Costs one request for the contest plus **one per problem** — difficulty and tags appear on no bulk or contest-level response, signed in or not. That is ~9 for a Starters division, still fewer than a Codeforces add. Tags mix real topics with the setter's handle and the contest code (`['combinatorics','raysh07_adm','start252','trees']`), so `cleanTags` strips both.

`scrapers/page-globals.js` is the one place CodeChef's markup is read, extracting `window.codeChefUserData` from `/dashboard` by **balanced-brace slicing** — a non-greedy regex stops at the first `};` inside a nested object or a string. It returns `null`, never a default: a guessed handle would look like a signed-in session.

**It reads that global out of a `<script>` element, which is a DOM node like any other.** This file and AtCoder's namesake both used to regex the raw HTML *string* instead, which made them look like an exception to the folder they sit in — an exception this file spent a paragraph excusing. It was expedience, not necessity. Selecting the script is what made all six parsers uniform, and it removed the last consequence of the split: `atcoder/identity.js` had been fetching its page as a string and hand-building a `Document` from it *because the two parsers disagreed about their input*. One `getDocument` now, and **`new DOMParser` appears in exactly one file in the tree**, `services/site-client.js` — asserted by `module-boundaries.test.js`.

Note `solvedKey` is `codechef:<problem_code>`. The same problem runs in every division of a Starters, so solving it in Div 4 clears it from a tracked Div 3.

#### Solved status is read per user, not per contest

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
- **`refreshPracticeFlags` (`codechef/sync/practice-flags.js`) runs on every refresh, not on the weekly `publishedDataCheckedAt` stamp that `sync/published-data.js` next door uses**, and writes in **both** directions — a problem CodeChef later mirrors has to come back to the queue, so unlike `solved` this is not write-once. It looks **only at contests that still carry a flagged problem**, so the normal fully-mirrored queue costs nothing; reading the *contest* payload rather than the per-problem endpoint is what makes even the flagged case cheap, at one request per affected contest instead of one per affected problem. A contest with nothing flagged is deliberately never re-checked: the only thing that would find is CodeChef *removing* a problem from practice, which does not happen, and paying a request per contest per refresh to look for it would be the sweep this client exists to avoid. A failed re-check leaves the flag alone rather than clearing it — guessing a problem back into the queue on a network blip would undo the point.

**Unconfirmed, and the reason for the fast cadence:** a contest added *hours* after it ends may plausibly report every problem as unmirrored simply because CodeChef has not got to them yet — which would empty the queue for exactly the contest you most want to upsolve. It could not be reproduced: the freshest contests reachable (START252D and DSAMONDAY016, four and six days old) already reported every problem mirrored, so mirroring is evidently prompt. Re-checking every refresh means that case self-corrects on the next one rather than persisting for a week. The first add of a just-finished contest is still the proof.

A `contest.practiceSyncedAt` stamp existed briefly, so a one-time backfill could flag contests stored before this feature without re-running forever. It is gone — the one install was backfilled and its ten CodeChef contests verified against the live API, so per the no-back-compat rule at the top of this file the normaliser came out rather than living in the tree. **Don't reintroduce a stamp to re-check unflagged contests**; that is the sweep the cost argument above rules out. Records written during that window still carry the vestigial key, and nothing reads it.

Note the expansion's opt-in is the one part of this **no unit test reaches** — removing it leaves the whole suite green. `npm run smoke` covers it: the store seeds START252D with an unmirrored problem, and the run fails unless the queue omits it while the contest's expansion lists it with exactly one mark. Confirmed the usual way, by removing each piece and watching the run report the original symptom.

### Codeforces is one base and two platforms

`codeforces/official/` and `codeforces/gyms/` are separate platforms. They were one platform
with two subtypes, and six modules independently asked which one they had — six conditions
that had to agree with nothing checking that they did. One had already failed that way:
`needsSync` read `contest.type !== "OFFICIAL"` on a record built before `type` was stamped on
it, so every official add silently skipped its published ratings. **The folder answers that
question now**, and every one of those branches is gone.

They are genuinely different pipelines, not two flavours of one:

| | official | gym |
|---|---|---|
| roster | `contest.standings` (unsigned) | `contest.standings` (signed), or the problems page when standings are hidden |
| ratings/tags | `problemset.problems` + standings | standings only |
| field | `ratingChanges`, else sampled standings rows | standings rows, or `contest.status` parties |
| API methods | `getPublicContestStandings`, `getContestRatingChanges`, `getProblemsetProblems` | `getContestStandings`, `getContestStatus` |
| HTML | **none at all** | none, unless the standings are hidden |

**What they share is an account and a site, and it is inherited, not copied.**
`codeforces/platform.js` holds identity and the submission stream; `codeforces/sources.js`
the signed client, the signing (SHA-512 over `rand/method?sortedParams#secret`),
`user.status`, `user.info`, and the applier that takes a standings response's published
ratings and tags; `codeforces/estimator.js` the fit both run; `codeforces/field.js` the
party-to-rating step both fields end in; `codeforces/site.js` the origin, mark, host
permission, rank colours and keys both descriptors spread. Until this existed the two folders
held 744 byte-identical lines with a test forbidding them to diverge. **They import the base
and never each other**, which `module-boundaries.test.js` pins.

Three consequences worth knowing before changing anything here:

- **The duplicated `user.status` fetch is load-bearing.** `progress-manager.js` loops
  platforms, so a refresh reads the whole account's submissions twice. The response carries
  no gym/official marker, so each platform stamps its own `solvedKey` prefix on the same
  stream and `applySolvedStatus` looks up by the prefix of the platform that *owns* the
  contest. Skip either fetch and that platform's solves stop clearing.
- **They share one request budget.** The signed client is one object in the base, named
  `budget: "codeforces-api"`; without that, two clients each honouring a 2 s gap would serve
  one request per second to codeforces.com.
- **The signed API never refuses at the transport** — a bad key is a 200 with
  `status: "FAILED"` — so it goes through `site-client.js` with a direct `fetchImpl` and a
  no-op `refusal`, and `tests/codeforces-api.test.js` pins the string that is hashed, since a
  wrong `apiSig` is indistinguishable from a bad key. **One method is deliberately unsigned**:
  `getPublicContestStandings`, because Codeforces serves a non-gym standings only to an
  anonymous request with no extra parameters, and signing appends two. That method is also the
  one no adapter test reaches, since they all stub the service — which is how it once shipped
  calling a pacer that no longer existed. The API test now drives it through a fetch stub.

**The one page Codeforces still reads** is `/gym/<id>`, for a gym whose standings the setter
hid: it answers `FAILED` to `contest.standings`, and the problems page is the only page such
a contest renders. It is the definitive problem list — a problem nobody attempted appears in
no submission, so a list rebuilt from `contest.status` would come out silently short.
`GymSources#getDocument` is how that page is read, through the HTML client with the session
cookie and throttling tuned against the live site; `module-boundaries.test.js` pins that
`gyms/sources.js` makes exactly one page read and that it is not a standings page. So **an
add needs no codeforces.com tab** unless the gym's standings are hidden. Three scrapes went
before that: the official roster and its field sampling (both already in `contest.standings`),
and the gym roster (the same call was made anyway, and the API's counts overwrote the page's).
The recorded reason for the gym scrape — "a gym's roster has no API source: its standings
need signing" — did not survive checking: needing a key is not an obstacle when the key is in
hand.

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
descriptor })` derives the match patterns from that descriptor's
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

`site-client` answers three ways, and between them they cover what the consumers
want: `get` a string, `getJson` an object, **`getDocument` a `Document`** —
which is what everything in a `scrapers/` folder takes. That last one is why
`DOMParser` no longer appears in platform code at all.

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
transport. That is what lets one `Source.json()` serve all four platforms.

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
across every `CodeforcesSources` while the instance that asked still signs the
call. Neither copy had any test at all — a cache that never hits is invisible in
the result and visible only in the request count — so `tests/ttl-cache.test.js`
drives a stubbed clock and was confirmed by breaking it both ways, never hitting
and never expiring.

**`services/request-pacer.js` is the only pacing mechanism**, and every caller configures it. An earlier version of this file claimed each platform already paced through it; that was false for Codeforces, which had two paths and used neither. The scrape carried its own `HttpClient` with a hard-coded jitter range and cooldown, and **the signed API was paced by nothing at all** — the tell being three hand-rolled `await delay(2000)` calls standing in for it at the call sites that had noticed.

| caller | configuration |
|---|---|
| `atcoder/sources.js` | `gapMs: 1500`, `credentials: "include"` |
| `codechef/sources.js` | `gapMs: 1500`, `credentials: "include"` |
| `codeforces/gyms/sources.js` (the HTML client) | `gapMs: [1000, 2500]`, `measureFrom: "end"`, `cooldown: { everyNth: 15, gapMs: [6000, 12000] }`, `credentials: "include"` |
| `codeforces/sources.js` (the signed API, both platforms) | `gapMs: 2000`, `budget: "codeforces-api"`, `credentials: "omit"` |

Each caller makes its own pacer, so budgets are independent — `HttpClient`'s counter was a single static shared by everything, which is now per-instance state and structurally impossible to cross.

**`budget` is the one deliberate exception, and it exists because independence is wrong for two clients addressing one *host*.** Codeforces is two platforms with an API client each, and two clients each honouring a 2 s gap serve one request per second to codeforces.com — the same failure per-instance state was introduced to prevent, arrived at from the other side. A caller may name a `budget` (`codeforces-api`); every pacer naming it shares one queue, marker and count, while keeping its own gaps, cooldowns and transport. The name comes from the caller, so `request-pacer.js` still never learns which platforms exist, and a pacer naming none keeps private state exactly as before. Both halves are pinned in `request-pacer.test.js` and were confirmed by breaking each: ignoring the budget, and letting it leak into unnamed pacers.

**`measureFrom` exists because of a real difference, not for symmetry.** `"start"` waits until `previousStart + gap`, so a slow request eats into the next gap. `"end"` waits the full gap after the previous request *finished*, and waits it before the first request too — which is what `HttpClient` did. They diverge exactly when a request outlasts the gap, and collapsing them onto `"start"` silently makes the Codeforces scrape **faster**. Even sampled, adding a contest issues tens of requests, and these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing. `tests/request-pacer.test.js` fails on that specific collapse; it was confirmed by making it and watching exactly those two assertions go red.

Requests queue through a promise chain rather than each checking the clock. `HttpClient` had a variant of the flaw that guards against: it slept a random interval per call with no queue, so two concurrent callers slept in parallel and then fired together. It was latent rather than live, since every scrape call site is a sequential `await` — but absorbing it closed the hole rather than preserving it.

**Confirmed in the real extension**, by removing a tracked contest and adding it back on all three platforms. That exercises the newly paced signed API end to end alongside the throttled scrape, solved marking and the backup write — the pacing was the one behaviour change here with real risk, since nothing about a response says whether a delay was served.

What that does *not* reach is the waiting branches: those contests were already published, so the problemset gate passed immediately and the gym phase check saw a finished contest. A round fresh enough that Codeforces has not indexed it yet is still the only way to see `notPublishedYet` fire on the add path.

Codeforces' HTML client, in `codeforces/gyms/sources.js`, sets `credentials: "include"` so the user's session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error.

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
     that `sync/published-data.js` settles later. Absent →
     `notPublishedYet`, and **nothing is scraped** — the alternative was tens of throttled requests
     spent producing an estimate the re-check would overwrite. The response is cached for
     60 s so the check and step 3 don't fetch ~2 MB twice.
   - *Gym*: has it finished? Gyms are never in the problemset, so they skip that check entirely —
     applying it would make every gym unaddable. Phase comes from `contest.standings`' own `contest`
     object, or from the problems-page sidebar (`.contest-state-phase`) when standings are hidden.
     Still running → `notEndedYet`. An unreadable phase proceeds: refusing on a label we can't read
     would make a contest unaddable for a reason we can't state.
2. `codeforces/official/sources.js#contestFromStandings` — read the problems off `contest.standings`. Official
   contests read solve counts from the "Accepted" totals row; gyms instead count
   `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties. Returns
   `solveCountsRead`, false when the totals row wouldn't parse.
3. `codeforces/sources.js#applyStandingsProblemData` — apply Codeforces' published ratings and tags, off the standings response already in hand.
   Anything rated here needs no estimate, which is why it runs *before* the expensive steps.
4. `field.js#readField` — produce the participant rating distribution, as
   **strata**: `{ strata: [{ ratings, scale }] }`, where `scale` is how many real competitors one
   read competitor stands for. Official: `contest.ratingChanges` `oldRating`s at scale 1; if empty,
   fall back to sampling the standings (below). Gym/ICPC: build from `contest.standings`, collapsing
   each team into one effective rating via `computeTeamRating` (binary search for R where the
   product of per-member loss probabilities is 0.5). Hidden-standings gyms recover the same field
   from who submitted, via `getGymRatingDistFromParties`.
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

`rating-distribution.js` holds the *shape* a fitted field arrives in — the
`RatingDistribution` typedef, `fullField`, `distributionSize` — for the same
reason `team-rating.js` is here: Codeforces' two platforms build their fields
with separate code in folders that deliberately do not import each other, so a
definition either one owned is a definition the other must copy. It was copied,
byte for byte, until this file existed. AtCoder does not import it: its
estimator fits abilities directly and has no strata, because a field that is
always read whole has nothing to scale up from.

`team-rating.js` is the least model-like thing here: it collapses an ICPC team into the single rating a lone competitor would need to be as likely to fail as the team is — `∏ 1/(1 + 10^((rᵢ − R)/400)) = 0.5`, by binary search. It is pure maths over ratings, which is why it sits here, but it also *has* to be in one place: Codeforces' two platforms build their fields with separate code — a gym's from `contest.standings` or from who submitted, an official round's from sampled standings rows — and team collapsing is the one step they genuinely share. Two copies of that search are two things free to disagree about what a team is worth. Note it lands **above** the strongest member, which is the point; `mean` and `max` were both tried and measured worse.

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

### Sampling the field (`codeforces/official/field.js`)

When `contest.ratingChanges` is empty — exactly the freshly-finished contest you most want to upsolve — the participant distribution comes from the standings **rows**, which `fetchContest` already fetched for the roster and passes along in `context`. So the rows are free; what is not free is turning them into ratings, at one throttled `user.info` per 250 handles. A 15,000-entrant Div. 3 is ~60 calls where a sample of ~1,500 is seven. `stratifyRows` takes that sample.

**This used to read ~32 paginated standings pages over the throttled HTML client**, and the strata are unchanged — only the source is. Everything that went with it was a consequence of pagination rather than of sampling: the page-count sanity guard, the partial-last-page measurement, the walk-every-page fallback. A row count is authoritative, so none of them has anything left to guard against. It also removed the last Cloudflare-exposed request on the official path, and a second ~8.5 MB fetch of a response already in memory (`getPublicContestStandings` is not cached; only the problemset is, for 60 s).

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

**`tests/sampling.test.js` measures a *model* of the sample, not the code** — `stratifiedSample`, written in that file — because that is what makes the accuracy claim checkable against a captured field. So it also asserts that `stratifyRows` reproduces that model, including *positionally*: a head that sampled the bottom 500 would match on every count and be the exact mistake this design exists to avoid. Without that, the two could drift and every accuracy test would still pass — which is precisely what was possible while production read HTML and the test sliced an array.

#### Gyms whose standings Codeforces has hidden

A gym can be set to **"Standings will not be visible as original contest"**. When it is, both
halves of the acquisition path die at once: the standings page carries no `table.standings`, and
`contest.standings` answers `FAILED — "contestId: Standings are not available"`. That was terminal
— and worse than a wait, since a gym could not wait at all, so the contest never even
became a waiting entry. It now answers `notEndedYet` while running and `unavailable` when finished
with no visible field. Verified on gym 712373.

**`contest.status` still answers**, and it carries everything the standings response was mined for.
`codeforces/gyms/sources.js` derives it — `GymSources.summariseSubmissions` is pure over the submission array so it tests
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
  problem at 800 (`codeforces/estimator.js`, the floor and zero-solve target) rather than refusing.

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
`tests/problems-page.test.js` keeps the real sidebar markup plus a test asserting that the
*standings* chain still returns "→ About Contest" on it — which is what makes the split legible.
Note the name is read once at add time and never re-read, so a contest added under the wrong name
keeps it until removed and re-added.

Both halves are now confirmed against the live site: `contest.status` against the API, and the
problems-page parser by a real add of 712373, which found all six problems with correct indices and
names. `curl` still gets a 403 from this machine (see below), so the tests remain synthetic apart
from the captured sidebar markup.

### You cannot fetch Codeforces HTML from a dev machine

`codeforces.com/contest/<id>/standings` answers a plain `curl`/`fetch` with a Cloudflare interstitial — HTTP 403, `cf-mitigated: challenge`, and a "Just a moment" body. **Don't burn time on headers**: sending a browser-like `Accept: text/html` was measured and changes nothing, and `Sec-Fetch-*`, `Origin` and `User-Agent` are forbidden for JS to set, so a fetch cannot be made to resemble a navigation. The response demands things a fetch structurally cannot supply — executing the challenge scripts, and the `Critical-CH` client-hint retry, both of which only navigations do. The API (`codeforces.com/api/*`) is unaffected and answers fine.

**This file used to claim the extension "only gets through because it runs inside a browser with a real session." That was wrong**, and measurement showed it: the panel's requests were never authenticated at all. They worked only because Codeforces was not challenging anonymous traffic, and began failing the moment that changed — no code change was involved, and `git log` confirms it, the last commit touching that path predating the last successful add by four days. See **Requests go through a page, not from the panel** for the measurement and what it forced.

The consequence is that the HTML half of the pipeline is verified against synthetic markup (`tests/gym-hidden-standings.test.js`, `tests/problems-page.test.js`) and against real *data* pulled via the API (`tests/fixtures/`), but never against a live standings page. If a selector assumption is wrong, the failure modes are deliberately safe rather than silent: an understated page count either takes the walk-every-page branch or trips the `hasPageLink` guard (slow but correct), a missing contest name falls back to `Contest <id>`, and an unreadable totals row refuses loudly. The residual risk is a slow add, not a wrong rating. Adding a just-finished contest in the real extension is the only way to confirm it.

### Scraped markup is quarantined in `codeforces/gyms/scrapers/`

Every CSS selector and parsing rule for Codeforces' HTML lives in that folder — today one file, `problems-page.js`, for the one page still read — with ordered fallback chains (contest name tries `.contest-name`, then `.caption`, then `<title>`). A CF layout change should be a one-file fix.

**It was called `standings-dom.js` for a long time after the standings scrape was deleted**, holding no standings parsing at all, and nothing caught it because nothing tied a scraper's name to the page it reads. That is the whole argument for naming a `scrapers/` file after its page (see the folder-shape table above): the name is what makes the next such drift visible.

**A scraper returns `null`, never a plausible default.** This is the important invariant. The old code left solve counts at `0` when the totals row went missing and `parseInt(...) || 0` turned an unparseable cell into a zero — so a markup change didn't break anything visibly, it produced *confidently wrong ratings* that were stored and sorted like real ones. Returning `null` forces the caller to decide.

`contest-manager.js` makes that decision as late as possible: it only refuses when unreadable counts actually matter, i.e. when some problem has no published rating to fall back on. A rated official contest doesn't need the totals row at all.

### Tags and published ratings

Both come from **`contest.standings`**, applied by `sources.js#applyStandingsProblemData` (`tag-service.js` now only counts tags for the stats view). Ratings are preferred over estimates — same quantity, measured rather than inferred — and `problem.ratingSource` records `"official"` or `"estimated"`. Because CF publishes ratings days after a round, a contest added right after it ends starts estimated and settles on a later refresh.

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
  requests with no extra parameters"*, and `_callMethod` always appends `apiKey` and `time`.
  A signed request is refused with that exact complaint independently of key validity — so
  `getPublicContestStandings` is a bare GET on purpose. Signing it would break it, which is
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
calling `getGymRatingDist` on an official contest, which signs — so it was refused every
time, leaving the field empty. It now fetches unsigned and hands the payload over.

The tag source differs by contest type:

- **Official** — the same `contest.standings` response the roster comes from, so tags and ratings arrive together and the add pays for one call rather than two. `problemset.problems` is still fetched, but only as the readiness gate (`sources.js#isInProblemset`), where one ~2 MB request memoised for 60 s answers "has Codeforces published this contest at all" for every contest at once.
- **Gym** — absent from the problemset entirely. Tags *and the published rating* are lifted from the `problems` array of the standings response that adding a gym already fetches (`sources.js#applyStandingsProblemData`). Tags are usually empty, since gyms sit outside CF's taxonomy — but **about a third of gym problems carry a `rating`**, and taking it is not optional decoration.

  Those are problems the setter picked from the CF archive rather than preparing in Polygon, so CF still recognises them and serves its own number; problems written for the contest have none and are estimated as before. Measured over the 62 stored gym problems CF also rates, the estimate was a mean **211** off with 14 out by 400+, so ignoring the published value — which this code did until it was noticed — actively mis-sorted the queue. A one-time correction of the affected install was applied through Import rather than left as a normaliser, per the no-back-compat rule at the top of this file.

  **Don't add a recurring gym re-check.** A gym rating is inherited from an already-rated archive problem, so unlike CF's editable tags it never appears later. Re-checking would cost one `contest.standings` per gym per refresh forever, and the gyms with no rated problems would never resolve — the same sweep the CodeChef practice-flag section argues against.

  Note this shrinks `needsEstimate`, so a fully-rated gym skips the estimator entirely.

  **That duplicate `contest.standings` fetch is gone.** `GymSources#contestFromStandings` fetches the response to count gym solves and returns it; `fetchContest` carries it in `context` and `gyms/field.js#readField` measures the field from it rather than fetching again. It is passed, never stored — the built contest is what reaches `chrome.storage`, and a whole gym's field has no business there. Two things worth knowing before assuming it applied more widely: the official field reads `ratingChanges` first and falls back to the same carried response; and the hidden-standings path has no such response to pass, so it still fetches. `codeforces-adapter.test.js` counts the calls, because nothing about a correct rating says how many requests produced it — this could otherwise regress silently forever.

  Worth knowing before trusting the number: a setter *can* keep the rating and replace the statement — CF supports it directly ([Rewrite Statements in Mashups](https://codeforces.com/blog/entry/84795)), to stop trainees googling the editorial. The official test set is unchanged and the form warns when the formulas differ, so the rating still describes the problem being judged; the residual risk is a rewrite that quietly strips a hint. Of the 62, 55 match exactly one archive problem by name with an identical rating and zero disagreements, and a re-*upload* of a rated contest inherits nothing at all (gym 100001 has no ratings and its problem name drifted to "Spreadsheets").

#### The re-check stops after six weeks

`sync/published-data.js` re-asks `contest.standings` for a contest that still has a
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
  quietly stop converging. `tests/platform-sync-isolation.test.js` pins it.
- **There is no per-refresh cap**, unlike AtCoder's `syncMetadata`, and that is a
  decision rather than an omission. A cap interacts badly with the cutoff: with
  several stale contests and an infrequent refresher, a capped rotation gives
  each contest one look every few refreshes, and one that loses that race ages
  past six weeks *before* it ever converged — causing the exact failure the
  re-check exists to prevent. The weekly gate and the six-week window bound the
  work between them, and the steady state is small, since only a round added
  within days of running is stale at all.

The add does **not** run this pass. `contestFromStandings` has already applied every
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

CF tags are editable after publication, so a problem can gain tags days later — about 1.6% of the problemset is untagged at any time. `sync/published-data.js#syncPublishedProblemData` therefore re-checks a contest that still has bare problems, but only once a week, and only until the round is six weeks old; a contest where every problem is tagged and officially rated is never re-requested. It runs from the refresh only — the add has already applied whatever the standings carry — and costs one `contest.standings` (~6.5 MB) per stale contest, which the weekly gate and the cutoff bound between them.

### Start times

`codeforces/sync/start-times.js` — and the gym pass that extends it — fills `contest.startTimeSeconds`, which orders the contest list. Contest IDs are *not* chronological (2205 ran a day before 2200), so sorting by ID is not a substitute.

- **Official** — `contest.list`, one ~400 KB request. A finished contest's start time never changes, so unlike tags there's no re-check: a contest is asked about once and only if the field is missing.
- **Gym** — `contest.list?gym=true`, but private gyms and mashups (the 6xxxxx IDs) don't appear there at all. Those are covered at add time from `standings.contest.startTimeSeconds`, which `sources.js` already has in hand. Anything still unresolved sorts to the bottom rather than being treated as ancient.

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

### Nothing is fetched but the three sites

There is no server, no CDN, no analytics, no telemetry and no runtime font fetch. The only
remote addresses in the built bundle are the platform APIs, which is why `host_permissions`
is composed from the descriptors and diffed against the previous build — that diff is the
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
The page *was* generated from each descriptor's `settingsFields`, which was the
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
`registry.js` and `platforms.js`, because `verify.adapter` has to. The exception
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
