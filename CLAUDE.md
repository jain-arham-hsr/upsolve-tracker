# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev:chrome      # Vite dev server (port 5173, strictPort) + CRXJS HMR
npm run build:chrome    # -> dist/chrome
```

```bash
npm test                # node --test over tests/ — no framework, no browser
```

`npm test` covers the parts that fail *silently*: the estimator's maths, the standings parsing, backup validation and queue ordering. UI wiring has no coverage — verify that manually by building and loading `dist/chrome` unpacked at `chrome://extensions` (Developer mode → Load unpacked). There is no linter or formatter configured.

`tests/sampling.test.js` deliberately asserts that uniformly random page sampling is *worse* than the stratified design, so the rejected approach can't quietly come back.

The build is still target-parameterized (`TARGET` selects `targets/<name>/manifest.json` and `dist/<name>`), but only `chrome` exists — the previous `dev:firefox` / `build:firefox` scripts were removed because they failed at config load. A real Firefox target needs more than a manifest: `targets/chrome/` depends on `chrome.sidePanel`, which Firefox answers with `sidebar_action`, and CRXJS emits a Chrome-style service-worker loader. Everything under `core/` already sticks to APIs both browsers implement.

Pushing to `main` triggers `.github/workflows/release.yaml`: it builds Chrome, reads the version from `targets/chrome/manifest.json`, **deletes any existing release/tag with that version**, and republishes. Bump the manifest version when you want a distinct release; leaving it unchanged silently replaces the previous one.

## Build model

`vite.config.js` reads `targets/$TARGET/manifest.json` and hands it to `@crxjs/vite-plugin`, outputting to `dist/$TARGET`. Consequences:

- The manifest is the entry-point graph. HTML entries (`side_panel.default_path`, `options_ui.page`) and the service worker point at **source** paths (`core/ui/index.html`, `targets/chrome/background.js`); CRXJS crawls and rewrites them. A new page must be registered in the manifest to be built.
- `@core` aliases to `core/`, though most existing imports use relative paths.
- `core/` is target-agnostic business logic; `targets/<browser>/` holds only the manifest and background worker. Keep browser-specific glue in `targets/`.
- `linkedom` is a devDependency used only by `tests/standings-dom.test.js` to parse HTML in Node; shipped code uses the browser's `DOMParser`.

## Architecture

Vanilla ES modules and custom elements — no framework, no bundled UI library.

### Data acquisition: two channels, both required

1. **Signed API** (`core/services/codeforces-service.js`) — builds the `apiSig` (SHA-512 over `rand/method?sortedParams#secret`) via `crypto.subtle`. Used for `user.status`, `contest.ratingChanges`, `contest.standings`, `user.info`.
2. **HTML scraping** (`core/services/scraping-service.js` → `core/services/http-client.js`) — the standings page is the only source for problem names/URLs and official solve counts.

`HttpClient.get` deliberately throttles: 1–2.5 s jitter before *every* request and a 6–12 s cooldown every 15 requests, with `credentials: "include"` so the user's Codeforces session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error. Scraping paginates full standings, so these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing.

### Rating estimation pipeline

`core/contest-manager.js#processNewContest(url)` is the orchestrator. Given a `/contest/<id>` or `/gym/<id>` URL:

1. `get-prob-stats.js` — scrape problems from the standings header row. Official contests read solve counts from the "Accepted" totals row; gyms instead count `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties.
2. `get-rating-distribution.js` — produce the participant rating distribution, as **strata**: `{ strata: [{ ratings, scale }] }`, where `scale` is how many real competitors one read competitor stands for. Official: `contest.ratingChanges` `oldRating`s at scale 1; if empty, fall back to sampling the standings (below). Gym/ICPC: build from `contest.standings`, collapsing each team into one effective rating via `computeTeamRating` (binary search for R where the product of per-member loss probabilities is 0.5).
3. `rating-estimator.js` — binary-search the rating R whose Elo-expected solve count over that participant vector matches actual solves; round to the nearest 100, floor 800. Zero solves targets 0.5 expected solves rather than 0.
4. Mark already-solved problems from `user.status`, then **store only if every problem got a rating** — a partial result throws instead of persisting. There is intentionally no default-1500 fallback (see the comments in `contest-manager.js`); reintroducing one would silently corrupt the queue's sort order.

### Sampling the field (`scraping-service.js`)

When `contest.ratingChanges` is empty — which is exactly the freshly-finished contest you most want to upsolve — the participant distribution has to come from the standings pages. Reading all of them costs one throttled request per 50 competitors, so a big round ran to hundreds of requests. `sampleParticipantHandles` reads ~32 instead, regardless of turnout.

**Do not "simplify" this to a uniform random sample of pages.** It was tried and measured: standings are rank-ordered, so a page is a narrow band of near-identical ratings rather than a random slice. Sampling pages at random is cluster sampling with near-total intra-cluster correlation — 20 pages of 50 behaves like 20 draws, not 1000 — and estimates land 400–800 points off. Spreading pages evenly fixes the variance but biases estimates *downward*, because a random start offset can skip the very top of the field, and hard problems are decided almost entirely by the strongest few competitors.

What works, and what's implemented, is two strata:

- **Head** — `HEAD_PAGES` (10) read in full at scale 1. Small, but it's what rates the hard problems.
- **Tail** — `TAIL_PAGES` (20) at even intervals over the remainder, scaled by the competitors each represents.

Verified against full-field estimates on simulated fields of 3k–45k: 30 of 33 cases reproduce the rating exactly, the rest are one 100-point bucket off. Contests of 30 pages or fewer are still read whole, since sampling would cost the same. The last page is confirmed to actually be last before its number is used to size the field — a wrong count would undercount the field and skew every rating.

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

CF tags are editable after publication, so a problem can gain tags days later — about 1.6% of the problemset is untagged at any time. `syncOfficialTags` therefore re-checks a contest that still has bare problems, but only once a week; contests where every problem is tagged are never re-requested. It runs at add time and from the refresh, and costs at most one request per sync regardless of how many contests are stale.

### Start times

`start-time-service.js` fills `contest.startTimeSeconds`, which orders the contest list. Contest IDs are *not* chronological (2205 ran a day before 2200), so sorting by ID is not a substitute.

- **Official** — `contest.list`, one ~400 KB request. A finished contest's start time never changes, so unlike tags there's no re-check: a contest is asked about once and only if the field is missing.
- **Gym** — `contest.list?gym=true`, but private gyms and mashups (the 6xxxxx IDs) don't appear there at all. Those are covered at add time from `standings.contest.startTimeSeconds`, which `get-prob-stats.js` already has in hand. Anything still unresolved sorts to the bottom rather than being treated as ancient.

`progress-manager.js#updateSolvedStatus()` re-syncs on demand: re-fetches accepted submissions, flips `prob.solved`, drops fully-solved contests from storage, and returns the removed ones so the UI can announce them.

### Storage split — this is deliberate

- **`chrome.storage.local`** (`services/storage.js`, `LocalDB`) — `trackedContests` array, plus settings under dotted keys `cf_trainer.handle` and `cf_trainer.auto_export`. This is what the Export/Import JSON backup dumps wholesale.
- **IndexedDB** (`services/secure-store.js`) — API key/secret and the `FileSystemDirectoryHandle`. Credentials live here specifically so they never land in an exported backup; the directory handle lives here because handles aren't serializable into `chrome.storage`.

Caveat: `LocalDB.getHandle`/`setHandle` read a `cfHandle` key that nothing else uses — every real call site reads `cf_trainer.handle` directly. Use the dotted key; treat those two methods as stale.

### UI shell

`core/ui/index.js` defines `<cf-app>`, which clones the `#tpl-app` template from `index.html` and hand-rolls a router that swaps `<cf-queue-view>` and `<cf-contest-list>` in `#router-outlet`. Views import their markup with Vite `?raw` imports and set `innerHTML`. The shell calls `refreshData(removedContests)` on the current view after a global refresh — a view that needs post-sync updates must expose that method.

`queue-view` flattens all unsolved problems across contests and sorts ascending by rating (null → 9999). `contest-list` watches `chrome.tabs` events to enable "+ Add Contest" only on a Codeforces contest/gym page.

**Auto-export gotchas** (`services/auto-export.js`, used by both the add-contest handler and the global refresh):

- `verifyExportPermission()` must be called *before* the slow await in a click handler, because a `FileSystemDirectoryHandle` re-permission prompt only succeeds while the user gesture is still fresh. Moving it after the network work breaks auto-export after every browser restart.
- Any path that mutates `chrome.storage.local` must call `writeBackup()` afterwards. The refresh writes solved status and tags straight to storage, so without that call the on-disk JSON silently drifts from what the UI shows — which is exactly how tags ended up visible in the extension but missing from the backup.
