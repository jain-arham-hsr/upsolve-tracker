<div align="center">

<img src="public/icons/icon-192.png" width="96" alt="Upsolve Tracker">

# Upsolve Tracker

**One practice queue across Codeforces, AtCoder and CodeChef — sorted by how likely you are to solve each problem.**

</div>

---

The problems you *didn't* solve in a contest are the ones worth going back to. Upsolve
Tracker keeps them in one list, ordered easiest-first, and quietly removes each one as soon
as you solve it.

<div align="center">

```
01.  Duck Surplus
                                      ~78%   ▣ 1000
                                       Official 2237C

02.  Modify and Subtract
                                      ~29%   ▣ 1757
                                     START252 MODSUB

03.  Nine or Nein
                                      ~99%   ▣ -817
                                         ABC471 a
```

</div>

## Why the percentages

A 1600 on Codeforces and a 1600 on AtCoder are not the same problem — different sites,
different crowds, different scales. So the queue doesn't sort on ratings. It sorts on **how
likely you are to solve it**, worked out from that problem's difficulty and *your* rating on
*that* site. Those two cancel the scale out, which makes a Codeforces problem and a CodeChef
problem genuinely comparable.

Each row still shows the site's own rating, with its mark beside it — never a converted
number.

## Getting started

**1. Install**

Download `upsolve-tracker-chrome-vX.Y.zip` from the
[Releases page](https://github.com/jain-arham-hsr/upsolve-tracker/releases) and unzip it.
Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the
unzipped folder. Click the extension icon to open the side panel.

**2. Tell it who you are**

Open **⚙ Settings** from the panel. You only need the sites you actually use, but a site
needs its handle before you can add any of its contests.

| Site | What it needs |
|:--|:--|
| **Codeforces** | Your handle, plus an API key pair from [codeforces.com/settings/api](https://codeforces.com/settings/api) |
| **AtCoder** | Your handle |
| **CodeChef** | Your handle, and be signed in to codechef.com in this browser |

Each section confirms the account it found — *“✓ Connected as tourist”* — so a typo shows up
straight away. Your Codeforces key and secret stay in this browser, are only used to sign
requests to codeforces.com, and are deliberately kept out of the backup file.

## Using it

**Add a contest.** Open any contest page on a supported site and a bar appears at the top of
the panel offering to add it. Working out the difficulties takes a few seconds and the panel
narrates each step. CodeChef Starters split into divisions — open the parent contest and it
picks the division matching your rating.

**Work the queue.** The **Queue** tab lists every unsolved problem you're tracking, easiest
first. The dropdown at the top right filters to one or more sites.

**Stay in sync.** Press **↻** to pull in what you've solved. Solved problems drop out of the
queue, and a contest disappears once you've finished all of it. Practice-mode solves count
too, so upsolving a CodeChef problem after its contest has ended works normally.

**See your contests.** The **Contests** tab lists everything you're tracking. Click a row to
expand it and see what that contest still owes the queue. The **⋮** menu opens the contest
on its site, or removes it.

**Check the shape of your backlog.** The **Stats** tab opens on an overview — where your
problems are and how hard they are — and you can click into any site for its own rating
spread and topic breakdown.

**Keep a backup.** Export writes a JSON file you can re-import later. Turn on auto-export in
Settings and it stays current by itself.

## Things worth knowing

- **Chrome only.** The side panel uses an API Firefox doesn't have an equivalent for.
- **It's deliberately unhurried.** Requests are spaced out so the sites don't rate-limit you.
  Adding a contest is not instant, and that's on purpose.
- **`???` instead of a rating** means the site hasn't published a difficulty yet. It fills in
  on a later refresh. AtCoder in particular rates a round a few days after it runs.
- **No topic tags on AtCoder.** It doesn't publish any. Codeforces gym problems usually have
  none either.
- **A dotted underline under a difficulty means it's an estimate**, not a number the site
  published — worked out from how many people solved that problem. Hover it for the reason.
  It's replaced by the real number as soon as Codeforces publishes one.
- **Take gym estimates with a pinch of salt.** The estimate is only as good as the crowd it
  has to learn from, and a gym might have a dozen people in it where a real round has
  thousands. Expect a couple of hundred points either way. Roughly a third of gym problems
  aren't estimated at all — those are ones the setter took from the Codeforces archive, so
  Codeforces already knows their difficulty and the real number is used.
- **Gyms with hidden standings work too.** Some setters turn standings off; the extension
  reads what it needs from the submissions instead.

## Where your data comes from

Everything stays on your machine — there's no server. If you want to know exactly which
site each number came from, or something looks wrong and you'd like to check it yourself,
see **[DATA.md](DATA.md)**.

## Building it yourself

Requires Node 20.19+ or 22.12+.

```bash
npm install
npm run build:chrome    # -> dist/chrome
npm test                # rating maths, adapters, queue ordering
npm run smoke           # loads the built panel in headless Chrome
```

Then load `dist/chrome` with **Load unpacked** as above.

## Licence

**Not open source.** Copyright © 2026 Arham Jain, all rights reserved.

If you've been given access to this repository you may use and modify it for your own
personal, non-commercial use. Redistribution and commercial use need permission. See
[LICENSE](LICENSE).

Not affiliated with Codeforces, AtCoder or CodeChef. Use in line with their terms of service.
