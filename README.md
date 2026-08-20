# Upsolve Tracker

A Chrome extension that turns Codeforces, AtCoder and CodeChef contests into a single
upsolving queue, ordered easiest-first — including the problems that never got a rating.

## Why

Upsolving works best in difficulty order, but a lot of problems have no rating: Codeforces
gym and ICPC contests have none at all, and recent rounds go unrated for a while. Upsolve
Tracker estimates the missing ones instead of skipping them.

That estimate comes from the contest itself. Given everyone who competed and how many of
them solved a problem, there is exactly one rating **R** at which the Elo model predicts
that many solves — so the extension binary-searches for it. A problem solved by 40 people
in a room of 3000 gets the rating that difficulty implies, whether or not Codeforces ever
published one. Team contests collapse each team into the single rating at which it would
lose half the time.

AtCoder and CodeChef both publish their own difficulty ratings promptly, so the estimator
is a Codeforces-only fallback — there, a published rating is simply used as-is.

## One queue across three sites

A rating means different things on different sites: a Codeforces 1600 and an AtCoder 1600
are not the same problem. But all three define difficulty as roughly *the rating at which a
contestant has a 50% chance of solving it*, so putting a problem's difficulty and your
rating **on that same site** through the Elo curve cancels the scale and leaves a plain
probability.

The queue sorts on that, and shows it:

```
01. Nine or Nein                    ~94%  Rating: -817
                                    AC    ABC471 A
02. Parity Sort                     ~81%  Rating: 1300
                                    CF    Contest 1993B
03. Mod Subtract                    ~44%  Rating: 1757
                                    CC    START252D MODSUB
```

Each row keeps its own site's rating — no invented "equivalent" numbers — with the
platform alongside it.

## Install

1. Download `cf-trainer-chrome-vX.Y.zip` from the [Releases page](https://github.com/jain-arham-hsr/cf-trainer/releases) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the extension icon to open the side panel.

## Setup

Each platform needs a different amount, and you only need the ones you use.

| Platform | What it needs |
|---|---|
| **Codeforces** | Handle, plus an API key pair from [codeforces.com/settings/api](https://codeforces.com/settings/api) |
| **AtCoder** | Handle only |
| **CodeChef** | Nothing — just be signed in to codechef.com in this browser |

Open the ⚙ settings from the side panel to fill in what applies. Press **Test connection**
to check the Codeforces pair before relying on it.

Your key and secret are stored in this browser only, are used to sign requests to
codeforces.com, and are sent nowhere else — and they're deliberately excluded from the
JSON backup, so exporting your queue never leaks them.

There's also an optional **AtCoder rating** override. AtCoder suppresses ratings heavily
for your first 10–15 rated contests, so if yours hasn't settled yet, putting your real
strength there stops every AtCoder problem sinking to the bottom of the queue.

## Use

**Add a contest.** Open any supported contest page and a bar appears at the top of the
panel offering to add it. Working out the ratings takes a few seconds — the panel reports
each step. CodeChef Starters are split into divisions; opening the parent contest picks
the division matching your rating.

**Work the queue.** The Queue tab lists every unsolved problem from every tracked contest,
hardest last. Filter to one or more platforms with the chips at the top.

**Stay in sync.** Press ↻ to pull your latest accepted submissions. Solved problems drop
out of the queue, and contests you've fully cleared drop out of the list.

**See the shape of your queue.** The Stats tab opens on an overview — how much of your
queue is comfortable versus brutal — and has a panel per platform showing that site's own
rating spread and tag breakdown, in its own units.

**Prune.** On the Contests tab, hover a row and hold the ✕ for a moment to remove it. A
stray click does nothing.

**Back up.** Export writes a JSON file you can re-import later. Enable auto-export in
settings to have that file kept current automatically.

## Build from source

Requires Node 20.19+ or 22.12+ (Vite 8's requirement).

```bash
npm install
npm run build:chrome   # -> dist/chrome
npm test               # rating maths, platform adapters, queue ordering
```

Then load `dist/chrome` via **Load unpacked** as above. `npm run dev:chrome` runs a dev
server with hot reload.

The tests run offline against real contest data captured in `tests/fixtures/`, and cover
the parts that would fail quietly rather than loudly. The UI itself has no automated
coverage — check that by loading the built extension.

## Limitations

- **Chrome only.** The side panel uses `chrome.sidePanel`, which has no direct Firefox
  equivalent. The shared code in `core/` already avoids Chrome-only APIs.
- **Some Codeforces data is scraped.** Problem names and official solve counts come from
  the standings page, because the API doesn't expose them. AtCoder and CodeChef need no
  scraping.
- **Requests are deliberately slow.** Each platform's requests are spaced out to avoid
  tripping rate limiting. Adding a contest is not instant by design.
- **AtCoder has no tags.** AtCoder publishes none at all, so its problems never appear in
  the tag breakdown. Codeforces gym tags are usually empty for the same reason.
- **AtCoder difficulty lands a few days late.** A round added the evening it ends may show
  some problems as `???`; they fill in on a later refresh.

## Licence

ISC — see [LICENSE](LICENSE).

Not affiliated with Codeforces, AtCoder or CodeChef. Use in accordance with their terms of
service.
