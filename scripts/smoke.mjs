#!/usr/bin/env node
/**
 * Loads the built panel in headless Chrome and clicks through it.
 *
 * This exists because of a real escape: `contest.tagsSyncedAt == nullAt` is
 * valid JavaScript, so `node --check` passed, the build succeeded and 192 unit
 * tests stayed green — and the Stats tab threw on render for every user. The
 * unit suite cannot catch that class of bug because it never executes a view.
 *
 * So this runs the actual bundle, with the extension APIs stubbed, and fails
 * on any uncaught error, rejection or console.error while rendering each tab.
 * It is deliberately shallow: it proves the views run, not that they are right.
 *
 *   npm run build:chrome && npm run smoke
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  // A missing browser is not a failing build — say so and stop.
  console.log("smoke: no Chrome found (set CHROME_PATH to run this) — skipped");
  process.exit(0);
}

const dist = path.resolve("dist/chrome");
if (!existsSync(path.join(dist, "core/ui/index.html"))) {
  console.error("smoke: dist/chrome is missing — run `npm run build:chrome` first");
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), "upsolve-smoke-"));
cpSync(dist, work, { recursive: true });

const page = path.join(work, "core/ui/index.html");
// The built pages reference /assets/ and /fonts/ from the extension root; a
// file:// origin resolves those against the disk root instead. Rewriting them
// is what lets this run without a server — the absolute paths themselves are
// correct for chrome-extension:// and were verified separately over http.
const html = readFileSync(page, "utf8")
  .replaceAll('src="/assets/', 'src="../../assets/')
  .replaceAll('href="/assets/', 'href="../../assets/');

const assetsDir = path.join(work, "assets");
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith(".css")) continue;
  const full = path.join(assetsDir, file);
  writeFileSync(full, readFileSync(full, "utf8").replaceAll("url(/fonts/", "url(../fonts/"));
}

/** A queue with all three platforms, so every renderer has something to draw. */
const STORE = {
  "upsolve_tracker.handle": "tourist",
  "upsolve_tracker.atcoder_handle": "tourist",
  "upsolve_tracker.codechef_handle": "tourist",
  "upsolve_tracker.platform_ratings": { codeforces: 1450, atcoder: 900, codechef: 1600 },
  trackedContests: [
    {
      id: "2237", platform: "codeforces", type: "OFFICIAL", name: "Codeforces Round 1",
      startTimeSeconds: 1_700_000_000, tagsSyncedAt: Date.now(),
      problems: [
        { index: "A", name: "Duck Surplus", rating: 1000, tags: ["greedy"], solved: false },
        { index: "B", name: "Solved One", rating: 1200, tags: [], solved: true },
      ],
    },
    {
      id: "709413", platform: "codeforces", type: "GYM", name: "ICPC Regional",
      startTimeSeconds: 1_690_000_000, tagsSyncedAt: null,
      problems: [{ index: "A", name: "Untagged", rating: null, tags: [], solved: false }],
    },
    {
      id: "abc466", platform: "atcoder", type: "ABC", name: "AtCoder Beginner Contest 466",
      startTimeSeconds: 1_710_000_000,
      problems: [{ index: "abc466_a", name: "Nine or Nein", rating: -817, tags: [], solved: false }],
    },
    {
      id: "START252D", platform: "codechef", type: "STARTERS", name: "Starters 252",
      sourceId: "START252", startTimeSeconds: 1_720_000_000, tagsSyncedAt: Date.now(),
      problems: [{ index: "MODSUB", name: "Modify and Subtract", rating: 1757, tags: ["dp"], solved: false }],
    },
  ],
};

const stub = `<script>
(function () {
  const store = ${JSON.stringify(STORE)};
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + e.message));
  addEventListener("unhandledrejection", (e) =>
    window.__errors.push("rejection: " + ((e.reason && e.reason.message) || e.reason)));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.map(String).join(" ")); realError(...a); };
  // secure-store keeps the API pair in IndexedDB. Without it hasCompleteSetup()
  // is false and the queue renders a setup prompt instead of any rows — which
  // would leave the most-used renderer in the app untested.
  const secure = { api_key: "k", api_secret: "s", data_dir_handle: null };
  // defineProperty, not assignment: window.indexedDB is getter-only, so a
  // plain assignment fails silently. And real IndexedDB is unavailable on
  // file:// origins, so loadCredentials() would reject and take
  // hasCompleteSetup() down with it, leaving the queue on its setup prompt.
  Object.defineProperty(window, "indexedDB", { configurable: true, value: {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close() {},
          createObjectStore() {},
          transaction: () => ({
            objectStore: () => ({
              get: (key) => { const r = { result: secure[key] ?? null };
                queueMicrotask(() => r.onsuccess?.({ target: r })); return r; },
              put(value, key) { secure[key] = value; },
              delete(key) { delete secure[key]; },
            }),
            set oncomplete(fn) { queueMicrotask(fn); },
            set onerror(_fn) {},
          }),
        };
        request.onsuccess?.({ target: request });
      });
      return request;
    },
    deleteDatabase() { const r = {}; queueMicrotask(() => r.onsuccess?.()); return r; },
  } });

  window.chrome = {
    storage: { local: {
      get: async (q) => {
        if (q == null) return { ...store };
        if (typeof q === "string") return { [q]: store[q] };
        if (Array.isArray(q)) return Object.fromEntries(q.map((k) => [k, store[k]]));
        return Object.fromEntries(Object.keys(q).map((k) => [k, k in store ? store[k] : q[k]]));
      },
      set: async (items) => Object.assign(store, items),
      remove: async () => {},
    } },
    tabs: { query: async () => [{ url: "https://example.com" }],
            onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
    runtime: { openOptionsPage() {}, lastError: null },
  };
})();
</script>`;

const driver = `<script type="module">
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = [];
  await wait(1200);
  for (const view of ["upsolve-queue-view", "upsolve-contest-list", "upsolve-stats-view"]) {
    document.querySelector(\`[data-view="\${view}"]\`)?.click();
    await wait(1200);
    const outlet = document.querySelector("#router-outlet");
    seen.push(view.replace("upsolve-", "") + ":" + (outlet?.textContent.trim().length ?? 0) + (window.__debug ? "|" + outlet?.textContent.replace(/\\s+/g," ").trim().slice(0,140) : ""));
  }
  // Drilling into a platform is the newest Stats path and the one that threw.
  document.querySelector(".ring-legend-row")?.click();
  await wait(1000);
  const drilled = document.querySelectorAll(".stats-scope-head").length;
  // Fonts load lazily, so ask for them rather than reading a status.
  const fonts = {};
  for (const [name, spec] of [["Inter", "500 16px Inter"], ["JetBrains Mono", "700 16px 'JetBrains Mono'"]]) {
    try { fonts[name] = (await document.fonts.load(spec)).length > 0; }
    catch { fonts[name] = false; }
  }
  document.title = "SMOKE " + JSON.stringify({ errors: window.__errors, seen, drilled, fonts });
</script>`;

writeFileSync(page, html.replace("<head>", "<head>\n" + stub).replace("</body>", driver + "</body>"));

const dom = execFileSync(chrome, [
  "--headless", "--disable-gpu", "--allow-file-access-from-files",
  "--virtual-time-budget=20000", "--dump-dom", `file://${page}`,
], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

const title = dom.match(/<title>SMOKE ([\s\S]*?)<\/title>/);
if (!title) {
  console.error("smoke: the panel never finished booting — no report was produced");
  process.exit(1);
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const { errors, seen, drilled, fonts } = JSON.parse(decode(title[1]));

for (const [name, ok] of Object.entries(fonts)) {
  // A missing bundled font is silent: the panel renders in whatever the system
  // has, which is exactly the inconsistency bundling them was meant to end.
  if (!ok) {
    console.error(`smoke: ${name} did not load — the panel would fall back to a system face`);
    process.exit(1);
  }
}

if (drilled !== 1) {
  console.error("smoke: drilling into a platform on Stats produced no scope header");
  process.exit(1);
}

for (const view of seen) {
  const [name, size] = view.split(":");
  // A view that renders nothing has thrown, or has silently drawn an empty
  // shell. The floor is deliberately above zero: the queue answers a missing
  // setup with a short prompt, and that would otherwise read as success.
  if (Number(size) < 400) {
    console.error(`smoke: ${name} rendered only ${size} characters — too little to be the real view`);
    process.exit(1);
  }
}

if (errors.length) {
  console.error("smoke: the panel raised errors while rendering:");
  for (const error of errors) console.error("  " + error);
  process.exit(1);
}

console.log("smoke: views clean, fonts loaded —", seen.join("  "), " drilled:" + drilled);
