# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev:chrome      # Vite dev server (port 5173, strictPort) + CRXJS HMR
npm run build:chrome    # -> dist/chrome
```

There is no test suite, linter, or formatter configured. Verification is manual: build, then load `dist/chrome` unpacked at `chrome://extensions` (Developer mode → Load unpacked).

`dev:firefox` / `build:firefox` exist in package.json but `targets/firefox/manifest.json` does not, so they currently fail at config load. Adding that manifest is all that's needed — the build is target-parameterized.

Pushing to `main` triggers `.github/workflows/release.yaml`: it builds Chrome, reads the version from `targets/chrome/manifest.json`, **deletes any existing release/tag with that version**, and republishes. Bump the manifest version when you want a distinct release; leaving it unchanged silently replaces the previous one.

## Build model

`vite.config.js` reads `targets/$TARGET/manifest.json` and hands it to `@crxjs/vite-plugin`, outputting to `dist/$TARGET`. Consequences:

- The manifest is the entry-point graph. HTML entries (`side_panel.default_path`, `options_ui.page`) and the service worker point at **source** paths (`core/ui/index.html`, `targets/chrome/background.js`); CRXJS crawls and rewrites them. A new page must be registered in the manifest to be built.
- `@core` aliases to `core/`, though most existing imports use relative paths.
- `core/` is target-agnostic business logic; `targets/<browser>/` holds only the manifest and background worker. Keep browser-specific glue in `targets/`.
- `linkedom` is a declared dependency but unused — parsing uses the browser's `DOMParser`.

## Architecture

Vanilla ES modules and custom elements — no framework, no bundled UI library.

### Data acquisition: two channels, both required

1. **Signed API** (`core/services/codeforces-service.js`) — builds the `apiSig` (SHA-512 over `rand/method?sortedParams#secret`) via `crypto.subtle`. Used for `user.status`, `contest.ratingChanges`, `contest.standings`, `user.info`.
2. **HTML scraping** (`core/services/scraping-service.js` → `core/services/http-client.js`) — the standings page is the only source for problem names/URLs and official solve counts.

`HttpClient.get` deliberately throttles: 1–2.5 s jitter before *every* request and a 6–12 s cooldown every 15 requests, with `credentials: "include"` so the user's Codeforces session cookie is sent, plus 403 / "Just a moment" detection that surfaces a "visit codeforces.com" error. Scraping paginates full standings, so these delays are what keeps the extension from being blocked — do not remove or shorten them when optimizing.

### Rating estimation pipeline

`core/contest-manager.js#processNewContest(url)` is the orchestrator. Given a `/contest/<id>` or `/gym/<id>` URL:

1. `get-prob-stats.js` — scrape problems from the standings header row. Official contests read solve counts from the "Accepted" totals row; gyms instead count `bestSubmissionTimeSeconds` in `contest.standings`, excluding ghost parties.
2. `get-rating-distribution.js` — produce the participant rating vector. Official: `contest.ratingChanges` `oldRating`s; if empty, fall back to scraping every handle from paginated standings and batching `user.info` in chunks of 250 (2 s apart), defaulting unrated users to 800. Gym/ICPC: build from `contest.standings`, collapsing each team into one effective rating via `computeTeamRating` (binary search for R where the product of per-member loss probabilities is 0.5).
3. `rating-estimator.js` — binary-search the rating R whose Elo-expected solve count over that participant vector matches actual solves; round to the nearest 100, floor 800. Zero solves targets 0.5 expected solves rather than 0.
4. Mark already-solved problems from `user.status`, then **store only if every problem got a rating** — a partial result throws instead of persisting. There is intentionally no default-1500 fallback (see the comments in `contest-manager.js`); reintroducing one would silently corrupt the queue's sort order.

`progress-manager.js#updateSolvedStatus()` re-syncs on demand: re-fetches accepted submissions, flips `prob.solved`, drops fully-solved contests from storage, and returns the removed ones so the UI can announce them.

### Storage split — this is deliberate

- **`chrome.storage.local`** (`services/storage.js`, `LocalDB`) — `trackedContests` array, plus settings under dotted keys `cf_trainer.handle` and `cf_trainer.auto_export`. This is what the Export/Import JSON backup dumps wholesale.
- **IndexedDB** (`services/secure-store.js`) — API key/secret and the `FileSystemDirectoryHandle`. Credentials live here specifically so they never land in an exported backup; the directory handle lives here because handles aren't serializable into `chrome.storage`.

Caveat: `LocalDB.getHandle`/`setHandle` read a `cfHandle` key that nothing else uses — every real call site reads `cf_trainer.handle` directly. Use the dotted key; treat those two methods as stale.

### UI shell

`core/ui/index.js` defines `<cf-app>`, which clones the `#tpl-app` template from `index.html` and hand-rolls a router that swaps `<cf-queue-view>` and `<cf-contest-list>` in `#router-outlet`. Views import their markup with Vite `?raw` imports and set `innerHTML`. The shell calls `refreshData(removedContests)` on the current view after a global refresh — a view that needs post-sync updates must expose that method.

`queue-view` flattens all unsolved problems across contests and sorts ascending by rating (null → 9999). `contest-list` watches `chrome.tabs` events to enable "+ Add Contest" only on a Codeforces contest/gym page.

**Auto-export gotcha:** `contest-list.js` calls `verifyExportPermission()` *before* the slow `processNewContest` await, because a `FileSystemDirectoryHandle` re-permission prompt only succeeds while the user gesture is still fresh. Moving that call after the fetch breaks auto-export after every browser restart.
