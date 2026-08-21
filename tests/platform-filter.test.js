/**
 * The shared platform filter. The subtle case is that "nothing selected" means
 * *no filter*, not *show nothing* — an empty queue with nothing highlighted
 * reads as a broken extension rather than as a filter.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

let store;
function stubChrome(initial = {}) {
  store = structuredClone(initial);
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = key in store ? store[key] : fallback;
          }
          return out;
        },
        async set(patch) { Object.assign(store, structuredClone(patch)); },
      },
    },
  };
}

const { loadFilter, saveFilter, renderFilterControl, PLATFORM_FILTER_KEY } =
  await import("../core/ui/platform-filter.js");
const { matchesFilter } = await import("../core/platforms/registry.js");

beforeEach(() => stubChrome());

test("no stored filter means everything shows", async () => {
  assert.deepEqual(await loadFilter(), []);
  assert.equal(matchesFilter({ platform: "atcoder" }, []), true);
  assert.equal(matchesFilter({ platform: "atcoder" }, null), true);
});

test("a saved single-select choice survives the move to chips", async () => {
  // The old dropdown stored "OFFICIAL" / "GYM" / "ALL" under another key. Note
  // the prefix here is the current one: the storage migration renames
  // cf_trainer.* before any view reads, so by the time this code runs the old
  // dropdown's value is sitting under upsolve_tracker.contest_filter. Both
  // migrations have to hold for a long-standing install — see the end-to-end
  // case in storage-migration.test.js.
  stubChrome({ "upsolve_tracker.contest_filter": "GYM" });
  assert.deepEqual(await loadFilter(), ["codeforces:GYM"]);

  stubChrome({ "upsolve_tracker.contest_filter": "ALL" });
  assert.deepEqual(await loadFilter(), []);
});

test("the new selection wins once one exists", async () => {
  stubChrome({
    "upsolve_tracker.contest_filter": "GYM",
    [PLATFORM_FILTER_KEY]: ["atcoder"],
  });
  assert.deepEqual(await loadFilter(), ["atcoder"]);
});

test("filtering keeps only the selected groups", () => {
  const contests = [
    { platform: "codeforces", type: "OFFICIAL" },
    { platform: "codeforces", type: "GYM" },
    { platform: "atcoder", type: "ABC" },
    { platform: "codechef", type: "STARTERS" },
  ];
  const kept = contests.filter((c) => matchesFilter(c, ["codeforces:GYM", "atcoder"]));
  assert.deepEqual(kept.map((c) => c.platform + ":" + c.type), ["codeforces:GYM", "atcoder:ABC"]);
});

test("a contest predating platforms filters as Codeforces official", async () => {
  assert.equal(matchesFilter({ id: "1", type: "OFFICIAL" }, ["codeforces:OFFICIAL"]), true);
  assert.equal(matchesFilter({ id: "1", type: "OFFICIAL" }, ["atcoder"]), false);
});

test("the collapsed button says what is filtered without being opened", () => {
  assert.match(renderFilterControl([]), /All platforms/);

  const some = renderFilterControl(["codeforces:GYM", "codechef"]);
  assert.match(some, /2 of 4/, "should count selected groups against the total");
  assert.ok(!/All platforms/.test(some));
});

test("the summary shows one mark per platform, not one per group", () => {
  // Selecting both Codeforces groups is still one platform, so the collapsed
  // button shows a single Codeforces mark — plus the two panel rows.
  const both = renderFilterControl(["codeforces:OFFICIAL", "codeforces:GYM"]);
  assert.equal((both.match(/(?:aria-label|alt)="Codeforces"/g) ?? []).length, 3);
  assert.match(both, /2 of 4/);
});

test("the list is flat — every row names its platform in full", () => {
  const html = renderFilterControl([]);

  // No headers, so a row cannot rely on one above it for context.
  assert.ok(!/filter-group-head/.test(html));
  assert.ok(!/is-nested/.test(html));

  for (const label of ["Codeforces Official", "Codeforces Gym", "AtCoder", "CodeChef"]) {
    assert.ok(html.includes(label), `${label} should be a row of its own`);
  }
  assert.equal((html.match(/class="filter-row"/g) ?? []).length, 4);
});

test("every row carries its platform's mark, including both Codeforces rows", () => {
  const html = renderFilterControl([]);
  // Matched on the accessible name rather than the element: AtCoder's mark is
  // a raster with alt text, the others are inline SVG with aria-label.
  const named = (label) =>
    (html.match(new RegExp(`(?:aria-label|alt)="${label}"`, "g")) ?? []).length;

  assert.equal(named("Codeforces"), 2, "one mark on each Codeforces row");
  assert.equal(named("AtCoder"), 1);
  assert.equal(named("CodeChef"), 1);
});

test("selected rows are marked pressed, so state is not colour-alone", () => {
  const html = renderFilterControl(["atcoder"]);
  assert.match(html, /data-filter-key="atcoder" aria-pressed="true"/);
  assert.match(html, /data-filter-key="codechef" aria-pressed="false"/);
});

test("the panel starts closed", () => {
  assert.match(renderFilterControl([]), /class="filter-panel hidden"/);
  assert.match(renderFilterControl([]), /aria-expanded="false"/);
});

test("a stale key from an older build doesn't inflate the count", () => {
  // Selections persist, so a removed platform's key can outlive it.
  const html = renderFilterControl(["codechef", "leetcode:OFFICIAL"]);
  assert.match(html, /1 of 4/);
});

test("round-tripping a selection through storage preserves it", async () => {
  await saveFilter(["codechef", "codeforces:OFFICIAL"]);
  assert.deepEqual(await loadFilter(), ["codechef", "codeforces:OFFICIAL"]);
});
