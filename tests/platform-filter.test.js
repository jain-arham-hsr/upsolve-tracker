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
  // The old dropdown stored "OFFICIAL" / "GYM" / "ALL" under another key.
  stubChrome({ "cf_trainer.contest_filter": "GYM" });
  assert.deepEqual(await loadFilter(), ["codeforces:GYM"]);

  stubChrome({ "cf_trainer.contest_filter": "ALL" });
  assert.deepEqual(await loadFilter(), []);
});

test("the new selection wins once one exists", async () => {
  stubChrome({
    "cf_trainer.contest_filter": "GYM",
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
  // Selecting both Codeforces groups is still one platform.
  const both = renderFilterControl(["codeforces:OFFICIAL", "codeforces:GYM"]);
  assert.equal((both.match(/aria-label="Codeforces"/g) ?? []).length, 2,
    "one mark in the summary, one on the panel row");
});

test("Codeforces nests its two groups; the others are a single row", () => {
  const html = renderFilterControl([]);
  assert.match(html, /filter-group-head/);
  assert.match(html, /data-filter-key="codeforces:OFFICIAL"[^>]*[\s\S]*?Official/);
  assert.match(html, /class="filter-row is-nested"/);
  // AtCoder contributes one group, so it is a plain row named for the platform.
  assert.match(html, /data-filter-key="atcoder"[\s\S]*?AtCoder/);
  assert.ok(!/is-nested[^>]*data-filter-key="atcoder"/.test(html));
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
