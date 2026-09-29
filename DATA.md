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
| Difficulty (the number beside the mark) | Published by the site where it publishes one. CodeChef always does, Codeforces usually, AtCoder never — anything worked out here instead is **estimated**, and shown with a dotted underline |
| The `~72%` chance | Calculated locally from that difficulty and your rating on that site |
| Your rating | Fetched from each site when the identity is verified |
| Whether you solved something | Your submission history on that site |
| Topic tags | Codeforces and CodeChef publish them; AtCoder does not |

---

## Every source, at a glance

Where each kind of data comes from, and what happens when that source fails. This is the
*where*; `CLAUDE.md` holds the *why*.

| | Problems | Difficulty | Submissions |
|:--|:--|:--|:--|
| **Codeforces Official**<br>`/contest/<id>` | `contest.standings`<br><br>*Not published yet:* waits, and retries on every refresh | `contest.standings`<br><br>*Not yet rated by Codeforces:* stored as an estimate, then re-asked from the same endpoint at most weekly — and not at all once the round is six weeks old<br><br>*Never rated:* estimated here. Solve counts from the same standings rows; the field from `contest.ratingChanges`, or ~1,500 sampled rows resolved through `user.info` when that is empty | `user.status` — one call, whole history |
| **Codeforces Gyms**<br>`/gym/<id>` | `contest.standings`, signed<br><br>*Standings hidden:* scraped from the `/gym/<id>` page — a problem nobody attempted is in no submission, so the list cannot be rebuilt from those | `contest.standings` — about a third of gym problems carry Codeforces' own rating<br><br>*The rest:* estimated here. Solve counts and field both from `contest.standings`; when the standings are hidden, from `contest.status` + `user.info` instead<br><br>*Field not visible at all:* refuses to add | `user.status` — the same call as official |
| **Codeforces Group Contests**<br>`/group/<group>/contest/<id>` | Scraped from the contest's problems page 🔒 — the API answers "not found" for a group contest, even to a member's key | **Always estimated here** — nothing publishes one. Solve counts and the field scraped from the contest's standings pages 🔒, every page, with each participant's rating from `user.info`<br><br>*Signed out, or no tab:* waits and retries every refresh<br><br>*Nobody rateable in the standings:* refuses to add | `user.status` — the same call as official; it does carry group contest submissions |
| **AtCoder** | Scraped from `/contests/<id>/tasks`<br><br>*Unreadable:* waits and retries every refresh | **Always estimated here** — AtCoder publishes no difficulty. Fitted from `/contests/<id>/standings/json` 🔒<br><br>*Unreadable:* waits and retries | Scraped from `/contests/<id>/submissions?f.User=…&f.Status=AC` 🔒<br><br>Once per tracked contest |
| **CodeChef** | `/api/contests/<code>`, then `/api/contests/<code>/problems/<code>` — one request per problem<br><br>*Parent contest:* resolves to the division matching your rating; with no known rating it names the divisions rather than guessing | `difficulty_rating`, from that same per-problem call<br><br>*`-1` or `9999`:* stored as `???`, but only once the contest is a week old | `/api/list/problems?group=attempted`, paged 🔒 |

🔒 **needs a tab open on that site, signed in.** A request the extension makes on its own
is treated by the browser as coming from somewhere else, so your cookies are not attached
and the site sees a stranger. Everything unmarked is public.

### Codeforces: official, gym and group contests compared

| | **Official round** | **Gym** | **Group contest** |
|---|---|---|---|
| URL | `/contest/<id>` | `/gym/<id>` | `/group/<g>/contest/<id>` |
| Can the API see it? | Yes, anonymously | Only with your signed key | **No.** "Contest not found", even with a member's key |
| Problem list and name | `contest.standings`, unsigned | `contest.standings`, signed | The contest's dashboard page |
| Is it ready to add? | Listed in `problemset.problems` | `phase` in the standings reply | "Finished" versus "Contest is running" on the standings page |
| Published ratings | Yes; Codeforces rates them within days | About a third of problems (ones reused from the archive) | None; the problems are the group's own |
| Tags | Yes | Rarely | None |
| Participants, for estimates | `contest.ratingChanges`, or a sample of ~1,500 from the standings | Everyone in the standings (usually 5–76) | Everyone on the standings pages (719724 had 594), 200 per page |
| Solve counts | Standings totals | Counted from each standings row | "Accepted" totals row on page 1 |
| Your solves | `user.status` | `user.status` | `user.status`, which does include your group submissions |
| Start date | `contest.list` | `contest.list?gym=true`, or the standings reply | Your own in-contest submissions, if you competed |
| Needs a codeforces.com tab? | No | Only if the setter hid the standings | **Always**; the pages need your signed-in session |

### Everything else that gets fetched

| | Also fetched |
|:--|:--|
| **Codeforces**<br>*all three platforms* | `problemset.problems` — whether a contest has been published at all, which is the only thing it is used for<br>`user.info` — verifying your handle, and reading your rating<br>`contest.list` — when a contest started, so the Contests tab can sort by date. Official and gyms are separate lists, one call each; a group contest is in neither, so it is dated from your own submissions to it when you took part, and otherwise left undated. Asked only while some tracked contest is still undated: a site sets a start time when a contest is scheduled or never at all, so once it has answered — with a date, or with nothing — it is not asked again<br><br>Official, gyms and group contests are three platforms sharing one account, so each of these runs once per platform you track contests on — including `user.status`, which has to, since the response carries no marker saying which kind a submission belongs to |
| **AtCoder** | `/users/<handle>` — verifying your handle, reading your rating, and checking it matches the account you're signed in as<br>Contest name and start time come from the same `/tasks` page as the problems |
| **CodeChef** | `/dashboard` — which account is signed in, which is what your configured handle is checked against<br>Contest name and divisions come from `/api/contests/<code>` |

**Nothing here fails silently.** Every *unreadable* above waits and retries; none of them
stores a blank and moves on. That matters most for solved status: a blank is
indistinguishable from having genuinely solved nothing, and solved is only ever set and
never cleared, so one swallowed failure would strand the queue for good.

A `???` is the opposite case — the site answered, and said it has no rating. Only CodeChef
does that; Codeforces and AtCoder both work a number out instead.

Even then it waits a week first. CodeChef usually rates a contest within a day or two of it
running, so "no rating" on the evening it ends generally means "not yet" rather than "never".
A contest with anything unrated sits in Waiting until either the ratings arrive — which is
usually what happens — or a week passes and the answer is taken at face value.

---

## Behaviour worth knowing

Things that surprise people, with no bearing on where the data comes from.

**Codeforces**

- **No codeforces.com tab is needed**, with two exceptions: a gym whose standings the setter
  hid, and a group contest. Both are read from pages rather than the API, and those need one.
- A difficulty the extension worked out itself is **underlined with a dotted line**; hover
  it for the reason. On an official round it is close — a mean 100 out, and it leans about 70
  points *low*. On a gym it is fitting 5–76 people instead of thousands and runs a mean 211
  out, occasionally 400+, so treat those as approximate.

**AtCoder**

- **Keep an atcoder.jp tab open when refreshing.** Both rows marked 🔒 need your session,
  and without a tab the request goes out anonymously and is refused.
- Every difficulty here is an estimate — AtCoder publishes none — and it can be **negative**.
  ABC 471's A is −817. That is real.
- You will never see `???` on AtCoder. If the standings can't be read, the contest waits for
  a refresh with a tab open rather than filling the queue with blanks.
- A problem is identified by its task id, not its position, so solving it clears it from
  every contest that reuses it. 1,906 of 9,383 problems appear in more than one.
- Solved status is read per contest, so solving something through a contest you *don't*
  track will not clear it from one you do.

**CodeChef**

- **Stay signed in at codechef.com.** CodeChef cannot be asked *about* an account — it only
  answers for whoever holds the cookie — so syncing stops rather than risk writing someone
  else's solves onto your queue.
- The same problem usually runs in all four divisions of a Starters, so solving it once
  clears it everywhere.
- A partially-correct answer is not a solve. Scoring some subtasks is not finishing it.
- A few older problems were never mirrored to practice and can no longer be submitted. Those
  stay in the contest, greyed with a ⚠, and are left out of the queue.
- **A contest added the day it ends may sit in Waiting rather than joining the queue.** That
  is the ratings not having landed yet, not an error. It joins on whichever refresh finds
  them, and after a week it is added regardless, with `???` on whatever is still unrated.

---

## Whose data is it?

**Every site needs a handle, and nothing of yours is read before it is verified.** What that
check can prove differs, and the difference is worth knowing:

- **Codeforces** confirms the handle **exists**, not that it is yours — it offers no way to
  ask. Type someone else's and you will sync their solves.
- **AtCoder** also checks it against the account you are signed in as, when it can see one.
- **CodeChef** always can: it answers only for the signed-in account, so a mismatch stops the
  sync outright.

Change a handle and that site's solved flags are cleared, so the next sync re-derives them
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
| `upsolve_tracker.auto_export` | Whether the backup file is kept current. Not restored by Import, since the folder it writes to isn't in the backup |
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
| A rating shows `???` | Only CodeChef does this, and only on a contest more than a week old. It means CodeChef itself lists the problem as unrated — Codeforces and AtCoder both work a difficulty out instead, so neither ever shows one. Two things never produce a `???` on any site: a problem the extension merely *failed to fetch*, and a contest recent enough that CodeChef may simply not have rated it yet. Both wait and retry instead. |
| A Codeforces difficulty looks off | If it's underlined with a dotted line it's an estimate, not a published number — which on an official round means Codeforces lists the problem but never rated it. On gyms estimates are noisy in both directions, a mean 211 out and occasionally 400+, because the model has only the handful of people who entered to work from. |
| The chance column shows `—` | Either the problem has no difficulty, or your rating for that site is unknown. Those are different problems and the queue shows them differently on purpose. |
| Adding a contest is slow | Expected. Requests are spaced deliberately; a CodeChef division costs about one request per problem. |
| A contest sits in "Waiting" | It isn't ready: still running, or the site hasn't published its problems and difficulties. Every refresh retries it. A Codeforces round waits until Codeforces lists it at all — not until it is rated, since a listed-but-unrated round is added with estimates that settle later. A CodeChef contest also waits while any of its difficulties are missing, for up to a week after it ran. |
| CodeChef says "refused the request" | Open codechef.com in a tab and make sure you're signed in. |
| The backup file has stopped updating | The export folder handle lives in IndexedDB and can be lost. Re-pick the folder in Settings. |

The refresh reports failures **last**, after writing the backup, so a message about a failed
sync can't be overwritten by the backup notice.

---

## For the curious

This file answers **where**. `CLAUDE.md` answers **why** — which alternatives were tried and
measured, what each source cannot do, and which invariants must not be broken. It is the
longer and far more opinionated of the two, and it is where any reasoning that used to be
duplicated here now lives.

If the two ever disagree about a source, this file is wrong until proven otherwise: it is the
one meant to be checkable against the panel in front of you.
