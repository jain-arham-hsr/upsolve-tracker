/**
 * Every assumption this extension makes about Codeforces' HTML lives here —
 * and it is now exactly one page, `/gym/<id>`.
 *
 * That page is read for one kind of contest only: a gym whose standings the
 * setter hid, which answers `FAILED` to `contest.standings` and renders no
 * standings table. Everything else Codeforces serves comes from the JSON API.
 *
 * This file was called `standings-dom.js` long after the standings scrape was
 * deleted, and nothing noticed, because nothing tied a parser's name to the
 * page it reads. Naming it for the page is what makes the next such drift
 * visible; keep that property when adding to it.
 *
 * Takes a `Document`, never a string, so nothing here parses or fetches.
 *
 * Extractors return null rather than a plausible default when they can't find
 * what they're looking for. A missing solve count that reads as zero produces
 * a confident, wrong rating that gets stored and sorted like a real one; a
 * null forces the caller to decide, loudly.
 */

const SELECTORS = {
  // Ordered fallbacks: first match wins.
  problemsTable: ["table.problems"],

  // Still needed by extractProblemsFromList, which reads the index and name out
  // of each row's links. It also served the deleted standings-header parser.
  problemLink: 'a[href*="/problem/"]',

  /**
   * The contest name on a *problems* page, which is a different place.
   *
   * Deliberately not the chain above: that page has no `.contest-name`, and
   * its first `.caption` is the "→ About Contest" sidebox heading — so reusing
   * it named a contest "→ About Contest" in the queue. The name is the sidebar
   * contest box's header link, which points at the contest root.
   */
  problemsPageContestName: ["#sidebar .rtable th a", "#sidebar .rtable th"],

  /** "Finished", "Running", "Before start" — the sidebar's own phase label. */
  contestPhase: [".contest-state-phase"],

};

/** Node.TEXT_NODE, inlined so this module parses outside a browser too. */
const TEXT_NODE = 3;

/** Text the totals row is identified by. */
const TOTALS_ROW_MARKER = "Accepted";

/** Shared by both problem extractors so their fallbacks can't drift. */
const UNKNOWN_PROBLEM = "Unknown Problem";

function queryFirst(root, selectors) {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

/** @returns {string|null} */

function cleanText(element) {
  const text = element?.innerText ?? element?.textContent;
  return text?.replace(/\s+/g, " ").trim() || null;
}

/**
 * The contest name from a *problems* page.
 *
 * **Why the name is read off the sidebar and not a `.caption`.** There used to
 * be a second reader here, `findContestName`, for the standings page, whose
 * fallback chain was `.contest-name` → `.caption` → `<title>`. A problems page
 * has no `.contest-name`, and its first `.caption` is the "→ About Contest"
 * sidebox heading — so pointing that chain at this page filed the first real
 * gym in the queue under the name **"→ About Contest"**. A test used to pin
 * that by asserting the wrong answer; the wrong function is now deleted, so the
 * warning lives here instead.
 *
 * The name is the sidebar contest box's header link (`#sidebar .rtable th a`),
 * whose href is the contest root — not a `.caption` at all. Note it is read
 * once at add time and never re-read, so a contest added under the wrong name
 * keeps it until removed and re-added.
 *
 * @param {Document} doc
 * @param {string} contestPath - e.g. "/gym/712373", the sidebar header's href
 * @returns {string|null}
 */
export function findContestNameOnProblemsPage(doc, contestPath) {
  // Most specific first: the sidebar box header links to the contest root.
  const linked = doc.querySelector(`#sidebar a[href="${contestPath}"]`);
  const fromLink = cleanText(linked);
  if (fromLink) return fromLink;

  const fromSidebar = cleanText(
    queryFirst(doc, SELECTORS.problemsPageContestName),
  );
  if (fromSidebar) return fromSidebar;

  // Codeforces titles pages "<section> - <contest> - Codeforces". Dropping the
  // suffix is worth doing; guessing at the section prefix is not, since a
  // slightly long name still reads correctly and a wrong split does not.
  const title = cleanText(doc.querySelector("title"));
  return title?.replace(/\s*-\s*Codeforces\s*$/i, "").trim() || null;
}

/**
 * Problem metadata from a contest's *problems* page, rather than its
 * standings header.
 *
 * A gym can be configured so its standings are never visible, which leaves the
 * problems page as the only place the problem list appears at all. Deriving it
 * from submissions instead would silently omit any problem nobody attempted,
 * so this page is the authority on what a contest contains.
 *
 * @returns {Array<{index: string, name: string, url: string}>|null}
 *   null when the table is missing or a row can't be read.
 */
/**
 * Whether the contest has finished, read off the page rather than the API.
 *
 * The hidden-standings path has no `contest.standings` to ask, and adding a
 * contest mid-flight is not harmless: the estimator would fit partial solve
 * counts, and on a gym nothing ever corrects the result.
 *
 * @returns {boolean|null} null when the page doesn't say, which callers must
 *   treat as "proceed" — refusing on an unreadable label would make a contest
 *   unaddable for a reason we cannot even state.
 */
export function hasFinished(doc) {
  const label = cleanText(queryFirst(doc, SELECTORS.contestPhase));
  if (!label) return null;
  return /finished/i.test(label);
}

export function extractProblemsFromList(doc) {
  const table = queryFirst(doc, SELECTORS.problemsTable);
  if (!table) return null;

  const problems = [];

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    // The header row has no id cell, so this skips it without matching on text.
    const indexLink = row.querySelector("td.id a");
    if (!indexLink) continue;

    const index = indexLink.textContent.trim();
    const href = indexLink.getAttribute("href");

    // An indexless problem would silently mismatch every later lookup by
    // index, exactly as in extractProblems.
    if (!index || !href) return null;

    // The name is the row's other link to the same problem. Matching on
    // position instead would break the first time a column is added.
    const nameLink = Array.from(
      row.querySelectorAll(SELECTORS.problemLink),
    ).find((link) => link !== indexLink && link.textContent.trim());

    problems.push({
      index,
      name: nameLink?.textContent.replace(/\s+/g, " ").trim() || UNKNOWN_PROBLEM,
      url: `https://codeforces.com${href}`,
    });
  }

  return problems.length > 0 ? problems : null;
}

/** @returns {number|null} */
