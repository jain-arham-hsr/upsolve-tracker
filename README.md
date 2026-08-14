# CF Trainer

A Chrome extension that turns Codeforces contests into an upsolving queue, ordered easiest-first — including the problems Codeforces never assigned a rating to.

## Why

Upsolving works best in difficulty order, but a lot of problems have no rating: gym and ICPC contests have none at all, and recent rounds go unrated for a while. CF Trainer estimates the missing ones instead of skipping them.

The estimate comes from the contest itself. Given everyone who competed and how many of them solved a problem, there is exactly one rating **R** at which the Elo model predicts that many solves — so the extension binary-searches for it. A problem solved by 40 people in a room of 3000 gets the rating that difficulty implies, whether or not Codeforces ever published one. Team contests collapse each team into the single rating at which it would lose half the time.

## Install

1. Download `cf-trainer-chrome-vX.Y.zip` from the [Releases page](https://github.com/jain-arham-hsr/cf-trainer/releases) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the extension icon to open the side panel.

## Setup

The extension needs read-only access to your Codeforces account to see what you've already solved.

1. Generate a key pair at [codeforces.com/settings/api](https://codeforces.com/settings/api).
2. Open the ⚙ settings from the side panel and enter your handle, key and secret.
3. Press **Test connection** to confirm they work before relying on them.

Your key and secret are stored in this browser only. They are used to sign requests to codeforces.com and are sent nowhere else — and they're deliberately excluded from the JSON backup, so exporting your queue never leaks them.

## Use

**Add a contest.** Open any Codeforces contest or gym page, then press **+ Add Contest** on the Contests tab. Working out the ratings takes a few seconds — the panel reports each step. Contests are only saved once every problem has a rating, so a partial result is never stored.

**Work the queue.** The Queue tab lists every unsolved problem from every tracked contest, sorted by rating, easiest first.

**Stay in sync.** Press ↻ to pull your latest accepted submissions. Solved problems drop out of the queue, and contests you've fully cleared drop out of the list.

**See the shape of your queue.** The Stats tab charts your pending problems by rating, coloured by Codeforces rank band, and ranks the tags you're facing most — filterable to a rating range, so you can ask "what topics are hurting me between 1600 and 1900?"

**Prune.** On the Contests tab, hover a row and hold the ✕ for a moment to remove it. A stray click does nothing.

**Back up.** Export writes a JSON file you can re-import later. Enable auto-export in settings to have that file kept current automatically as your queue changes.

## Build from source

Requires Node 20.19+ or 22.12+ (Vite 8's requirement).

```bash
npm install
npm run build:chrome   # -> dist/chrome
```

Then load `dist/chrome` via **Load unpacked** as above. `npm run dev:chrome` runs a dev server with hot reload.

## Limitations

- **Chrome only.** The side panel uses `chrome.sidePanel`, which has no direct Firefox equivalent; a port would need `sidebar_action` and a Firefox manifest under `targets/`. The shared code in `core/` already avoids Chrome-only APIs.
- **Some data is scraped.** Problem names and official solve counts come from the standings page, because the API doesn't expose them. If Codeforces changes that page's markup, adding contests will break until the scraper is updated.
- **Requests are deliberately slow.** Scraping is spaced out with pauses to avoid tripping Codeforces' rate limiting. Adding a contest is not instant by design.
- **Gym tags are usually empty.** Gym problems sit outside the Codeforces tag taxonomy, so tag stats mostly reflect official contests.

## Licence

ISC — see [LICENSE](LICENSE).

Not affiliated with Codeforces. Use in accordance with their terms of service.
