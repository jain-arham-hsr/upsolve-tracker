# Where the data comes from

A map of every number in the panel: which site it came from, what was done to it, and where
it ended up. Written so that when something looks wrong you can check it yourself.

There is **no server**. Everything is fetched from the three sites directly by your browser
and stored on your machine.

**Nothing else is fetched at all.** No CDNs, no analytics, no web fonts pulled at runtime.
The two typefaces (Inter and JetBrains Mono) ship inside the extension, every platform mark
is inline SVG, and the only remote addresses in the build are the data APIs listed below.

---

## The short version

| What you see | Where it comes from |
|:--|:--|
| Problem names and IDs | The contest page or API of the site it belongs to |
| Difficulty (the number beside the mark) | Published by the site, except where Codeforces hasn't rated it — those are **estimated** and shown with a dotted underline |
| The `~72%` chance | Calculated locally from that difficulty and your rating on that site |
| Your rating | Fetched from each site when the identity is verified |
| Whether you solved something | Your submission history on that site |
| Topic tags | Codeforces and CodeChef publish them; AtCoder does not |

---

## How a contest gets into your queue

```mermaid
flowchart TD
    A["You open a contest page<br/>and press Add"] --> B{"Is the URL one of<br/>the three sites?"}
    B -->|"no"| Bx["Nothing happens"]
    B -->|"yes"| C["Check the handle in Settings<br/>is a real account"]

    C -->|"no handle, or wrong one"| Cx["Stops here and says so"]
    C -->|"ok"| D["Ask the site for the contest"]

    D --> E{"Did the site answer?"}
    E -->|"not finished, or<br/>not published yet"| W["Waits, and retries<br/>on every refresh"]
    E -->|"will never be available"| Ex["Refuses, and says why"]
    E -->|"yes"| F["Build the contest record"]

    F --> G{"Any problem the site<br/>hasn't rated?"}
    G -->|"no"| J["Mark what you've already solved"]
    G -->|"yes"| H["Estimate it from<br/>how the field did"]
    H --> J

    J --> K{"Everything already solved?"}
    K -->|"yes"| Kx["Not stored — nothing to upsolve"]
    K -->|"no"| L["Saved on your machine,<br/>and written to the backup file"]

    W -.->|"next refresh"| D

    %% Grey = the run ended here and nothing was stored. The labels already say
    %% so; the shading just makes the path that *does* store readable at a glance.
    classDef stop fill:#f0f0f0,stroke:#9e9e9e,color:#333
    classDef kept fill:#e8f4ea,stroke:#5b8c62,color:#1f3b25
    class Bx,Cx,Ex,Kx stop
    class L kept
```

Nothing above leaves your machine except the requests to the three sites themselves.

---

## How a request actually reaches a site

This one matters because it explains a failure you may hit.

```mermaid
flowchart LR
    P["The extension<br/>wants a page"] --> Q{"Is a tab open<br/>on that site?"}
    Q -->|"yes"| R["Ask that tab to fetch it"]
    Q -->|"no"| S["Fetch it directly"]

    R --> T["Signed in as you —<br/>works for anything"]
    S --> U["Anonymous —<br/>public pages only"]

    T --> V{"Did the site refuse?"}
    U --> V
    V -->|"blocked, or signed out"| Vx["Says so, and retries later.<br/>Never reports it as 'nothing found'"]
    V -->|"no"| Vy["Used"]

    classDef stop fill:#f0f0f0,stroke:#9e9e9e,color:#333
    classDef kept fill:#e8f4ea,stroke:#5b8c62,color:#1f3b25
    class Vx stop
    class Vy kept
```

**Why the tab matters.** A request made by the extension on its own is treated by the browser
as coming from a *different site*, so your cookies are not attached and the site sees a
stranger. A request made from inside a tab you already have open is treated as coming from
you, cookies and all. So anything needing a login — a private Codeforces gym, your AtCoder
submissions — works when that site is open in a tab, and falls back to public-only access when
it is not.

---

## Every source, at a glance

Where each kind of data actually comes from, and what happens when that source fails.
The per-platform sections below explain *why*; this is the *where*.

| | Problems | Difficulty | Submissions |
|:--|:--|:--|:--|
| **Codeforces Official**<br>`/contest/<id>` | `contest.standings` — no HTML at all<br><br>Not `problemset.problems`: that files a problem under the contest it *originated* in, so a Div. 2 round sharing problems with a Div. 1 one lists only its own — 2 of 7 for Round 1079. Filtering it by contest id would store a short contest | `contest.standings`, and nothing else<br><br>It is the only source that reports a *shared* problem's rating under this contest's own index; without it Round 1079's D stored as 1500 against a published 1600. Not `problemset.problems`, which files those under the Div. 1 twin — for ~a third of Div. 2 rounds it can supply only two problems<br><br>*Added before Codeforces rated the round:* stored as estimates, then re-asked from the same endpoint at most weekly — and **not at all once the round is six weeks old**, since nothing more is coming and the check would otherwise run forever<br><br>*Genuinely unrated:* estimated here — solve counts, and the field, from the same standings rows. The field prefers `contest.ratingChanges`; when that is empty it samples ~1,500 of the rows already in hand and resolves them through `user.info`. **No HTML on this path at all** | `user.status` — one call, whole history |
| **Codeforces Gyms**<br>`/gym/<id>` | Scraped from `/gym/<id>/standings`<br><br>*Standings hidden:* scraped from the `/gym/<id>` page instead — a problem nobody attempted appears in no submission, so it cannot be recovered from those | `contest.standings` — about a third of gym problems carry Codeforces' own rating<br><br>*The rest:* estimated here. Solve counts **and** field both from `contest.standings`; for a hidden gym, from `contest.status` + `user.info` instead. Never sampled — a gym's whole field arrives in one response<br><br>*Field not visible at all:* refuses to add, since it never becomes visible later | `user.status` — the same call as official |
| **AtCoder** | Scraped from `/contests/<id>/tasks`<br><br>*Unreadable:* waits and retries every refresh — a contest that hasn't finished doesn't list them | **Always estimated here.** AtCoder publishes no difficulty at all. Fitted from `/contests/<id>/standings/json` 🔒<br><br>*Unreadable:* stores `???` and retries one contest per refresh | Scraped from `/contests/<id>/submissions?f.User=…&f.Status=AC` 🔒<br><br>Once per tracked contest — AtCoder publishes no per-user list |
| **CodeChef** | `/api/contests/<code>`, then `/api/contests/<code>/problems/<code>` — one request per problem<br><br>*Parent contest:* resolves to the division matching your rating; with no known rating it names the divisions rather than guessing | `difficulty_rating`, from that same per-problem call<br><br>*`-1` or `9999`:* stored as `???`. No estimator — CodeChef rates promptly | `/api/list/problems?group=attempted`, paged |

**`contest.standings` is called two different ways**, and it has to be. For a **gym** it is
signed with your key, and may be trimmed. For an **official** contest Codeforces serves it
only to an anonymous request carrying no extra parameters at all — so it is fetched unsigned,
whole, and cannot be narrowed: `count`, `from`, `handles`, `showUnofficial` and
`participantTypes` are all refused. That means ~8.5 MB, of which we want seven problem
objects out of eleven thousand participant rows. It is read and discarded, never stored.

Since that response also carries the contest name, the problem list, the start time and
enough rows to count in-contest solves, **an official contest is read entirely from the JSON
API** — no page is scraped, so nothing on that path can be challenged by Cloudflare, and no
codeforces.com tab needs to be open. Gyms still scrape, because a gym's roster has no API
source.

🔒 **needs you signed in to that site.** See the request diagram above: without a tab open
on that site the request goes out anonymously, and these two refuse rather than returning
an empty answer.

### Everything else that gets fetched

| | Also fetched |
|:--|:--|
| **Codeforces**<br>*both platforms* | `user.info` — verifying your handle, and reading your rating<br>`contest.list` — when a contest started, so the Contests tab can sort by date. Official and gyms are separate lists, one call each<br><br>Official and gyms are two platforms sharing one account, so each of these runs **twice** per refresh — including `user.status`, which has to, since the response carries no marker saying which kind a submission belongs to |
| **AtCoder** | `/users/<handle>` — verifying your handle, reading your rating, and checking it matches the account you're signed in as.<br>Contest name and start time come from the same `/tasks` page as the problems |
| **CodeChef** | `/dashboard` — which account is signed in, which is what your configured handle is checked against.<br>Contest name and divisions come from `/api/contests/<code>` |

**Nothing here fails silently.** Every "unreadable" above surfaces as a message or a `???`
— never as an empty result. A blank would be indistinguishable from having genuinely solved
nothing, and solved status is only ever set, never cleared, so a swallowed failure would
strand the queue permanently.

---

## Codeforces

Two channels are needed, because neither alone is enough.

### The API (`codeforces.com/api/…`)

Signed with your key and secret — which is the reason Codeforces is the one platform that
asks for more than a handle. Seven methods are used, all of them named in the two tables above.

Two are worth knowing about beyond what that table says. `problemset.problems` returns all
~11k problems in a single request, and is used for exactly one thing: checking whether
Codeforces has published a contest at all. It is deliberately *not* where difficulty comes
from — see the difficulty row above. And `contest.standings` is the only place either kind of
contest publishes its problems' tags and difficulties, which is why it is fetched even when
nothing is being estimated.

### The standings page (scraped)

**Only gyms are scraped.** An official contest is read entirely from `contest.standings`,
which carries its name, its problems, their published ratings and tags, the start time, and
rows enough to count in-contest solves. That call is made regardless — it is the only thing
that reports a shared Div. 1 / Div. 2 problem's rating under this contest's index — so
scraping the page for the same facts was paying twice.

A gym has no such option: its standings need signing, and a gym whose standings are hidden
answers `FAILED` to that call entirely. So the page is still the only source of a gym's
roster, and `contest.standings` supplies its solve counts.

Why neither roster can come from `problemset.problems`: it files a problem under the contest
it originated in, so a Div. 2 round sharing problems with a Div. 1 one lists only the ones
unique to it. And why in-contest counts can't come from `problemStatistics`: its
`solvedCount` includes practice solves, while the model is fitted to in-contest performance.

All the HTML parsing lives in **one file**, `core/platforms/codeforces-gyms/standings-dom.js` — and
in one *platform*: official rounds read no HTML at all. If Codeforces changes its layout,
that is the only place to look.

> **The page is never read for an official round.** It used to be, in one case: measuring
> the *field* when `contest.ratingChanges` came back empty, for a round Codeforces has not
> rated yet. That now samples the rows of the `contest.standings` response already fetched
> for the problems, so it costs no extra request and touches no HTML.
>
> It is still a *sample* rather than the whole field, because turning rows into ratings
> costs one `user.info` call per 250 handles: ~1,500 competitors are taken — the top 500 in
> full, since they decide the hard problems, plus 1,000 spread evenly through the rest.
> Gyms never sample; their whole field arrives in one response and is small enough to rate.

### Estimated difficulty

Codeforces rates only *some* gym problems. For those it doesn't, difficulty is
**calculated, not fetched**: given everyone who competed and how many solved a problem,
there's exactly one rating at which the Elo model predicts that many solves, and the code
searches for it.

**Official rounds are estimated only briefly.** A contest is not added at all until it
appears in `problemset.problems`; until then it waits and is retried on every refresh. But
appearing there does not mean rated — a round is often listed with every problem still
unrated for a week or more — so a contest added soon after it runs *is* estimated, and those
numbers are replaced from `contest.standings` on a later refresh.

That re-check runs at most weekly, and stops six weeks after the round ran. By then anything
still unrated never will be — an ICPC challenge, a Kotlin Heroes practice round — and
without the cutoff those would be re-fetched every week forever.

Appearing there is not the same as being *fully* rated, though. Two things can leave a
problem unrated, and only one of them really is: a problem shared with the paired division is
filed under that division and simply isn't listed here (its rating comes from
`contest.standings` instead), while 283 of the ~11k entries — about 2.5% — are listed with no
rating at all. Only the second gets estimated.

Each problem records which it was — `ratingSource: "official"` or `"estimated"` — and an
estimate is replaced by the real number as soon as Codeforces publishes one. **In the panel,
an estimated difficulty is underlined with a dotted line**; hover it for the reason.

> **Gyms are not all unrated.** About a third of gym problems carry Codeforces' own published
> difficulty — those are the ones a setter picked from the archive rather than writing
> themselves, so Codeforces still recognises them. That number arrives on the same response
> the tags do, and is preferred over an estimate. The other two thirds are problems written
> for that contest, and those are estimated.

> **How good the estimates are.** On a full official round the model is excellent: it
> reproduces 14 of 15 published ratings exactly. On a gym it is being asked to fit 5–76
> people instead of thousands, and it shows — measured against the gym problems Codeforces
> *does* rate, the estimates were a mean 211 off, with 14 of 62 out by 400 or more. Not
> biased in either direction (mean signed error −10), just noisy. Seven ways of improving it
> were tried and measured; all were neutral or worse. See
> `tests/estimator-accuracy.test.js`, which lists them so they aren't retried.

### When a gym's standings are hidden

A setter can hide a gym's standings. When they do, the standings page has no table *and* the
`contest.standings` API refuses — so both usual sources vanish at once, and adding the
contest used to fail outright.

`contest.status` still answers. One request returns every submission, which between them
carry the problems, their difficulties, who competed, and what they solved. The problem
*list* comes from the ordinary `codeforces.com/gym/<id>` page instead, because a problem
nobody attempted appears in no submission and would silently go missing from your queue.

---

## AtCoder

Everything comes from AtCoder itself. It used to come almost entirely from **AtCoder
Problems** (kenkoooo), a third-party project, which is no longer used at all — including for
difficulty, which is now fitted here.

Things worth knowing:

- **Difficulty is an estimate, and always was.** AtCoder publishes no rating for its problems.
  The number you see is fitted from how the contest's field actually did — the rating at which
  a competitor had a 50-50 chance. It is shown with a dotted underline, like any estimate.
- **Difficulty can be negative.** 931 problems are below zero — ABC 471's A is −817. That's
  real, not a bug.
- **A problem is identified by its task id**, not its position, so solving one clears it from
  every contest that reuses it — and 1,906 of 9,383 problems appear in more than one.
- **Solved status is read per contest**, because AtCoder publishes no per-user submission
  list. One consequence: solving a problem through a contest you *don't* track won't clear it
  from one you do.
- **Keep an atcoder.jp tab open when refreshing.** Both the submissions list and the
  standings need your session — the two marked 🔒 in the table above — and without a tab
  open the request goes out anonymously and is refused.

---

## CodeChef

CodeChef's public API was retired, so the extension uses the same `/api/` endpoints the site's
own front end calls, and only ever for things you're already tracking.

### When a CodeChef contest isn't ready

Two cases, and neither adds the contest:

- **It's still running.** The payload lists the problems during a contest, so nothing used to
  stop an add mid-flight — which would have recorded in-contest results as if they were final.
  CodeChef reports its own clock beside the contest's end time, so this is decided by *its*
  time, not your computer's.
- **A problem's details couldn't be fetched.** Difficulty costs one request per problem, and if
  one of them fails the contest waits and retries rather than storing that problem as unrated.
  A failed request is not evidence that CodeChef has no rating for it — conflating the two
  showed `???` for problems CodeChef *had* rated.

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
- **Codeforces is asked *about* a handle**, so who's signed in there is irrelevant. What's
  verified is that the handle **exists** — not that it's yours. Type someone else's and you'll
  sync their solves; Codeforces offers no way to check.
- **AtCoder is checked both ways.** The handle must exist, and if you're signed in to AtCoder
  it must match the account you're signed in as. It only objects when it can *prove* a
  mismatch: signed out, it falls back to checking the handle exists, because adding a contest
  has to keep working without a session.

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
| `upsolve_tracker.waiting_contests` | Contests you asked for that the site hasn't published yet, retried on every refresh |
| `upsolve_tracker.auto_export` | Whether the backup file is kept current |
| `upsolve_tracker.platform_filter`, `.stats_scope`, `.expanded_contests`, `.waiting_expanded`, `.tag_rating_range.*` | UI state that should survive switching tabs |

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
| A rating shows `???` | The site published the contest but says that problem has no rating, and that site has no estimator. It's rare: in practice difficulties arrive with the problem list. A problem the extension merely *failed to fetch* never shows `???` — that contest waits instead. |
| A Codeforces difficulty looks off | If it's underlined with a dotted line it's an estimate, not a published number — which on an official round means Codeforces lists the problem but never rated it. On gyms estimates are noisy in both directions, a mean 211 out and occasionally 400+, because the model has only the handful of people who entered to work from. |
| The chance column shows `—` | Either the problem has no difficulty, or your rating for that site is unknown. Those are different problems and the queue shows them differently on purpose. |
| Adding a contest is slow | Expected. Requests are spaced deliberately; a CodeChef division costs about one request per problem. |
| A contest sits in "Waiting" | It isn't ready: still running, or the site hasn't published its problems and difficulties. Every refresh retries it. Codeforces rounds wait for real ratings rather than being added with estimates. |
| CodeChef says "refused the request" | Open codechef.com in a tab and make sure you're signed in. |
| The backup file has stopped updating | The export folder handle lives in IndexedDB and can be lost. Re-pick the folder in Settings. |

The refresh reports failures **last**, after writing the backup, so a message about a failed
sync can't be overwritten by the backup notice.

---

## For the curious

`CLAUDE.md` in this repo is the engineering-side document: why things are built the way they
are, which approaches were tried and rejected, and which invariants must not be broken. It's
considerably more detailed than this file, and considerably more opinionated.
