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

**2. Sign in with Google**

The panel and Settings both ask you to sign in before anything else. Your queue is kept in your Google
account, so it survives clearing Chrome's data and follows you to another computer — sign in
there and it appears. Signing in is also how problems get their difficulties: ratings come
from a shared catalog, kept up to date by the extension's maintainer.

**3. Tell it who you are on each site**

Open **⚙ Settings** from the panel. You only need the sites you actually use, but a site
needs its handle before you can add any of its contests.

| Site | What it needs |
|:--|:--|
| **Codeforces** | Your handle |
| **AtCoder** | Your handle |
| **CodeChef** | Your handle, and be signed in to codechef.com in this browser |

Each section confirms the account it found — *“✓ Connected as tourist”*, or *“✓ Signed in as
tourist”* on CodeChef, where the browser session really is the identity rather than something
looked up — so a typo shows up straight away. The extension's maintainer also sets a Codeforces key and secret; they stay in that browser, are only used to sign
requests to codeforces.com, and are deliberately kept out of both the backup file and the cloud.
A second computer needs the key pair entered again.

## Using it

**Add a contest.** Open any contest page on a supported site and a bar appears at the top of
the panel offering to add it. Working out the difficulties takes a few seconds and the panel
narrates each step. CodeChef Starters split into divisions — open the parent contest and it
picks the division matching your rating.

**If a contest isn't ready yet, it waits.** Add one that's still running, or a round whose
site hasn't published its problems and difficulties, and rather than making you come back
and try again it's parked in a **Waiting** strip at the top of the Contests tab and retried
on every refresh. It joins the queue by itself once the data lands, and the row tells you
what it's waiting on. A CodeChef contest added the day it ends usually waits briefly for its
difficulties this way.

Codeforces rounds wait for the site's own ratings rather than being added straight away with
estimated ones, so a round you add minutes after it ends will sit there briefly. That's
deliberate: an estimate on a fresh round runs about 100 points off, and waiting costs you
nothing but a little patience.

If something is clearly never going to resolve, drop it from the same **⋮** menu you'd use
to remove a contest — worth doing for a Codeforces round, where each retry costs a burst of
requests.

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

**Keep a backup.** Signed in, every change is saved to the cloud as you make it. You can
also Export a JSON file from the Contests tab at any time, and Import it later.

## Things worth knowing

- **`…` instead of a rating** means the shared catalog hasn't rated that problem yet. The
  contest is tracked and its solved problems still clear; it just sorts below the rated
  ones until a rating arrives, which happens on a later refresh by itself.
- **Chrome only.** The side panel uses an API Firefox doesn't have an equivalent for.
- **It's deliberately unhurried.** Requests are spaced out so the sites don't rate-limit you.
  Adding a contest is not instant, and that's on purpose.
- **`???` instead of a rating** means the site has published the contest but says that
  particular problem has no difficulty — not that something failed. It's rare, and only
  CodeChef produces one. A missing difficulty is given a week from when the contest ran
  before it's read that way, since CodeChef usually rates within a day or two; until then
  the contest waits. A contest the extension simply hasn't been able to read yet waits too,
  and says so.
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
- **Codeforces group contests work, with a codeforces.com tab open.** Codeforces doesn't let
  the extension ask about them directly, so it reads the contest's pages as you, which needs
  you signed in on a tab. Without one the contest waits and is tried again on the next
  refresh. Every difficulty is an estimate, from the group members who took part.

## Where your data comes from

Your queue is read from the three sites by your own browser, and kept on your machine, with
a copy in your own part of the extension's Google Firebase database, which only your account
can read. If you want to know exactly which site each
number came from, or something looks wrong and you'd like to check it yourself, see
**[DATA.md](DATA.md)**.

## Building it yourself

Requires Node 20.19+ or 22.12+.

```bash
npm install
npm run build:chrome    # -> dist/chrome
npm test                # rating maths, platforms, request pacing, queue ordering
npm run smoke           # loads the built panel and settings page in headless Chrome
```

Then load `dist/chrome` with **Load unpacked** as above.

`.env` holds the Firebase project and OAuth client the build signs in with, and
[firestore.rules](firestore.rules) is what goes in that project's Firestore rules. Left
empty, the build works without sign-in and works out every difficulty itself — for
development only; the release workflow refuses to publish such a build.

## Licence

**Not open source.** Copyright © 2026 Arham Jain, all rights reserved.

If you've been given access to this repository you may use and modify it for your own
personal, non-commercial use. Redistribution and commercial use need permission. See
[LICENSE](LICENSE).

Not affiliated with Codeforces, AtCoder or CodeChef. Use in line with their terms of service.
