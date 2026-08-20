/**
 * The shared platform filter. The subtle case is that "nothing selected" means
 * *no filter*, not *show nothing* — an empty queue with every chip dark reads
 * as a broken extension rather than a filter.
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

const { loadFilter, saveFilter, renderFilterChips, PLATFORM_FILTER_KEY } =
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

test("chips render an All option and mark the active ones", () => {
  const html = renderFilterChips(["atcoder"]);
  assert.match(html, /data-filter-key=""/);
  assert.match(html, /class="filter-chip is-on" data-filter-key="atcoder"/);
  // With a selection active, All is not highlighted.
  assert.ok(!/class="filter-chip is-on" data-filter-key=""/.test(html));
});

test("with no selection, All is the highlighted chip", () => {
  assert.match(renderFilterChips([]), /class="filter-chip is-on" data-filter-key=""/);
});

test("round-tripping a selection through storage preserves it", async () => {
  await saveFilter(["codechef", "codeforces:OFFICIAL"]);
  assert.deepEqual(await loadFilter(), ["codechef", "codeforces:OFFICIAL"]);
});
