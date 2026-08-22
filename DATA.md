# Where the data comes from

A map of every number in the panel: which site it came from, what was done to it, and where
it ended up. Written so that when something looks wrong you can check it yourself.

There is **no server**. Everything is fetched from the three sites directly by your browser
and stored on your machine.

---

## The short version

| What you see | Where it comes from |
|:--|:--|
| Problem names and IDs | The contest page or API of the site it belongs to |
| Difficulty (the number beside the mark) | Published by the site — except unrated Codeforces contests, which are **estimated** |
| The `~72%` chance | Calculated locally from that difficulty and your rating on that site |
| Your rating | Fetched from each site when the identity is verified |
| Whether you solved something | Your submission history on that site |
| Topic tags | Codeforces and CodeChef publish them; AtCoder does not |

---

## Codeforces

Two channels are needed, because neither alone is enough.

### The API (`codeforces.com/api/…`)

Signed with your key and secret. Six methods, each for one job:

| Method | Used for |
|:--|:--|
| `user.info` | Verifying your handle, and reading your rating |
| `user.status` | Your accepted submissions — this is what clears problems from the queue |
| `problemset.problems` | Official difficulties and tags, all ~11k problems in one request |
| `contest.list` | When a contest started, so the Contests tab can sort by date |
| `contest.ratingChanges` | Everyone's rating *before* a contest, used to estimate difficulty |
| `contest.standings` | Gym participants and their ratings, plus gym problem tags |

### The standings page (scraped)

`codeforces.com/contest/<id>/standings` is fetched as HTML and parsed. It is the **only**
source for problem names, problem URLs, and how many people solved each problem *during*
the contest. The API's `solvedCount` counts practice solves too, which is no good for
estimating difficulty.

All the HTML parsing lives in **one file**, `core/services/standings-dom.js`. If Codeforces
changes its layout, that's the only place to look.

> **Why it can be slow.** Reading standings costs one request per 50 competitors, so a big
> round would be hundreds of requests. Instead ~32 pages are sampled: the top 10 in full
> (they're what decide the hard problems) plus 20 spread evenly through the rest.

### Estimated difficulty

Codeforces doesn't rate gym contests at all, and rates new rounds a few days late. For those,
difficulty is **calculated, not fetched**: given everyone who competed and how many solved a
problem, there's exactly one rating at which the Elo model predicts that many solves, and the
code searches for it.

Each problem records which it was — `ratingSource: "official"` or `"estimated"` — and an
estimate is replaced by the real number as soon as Codeforces publishes one.

> **Known bias:** estimates come out low, by up to ~300 on the hardest problems. The model
> assumes everyone attempted every problem, when most never open the hard ones. Documented in
> `tests/estimator-accuracy.test.js`.

---

## AtCoder

No scraping and no estimating — difficulty is published.

| Source | Used for |
|:--|:--|
| `kenkoooo.com/atcoder/resources/problems.json` | Problem names and IDs |
| `…/contests.json` | Contest names and start times |
| `…/contest-problem.json` | Which problems belong to which contest |
| `…/problem-models.json` | Difficulty |
| `…/atcoder-api/v3/user/submissions` | Your submissions, so solved problems clear |
| `atcoder.jp/users/<handle>` | Verifying your handle and reading your rating |

Only the last one touches AtCoder itself. Everything else comes from **AtCoder Problems**
(kenkoooo), a well-known third-party project. It requires no login, which is why AtCoder needs
only a handle.

Two things that surprise people:

- **`contest-problem.json` is not redundant.** 1,906 of 9,383 problems run in more than one
  contest, and `problems.json` only records the first. Without it, a rerun shows 4 problems
  instead of 9.
- **Difficulty can be negative.** 931 problems are below zero — ABC 471's A is −817. That's
  real, not a bug.

---

## CodeChef

CodeChef's public API was retired, so the extension uses the same `/api/` endpoints the site's
own front end calls, and only ever for things you're already tracking.

| Endpoint | Used for |
|:--|:--|
| `/api/contests/<code>` | Contest name, its problem list, divisions |
| `/api/contests/<code>/problems/<code>` | Difficulty and tags — one request per problem |
| `/api/list/problems?group=attempted` | **Every problem you've attempted**, which is how solves clear |
| `/dashboard` | Reading which account is signed in |

### Why solved status works differently here

A CodeChef contest stops accepting submissions when it ends, so upsolving happens in
**practice mode** — and the contest's own stats never see it. Reading those stats meant a
CodeChef problem solved after its contest stayed in the queue forever.

So solved status is read from your *attempted problems* list instead, keeping the ones
CodeChef marks Accepted (`status: 1`). Partially-correct answers (`status: 2`) don't count —
scoring some subtasks isn't finishing the problem.

That list is only ever fetched scoped to your own account, and there's a hard cap on how much
of it will be paged. If CodeChef ever stops applying the filter, the sync refuses rather than
walking the whole 21,000-problem catalogue.

### Divisions

`/START252` is a parent contest with no problems of its own. Your rating picks the division
you competed in, so it's stored as e.g. `START252D`. The same problem often runs in all four
divisions, so solving it in one clears it everywhere.

---

## Whose data is it?

**Every site needs a handle, and nothing user-specific is read before that handle is
verified.** Otherwise a contest would be stored unmarked and never clear, looking like a slow
sync rather than a misconfiguration.

The check differs by site, and the difference matters:

- **CodeChef answers for whoever is signed in**, so the signed-in account is compared against
  your configured handle. A mismatch stops the sync — otherwise someone else's solves would be
  written onto your queue, permanently.
- **Codeforces and AtCoder are asked *about* a handle**, so who's signed in to those sites is
  irrelevant. What's verified is that the handle **exists** — not that it's yours. Type
  someone else's and you'll sync their solves. Neither site offers a way to check.

If a handle changes, that site's solved flags are cleared so the next sync re-derives them
against the new account.

---

## What's stored, and where

**`chrome.storage.local`** — this is what Export dumps:

| Key | Contents |
|:--|:--|
| `trackedContests` | Your entire queue: every contest, its problems, difficulties, tags, solved flags |
| `upsolve_tracker.handle` / `.atcoder_handle` / `.codechef_handle` | Your handles |
| `upsolve_tracker.platform_ratings` | Your rating on each site |
| `upsolve_tracker.platform_identity` | Which account each site's solved flags belong to |
| `upsolve_tracker.auto_export` | Whether the backup file is kept current |
| `upsolve_tracker.platform_filter`, `.stats_scope`, `.expanded_contests`, `.tag_rating_range.*` | UI state that should survive switching tabs |

**IndexedDB** (`upsolve_tracker_db`) — deliberately separate, because it must **not** appear
in an exported backup:

- your Codeforces API key and secret
- the folder handle for auto-export (this one can't be recreated from a backup — if it's
  lost, just pick the folder again)

---

## If something looks wrong

| Symptom | What to check |
|:--|:--|
| A solved problem won't leave the queue | Is the handle for that site right? Settings shows the account it resolved to. On CodeChef, are you signed in as that account? |
| Nothing syncs at all for one site | The refresh reports per-site failures at the end. A site being down or a handle being wrong fails that site alone; the others still sync. |
| A rating shows `???` | The site hasn't published a difficulty yet. It fills in on a later refresh. AtCoder rates rounds a few days late. |
| A Codeforces difficulty looks too low | It's probably an estimate — new rounds and all gyms are estimated until Codeforces publishes a rating. Estimates run low on hard problems. |
| The chance column shows `—` | Either the problem has no difficulty, or your rating for that site is unknown. Those are different problems and the queue shows them differently on purpose. |
| Adding a contest is slow | Expected. Requests are spaced deliberately; a CodeChef division costs about one request per problem. |
| CodeChef says "refused the request" | Open codechef.com in a tab and make sure you're signed in. |
| The backup file has stopped updating | The export folder handle lives in IndexedDB and can be lost. Re-pick the folder in Settings. |

The refresh reports failures **last**, after writing the backup, so a message about a failed
sync can't be overwritten by the backup notice.

---

## For the curious

`CLAUDE.md` in this repo is the engineering-side document: why things are built the way they
are, which approaches were tried and rejected, and which invariants must not be broken. It's
considerably more detailed than this file, and considerably more opinionated.
