/**
 * AtCoder's `/contests/<id>/tasks` page.
 *
 * The one public page AtCoder serves that carries everything an add needs: the
 * contest's name, when it ran, and every problem with its task id.
 *
 * Reading a contest's *own* tasks page is what removes the need for AtCoder
 * Problems' `contest-problem.json`: a problem can belong to several contests —
 * daily-training rounds are mostly reruns — and a global list only records the
 * contest a problem debuted in. This page answers for exactly this contest.
 */
import { DomReader } from "../../dom-reader.js";

export class TasksPage extends DomReader {
  static selectors = {
    // The sidebar link first, `<title>` as the fallback: the title carries a
    // " - AtCoder" suffix and is localised differently.
    contestName: [".contest-title", "title"],
    // Both stamps carry an explicit `+0900`, so `Date.parse` needs no timezone
    // assumption of ours.
    times: "time.fixtime-full",
    taskRow: "table tbody tr",
    taskCell: "td",
    taskLink: "a[href]",
  };

  /** `/contests/<id>/tasks/<task_id>` — the id is the identity, see below. */
  static #TASK_HREF = /\/contests\/[^/]+\/tasks\/([^/?#]+)/;

  /**
   * @returns {{name: string|null, startTimeSeconds: number|null,
   *            endTimeSeconds: number|null,
   *            problems: Array<{index: string, problemId: string, name: string}>}|null}
   *   `null` when there is no task table at all, which the caller reads as "not
   *   published yet" rather than as an empty contest.
   */
  static read(doc) {
    const problems = this.#tasks(doc);
    if (problems === null) return null;

    return { name: this.#name(doc), ...this.#times(doc), problems };
  }

  static #name(doc) {
    const found = this.text(this.first(doc, this.selectors.contestName));
    if (!found) return null;

    // Only `<title>` carries the suffix, but stripping it unconditionally is
    // safe and saves knowing which of the two chain entries matched.
    return found.replace(/\s*-\s*AtCoder\s*$/i, "").trim() || null;
  }

  /**
   * Start and end as epoch seconds, in document order — start first.
   *
   * Nulls rather than a guess when the stamps are unreadable: a wrong start
   * time silently mis-sorts the contest list, which is not a visible failure.
   */
  static #times(doc) {
    const stamps = this.all(doc, this.selectors.times)
      .map((node) => Date.parse(this.text(node) ?? ""))
      .filter((ms) => Number.isFinite(ms))
      .map((ms) => Math.floor(ms / 1000));

    return {
      startTimeSeconds: stamps[0] ?? null,
      endTimeSeconds: stamps[1] ?? null,
    };
  }

  /**
   * Identity is the task id from the row's link, never the displayed index: in
   * a rerun `abc432_c` can be listed as problem E, and the id is what makes one
   * solve clear every contest carrying it.
   */
  static #tasks(doc) {
    const rows = this.all(doc, this.selectors.taskRow);
    if (rows.length === 0) return null;

    const tasks = [];
    for (const row of rows) {
      const cells = this.all(row, this.selectors.taskCell);
      if (cells.length < 2) continue;

      const link =
        this.first(cells[1], this.selectors.taskLink) ??
        this.first(cells[0], this.selectors.taskLink);
      const match = (link?.getAttribute("href") ?? "").match(this.#TASK_HREF);
      if (!match) continue;

      const index = this.text(cells[0]);
      const name = this.text(cells[1]);
      if (!index || !name) continue;

      tasks.push({ index, problemId: match[1], name });
    }

    // A table that parsed but yielded nothing is a shape change, not an empty
    // contest — AtCoder does not publish contests with no problems.
    return tasks.length > 0 ? tasks : null;
  }
}
