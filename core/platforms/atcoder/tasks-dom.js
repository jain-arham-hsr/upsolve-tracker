/**
 * Every selector and parsing rule for AtCoder's `/contests/<id>/tasks` page.
 *
 * The AtCoder counterpart to `codeforces/standings-dom.js`, and it exists for
 * the same reason: a layout change should be a one-file fix, and markup must not
 * be read from three places that can disagree.
 *
 * ## Extractors return `null`, never a plausible default
 *
 * This is the invariant, not a style. The Codeforces version of this file was
 * written after `parseInt(...) || 0` turned an unreadable cell into a zero —
 * which did not break anything visibly, it produced *confidently wrong ratings*
 * that were stored and sorted like real ones. An empty-but-present task table
 * and a missing task table must stay distinguishable, so the caller can refuse
 * rather than store a contest that looks merely short.
 *
 * Takes a `Document` — the browser's `DOMParser` in production, `linkedom` in
 * tests — rather than a string, so no parsing happens here.
 */

/**
 * The contest's display name.
 *
 * The sidebar link, not `<title>`: the title carries a " - AtCoder" suffix and
 * is localised differently. Falls back through both rather than inventing one.
 *
 * @returns {string|null}
 */
export function findContestName(doc) {
  const link = doc.querySelector(".contest-title");
  const fromLink = link?.textContent?.trim();
  if (fromLink) return fromLink;

  const title = doc.querySelector("title")?.textContent?.trim();
  if (!title) return null;
  const trimmed = title.replace(/\s*-\s*AtCoder\s*$/i, "").trim();
  return trimmed || null;
}

/**
 * Start and end, as epoch seconds.
 *
 * The page prints both as `<time class="fixtime fixtime-full">` in document
 * order — start first — carrying an explicit `+0900` offset, so `Date.parse`
 * needs no timezone assumption. Anything else returns nulls rather than a
 * guess: a wrong start time silently mis-sorts the contest list.
 *
 * @returns {{startTimeSeconds: number|null, endTimeSeconds: number|null}}
 */
export function findContestTimes(doc) {
  const stamps = [...doc.querySelectorAll("time.fixtime-full")]
    .map((node) => Date.parse(node.textContent?.trim() ?? ""))
    .filter((ms) => Number.isFinite(ms))
    .map((ms) => Math.floor(ms / 1000));

  return {
    startTimeSeconds: stamps[0] ?? null,
    endTimeSeconds: stamps[1] ?? null,
  };
}

/**
 * The contest's problems, in the order the page lists them.
 *
 * Reading a contest's *own* tasks page is what removes the need for AtCoder
 * Problems' `contest-problem.json`: a problem can belong to several contests —
 * daily-training rounds are mostly reruns — and a global list only records the
 * contest a problem debuted in. This page answers for exactly this contest.
 *
 * Identity is the task id from the row's link (`/contests/<id>/tasks/<task>`),
 * never the displayed index: in a rerun `abc432_c` can be listed as problem E,
 * and the id is what makes one solve clear every contest carrying it.
 *
 * @returns {Array<{index: string, problemId: string, name: string}>|null}
 *   `null` when no task table can be found at all — distinct from `[]`, which
 *   means the table is there and genuinely empty.
 */
export function findTasks(doc) {
  const rows = [...doc.querySelectorAll("table tbody tr")];
  if (rows.length === 0) return null;

  const tasks = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll("td")];
    if (cells.length < 2) continue;

    const link = cells[1].querySelector("a[href]") ?? cells[0].querySelector("a[href]");
    const href = link?.getAttribute("href") ?? "";
    const match = href.match(/\/contests\/[^/]+\/tasks\/([^/?#]+)/);
    if (!match) continue;

    const index = cells[0].textContent?.trim();
    const name = cells[1].textContent?.trim();
    if (!index || !name) continue;

    tasks.push({ index, problemId: match[1], name });
  }

  // A table that parsed but yielded nothing is a shape change, not an empty
  // contest — AtCoder does not publish contests with no problems.
  return tasks.length > 0 ? tasks : null;
}
