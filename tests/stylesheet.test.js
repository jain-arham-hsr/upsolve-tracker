/**
 * Structural checks on style.css.
 *
 * These exist because of a real bug: `.view-container` was the last selector
 * of a *grouped* rule, and removing it as an apparent duplicate destroyed the
 * whole block — the one commented "The Flexbox Scrolling Fix" — while leaving
 * a dangling comma that swallowed the next rule. The queue stopped scrolling
 * and `#router-outlet` inherited a button's border. Nothing else in the repo
 * could have caught it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../core/ui/style.css", import.meta.url), "utf8");

/** Selector text of every rule: what sits between the last `}` and the `{`. */
function selectors() {
  const out = [];
  let cursor = 0;

  for (const match of css.matchAll(/\{/g)) {
    const text = css.slice(cursor, match.index);
    const lastClose = text.lastIndexOf("}");
    out.push(text.slice(lastClose + 1).trim());
    cursor = css.indexOf("}", match.index) + 1;
  }
  return out.filter(Boolean);
}

test("no selector list is left dangling by a removed group member", () => {
  // A comma followed by a comment means a selector was deleted from the middle
  // or end of a group, and the list has run on into whatever came next.
  const dangling = selectors().filter((sel) => /,\s*\/\*/.test(sel));

  assert.deepEqual(
    dangling,
    [],
    `selector list continues past a comment — a grouped rule lost a member:\n${dangling.join("\n---\n")}`,
  );
});

test("no selector list ends with a comma", () => {
  const trailing = selectors().filter((sel) => sel.trimEnd().endsWith(","));
  assert.deepEqual(trailing, [], `selector list ends in a comma:\n${trailing.join("\n")}`);
});

test("the flexbox scrolling fix still reaches the whole chain", () => {
  // Every one of these has to be able to shrink below its content, or the
  // lists grow past the panel instead of scrolling inside it.
  const rule = css.match(/cf-app,[\s\S]*?\{[\s\S]*?\}/);
  assert.ok(rule, "the scrolling-fix rule is gone");

  for (const selector of ["cf-app", "#router-outlet", "cf-queue-view", "cf-contest-list", "cf-stats-view"]) {
    assert.ok(rule[0].includes(selector), `${selector} dropped out of the scrolling fix`);
  }
  assert.match(rule[0], /min-height:\s*0/);
});

test("the scroll containers still declare their own overflow", () => {
  const rule = css.match(/#problem-list,\s*\n#contest-items\s*\{[\s\S]*?\}/);
  assert.ok(rule, "the shared scroll rule is gone");
  assert.match(rule[0], /overflow-y:\s*auto/);
  assert.match(rule[0], /flex:\s*1/);
});
