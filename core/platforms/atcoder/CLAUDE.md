<!-- Site notes for AtCoder. Split out of the root CLAUDE.md, which was over
     its size limit; this file is loaded when a file in this folder is read.
     Cross-site rules stay in the root. -->
# AtCoder

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
  problems. `parseTasks` and `parseSubmissions` in `atcoder/scraper.js` both read the id from
  the row's link for this reason.
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
  policy wrapped around it. `platforms/atcoder/estimator.test.js` carries the one
  deliberate divergence by name.
- **The two failure modes are deliberately asymmetric.** Standings failing is *soft*
  after the add — an already-stored contest fills in on a later refresh — but on the
  add itself it waits rather than storing nothing. Submissions failing is *loud* —
  `fetch` follows the 302, so a signed-out request arrives as a healthy 200 containing the login form,
  and parsing it yields no submissions, which is indistinguishable from having
  solved nothing. `solved` is sticky, so that would strand the queue silently. Both
  clients check `response.url`'s path for `/login`; see the refusal hook in each of
  `atcoder/api.js` and `atcoder/scraper.js`.

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
