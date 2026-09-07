/**
 * Everything outside `core/platforms/` is platform-agnostic, and this is what
 * says so.
 *
 * `registry.js` and `platforms.js` are the only two modules allowed to know
 * which platforms exist. Everything else asks them. That was aspiration rather
 * than fact until recently — five wholly-Codeforces modules sat in shared
 * space (the signed API client, the scrape, its HTML parser, its HTTP client
 * and the start-time sync), `secure-store.js` hardcoded three platform ids and
 * their storage keys, `platform-icons.js` was a three-key map, and the settings
 * page imported all three adapters by name.
 *
 * ## The previous version of this file asserted almost nothing
 *
 * It had two independent scoping bugs, and passing green is what made them
 * expensive:
 *
 *   1. It read **one directory** — `readdirSync(CORE)`, files only — so
 *      `core/services/` and `core/ui/` were never examined at all.
 *   2. It recognised a violation by import **path shape**, `./platforms/<id>/…`.
 *      A platform-specific module living *outside* `platforms/` imports nothing
 *      shaped like that, so it was invisible by construction: the test could
 *      only flag the problem after the move that fixes it.
 *
 * So it read as "the boundary is enforced" while enforcing it one level deep,
 * which is worse than having no test — it discourages the look that finds this.
 *
 * ## What is asserted, and what that cannot catch
 *
 * By **imports** and by **names in code**, with comments stripped. The
 * stripping is essential rather than convenient: every shared module discusses
 * Codeforces, AtCoder and CodeChef in its prose — that is the domain — so
 * scanning raw text would fail on documentation and prove nothing about
 * coupling.
 *
 * The name check knows the platforms the registry knows, so a future
 * `core/services/somesite-api.js` is caught by the import rule but not by the
 * name rule. That is the honest limit of a string scan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { listPlatforms } from "../core/platforms/registry.js";
import { SECTIONS } from "../core/settings/schema.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CORE = path.join(ROOT, "core");
const PLATFORMS = path.join(CORE, "platforms");

/**
 * Named exceptions, each with the reason it is one.
 *
 * A single named entry rather than a directory-wide skip: an exception you have
 * to write down is a debt this test keeps visible, whereas the version being
 * replaced hid an entire subtree by accident.
 */
/**
 * Named exceptions, each with the reason it is one.
 *
 * A single named entry rather than a directory-wide skip: an exception you have
 * to write down is a debt this test keeps visible, whereas the version this
 * replaced hid an entire subtree by accident.
 *
 * **`stats-view.js` used to be the second entry and no longer is.** Its
 * `renderHint` counted Codeforces official contests with no
 * `publishedDataCheckedAt` and told you to press ↻ to fetch them. The add now
 * stamps that field, so the condition could never be true again and the advice
 * was false besides — the weekly re-check moved to `published-sync.js`, which
 * finds those contests on its own. It went, and the exception went with it.
 */
const ALLOWED = {
  "core/settings/schema.js":
    "The settings page is declared by hand, and verify.adapter has to name the " +
    "platform that runs each section's check. This is the third allowed " +
    "enumerator alongside registry.js, and for the same reason: " +
    "it is declarative data, not a branch. It is deliberately the *only* file " +
    "under core/settings/ with the exception — store.js and the options page " +
    "route by slug and by section, and still fail this test if they name a " +
    "platform. A section is a credential set rather than a platform, which is " +
    "what lets two Codeforces platforms share one key pair and one button.",
};

function sourceFiles(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Everything under core/ that is not a platform's own code. */
const sharedFiles = (extensions = [".js"]) =>
  sourceFiles(CORE, extensions)
    .filter((file) => !file.startsWith(PLATFORMS + path.sep))
    .map((file) => path.relative(ROOT, file));

const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

/** Prose about a platform is the domain; only code counts as coupling. */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const importsOf = (source) =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

/** One file per page — a platform may read any number. */
const PLATFORM_FOLDERS = new Set(["scrapers"]);

/**
 * Two words, each meaning one thing. A **site** is a host the extension talks
 * to: a folder with `site.js`, `sources.js`, its scrapers and its fit. A
 * **platform** is a registered kind of contest on a site: a folder whose
 * `platform.js` exports the class a registered instance was built from,
 * which is the site folder itself (AtCoder, CodeChef) or a direct child of it
 * (Codeforces' official/ and gyms/). Anything else is an offender.
 *
 * Classified once, at load, because most of the checks below need to know
 * where a platform lives without assuming its folder is named after its id.
 */
const { Platform } = await import("../core/platforms/platform.js");
const INSTANCES = listPlatforms();

/** Folders under core/platforms/ that could hold a site or a platform. */
function candidateDirs(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || PLATFORM_FOLDERS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    out.push(full, ...candidateDirs(full));
  }
  return out;
}

async function classifyFolders() {
  const sites = [];
  const platforms = new Map();
  const offenders = [];

  for (const dir of candidateDirs(PLATFORMS)) {
    const relative = path.relative(ROOT, dir);
    const names = readdirSync(dir);
    const isSite = names.includes("site.js");
    const hasClass = names.includes("platform.js");
    if (isSite) sites.push(relative);

    if (!hasClass) {
      if (!isSite) offenders.push(`${relative} is neither a site nor a platform`);
      continue;
    }

    const classes = Object.values(await import(path.join(dir, "platform.js"))).filter(
      (value) => typeof value === "function" && value.prototype instanceof Platform,
    );
    if (classes.length !== 1) {
      offenders.push(`${relative}/platform.js exports ${classes.length} Platform classes, expected one`);
      continue;
    }
    const builtFrom = INSTANCES.filter((instance) => instance.constructor === classes[0]);
    if (builtFrom.length !== 1) {
      offenders.push(`${relative}/platform.js exports ${classes[0].name}, which ${builtFrom.length} platforms are built from`);
      continue;
    }

    // A platform folder is its site, or a direct child of one.
    const siteDir = isSite ? dir : path.dirname(dir);
    if (!readdirSync(siteDir).includes("site.js") || (!isSite && path.dirname(siteDir) !== PLATFORMS)) {
      offenders.push(`${relative} is a platform folder but not a site or a direct child of one`);
      continue;
    }
    platforms.set(builtFrom[0].id, { folder: relative, site: path.relative(ROOT, siteDir) });
  }

  return { sites, platforms, offenders };
}

const FOLDERS = await classifyFolders();

/** Absolute folder of a registered platform's class. */
const folderOf = (id) => path.join(ROOT, FOLDERS.platforms.get(id).folder);

/** Absolute folder of the site a registered platform belongs to. */
const siteOf = (id) => path.join(ROOT, FOLDERS.platforms.get(id).site);

/** Every site folder, once. */
const siteFolders = () => FOLDERS.sites.map((folder) => path.join(ROOT, folder));

test("shared code covers the whole of core/, not just its top level", () => {
  const files = sharedFiles();

  // The bug in the previous version, asserted directly: if this test ever
  // stops seeing into subdirectories, it stops seeing anything worth seeing.
  for (const dir of ["core/services/", "core/ui/", "core/ui/views/"]) {
    assert.ok(
      files.some((file) => file.startsWith(dir)),
      `${dir} is not being scanned — the boundary is only being checked where it is easy`,
    );
  }
  assert.ok(files.length > 15, `only ${files.length} shared files found; the walk is not walking`);
});

test("nothing outside core/platforms/ imports a specific platform's code", () => {
  const offenders = [];

  for (const file of sharedFiles()) {
    for (const spec of importsOf(read(file))) {
      // registry.js is the agnostic entry point and is
      // exactly what shared code should be reaching for.
      if (/platforms\/(?!registry\.js)[^/]+\/.+/.test(spec)) {
        offenders.push(`${file} → ${spec}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "shared code must go through getPlatform()/getPlatform(), not reach into a platform folder",
  );
});

test("nothing outside core/platforms/ names a platform in code", () => {
  const ids = listPlatforms().map((platform) => platform.id);
  const pattern = new RegExp(`\\b(${ids.join("|")})\\b`, "i");
  const offenders = [];

  for (const file of sharedFiles([".js", ".html"])) {
    if (file in ALLOWED) continue;
    const code = stripComments(read(file));
    const hit = code.match(pattern);
    if (hit) offenders.push(`${file} mentions "${hit[0]}"`);
  }

  assert.deepEqual(offenders, [], "a platform's name in shared code is a branch waiting to happen");
});

test("nothing outside core/platforms/ uses a platform's subtype vocabulary", () => {
  // The leak with no platform name in it. "OFFICIAL", "GYM" and "ABC" are one
  // platform's language, so a shared file comparing contest.type to one of them
  // is coupled just as surely as if it had said "codeforces-official".
  const subtypes = listPlatforms().flatMap((platform) =>
    (platform.subtypes ?? []).map((subtype) => subtype.value),
  );
  const offenders = [];

  for (const file of sharedFiles()) {
    if (file in ALLOWED) continue;
    const code = stripComments(read(file));
    for (const value of subtypes) {
      if (code.includes(`"${value}"`)) offenders.push(`${file} uses "${value}"`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("every named exception is still doing work", () => {
  // An allowlist that has gone stale is a lie in the shape of a rule. If one of
  // these files has since been cleaned up, the entry has to go with it.
  const ids = listPlatforms().map((p) => p.id);
  const subtypes = listPlatforms().flatMap((p) => (p.subtypes ?? []).map((s) => s.value));

  for (const [file, reason] of Object.entries(ALLOWED)) {
    const code = stripComments(read(file));
    const stillCoupled =
      ids.some((id) => new RegExp(`\\b${id}\\b`, "i").test(code)) ||
      subtypes.some((value) => code.includes(`"${value}"`));

    assert.ok(
      stillCoupled,
      `${file} no longer names a platform — remove its exception rather than leaving it. Reason given: ${reason}`,
    );

    // And the id it names must be one that *exists*. The check above is an OR
    // over ids and subtypes, so a file whose id went stale kept passing on the
    // strength of its subtype — which is exactly what happened when Codeforces
    // became two platforms: stats-view.js still read "codeforces", matched no
    // platform, and its hint could never fire again. Silently, since a filter
    // that matches nothing renders nothing.
    for (const [, named] of code.matchAll(/\.id === "([a-z-]+)"/g)) {
      assert.ok(
        ids.includes(named),
        `${file} compares a platform id against "${named}", which is not registered — ` +
          `that condition can never be true`,
      );
    }
  }
});

test("a platform cannot half-register", () => {
  // Shared code now asks descriptors for things it used to hardcode — the
  // mark, the settings fields, the origins. A platform that declares none of
  // them would not error; it would render a section with no fields, a blank
  // chip where its mark goes, and quietly lose its host permission.
  for (const platform of listPlatforms()) {
    assert.equal(typeof platform.icon, "string", `${platform.id} declares no icon`);
    assert.ok(platform.icon.trim().length > 0, `${platform.id}'s icon is empty`);

    assert.ok(
      Array.isArray(platform.hostPermissions) && platform.hostPermissions.length > 0,
      `${platform.id} declares no hostPermissions, so the build would drop its origin`,
    );

  }
});

test("every settings section is complete, and can be verified", () => {
  // What `a platform cannot half-register` used to assert about a descriptor's
  // settingsFields. It moved with the fields themselves: a section is a
  // credential set, so a platform no longer declares one and two platforms can
  // share one. The failure modes are unchanged — a field with no `store` picks
  // a store by accident, and a secret written to the wrong one lands in the
  // exported backup.
  const ids = listPlatforms().map((platform) => platform.id);

  for (const section of SECTIONS) {
    assert.ok(section.slug && section.title, `a section is missing its slug or title`);
    assert.ok(section.fields?.length > 0, `${section.slug} declares no fields`);

    for (const field of section.fields) {
      assert.ok(field.slug && field.label && field.type, `${section.slug} has an incomplete field`);
      assert.ok(
        ["local", "secret"].includes(field.store),
        `${section.slug}'s ${field.slug} must say which store it belongs in`,
      );
    }

    assert.ok(
      ["change", "button"].includes(section.verify?.trigger),
      `${section.slug} declares no verify trigger`,
    );
    if (section.verify.trigger === "button") {
      assert.ok(section.verify.label, `${section.slug} wants a button without a label`);
    }

    // The one platform id on this page. A typo here is silent in a way the
    // others are not: getAdapter returns null and the button throws on click.
    assert.ok(
      ids.includes(section.verify.adapter),
      `${section.slug} verifies through "${section.verify.adapter}", which is not a registered platform`,
    );
  }
});

test("no two settings fields share a slug", () => {
  // A slug is the storage key, so a duplicate means one section silently reads
  // and overwrites another's value — and `fieldFor` would resolve it to
  // whichever was declared first, including its `store`.
  const slugs = SECTIONS.flatMap((section) => section.fields.map((field) => field.slug));
  assert.deepEqual(slugs, [...new Set(slugs)], "two settings fields share a slug");
});

test("the shared modules that need no imports still need none", () => {
  // rating-models/rasch is pure maths, queue-order pure comparison,
  // contest-status pure vocabulary. If one grows an import it has probably grown
  // a dependency on something platform-shaped, which is worth noticing.
  //
  // Note rating-models/rasch-upper-asymptote.js is deliberately absent: it imports
  // rasch.js, which is a dependency on maths rather than on anything platform-shaped.
  for (const name of [
    "rating-models/rasch.js",
    "rating-models/team-rating.js",
    "queue-order.js",
    "contest-status.js",
  ]) {
    assert.deepEqual(
      importsOf(read(path.join("core", name))),
      [],
      `${name} should stay dependency-free`,
    );
  }
});

test("the retired names survive nowhere", () => {
  const retired = [
    "saveCredentials",
    "loadCredentials",
    "HttpClient",
    "minGapMs",
    "start-time-service",
    "codeforces-service",
    "scraping-service",
    // The five per-platform reset seams, replaced by `platform.reset()`.
    "resetApiState",
    "resetHttpState",
    "CodeforcesHttp",
  ];
  const offenders = [];

  for (const file of sourceFiles(CORE, [".js"]).map((f) => path.relative(ROOT, f))) {
    const code = stripComments(read(file));
    for (const name of retired) {
      if (code.includes(name)) offenders.push(`${file} still uses ${name}`);
    }
  }

  assert.deepEqual(offenders, [], "a rename that lives on in one file is worse than none");
});

/**
 * Codeforces is one site folder registering two platforms. What the account
 * shares — identity, the submission stream, the signed client — is a base
 * class inside the same files; what the site publishes differently is each
 * platform's own class.
 */
test("every folder under core/platforms/ is a site or a platform of one, and the registry says which", () => {
  assert.deepEqual(FOLDERS.offenders, [], "a folder that is neither has nowhere to be");

  assert.deepEqual(
    [...FOLDERS.platforms.keys()].sort(),
    INSTANCES.map((platform) => platform.id).sort(),
    "every registered platform has exactly one folder",
  );
  assert.deepEqual([...FOLDERS.sites].sort(), ["core/platforms/atcoder", "core/platforms/codechef", "core/platforms/codeforces"]);

  // Every platform of a site took the site on: same origin, host permission
  // and mark, which is what `static site` and the spread in the base are for.
  for (const platform of INSTANCES) {
    const site = platform.constructor.site;
    assert.equal(platform.origin, site.origin, `${platform.id} does not carry its site's origin`);
    assert.deepEqual(platform.hostPermissions, site.hostPermissions, `${platform.id} does not carry its site's hostPermissions`);
    assert.equal(platform.icon, site.icon, `${platform.id} does not carry its site's icon`);
  }
});

/** A class's source text, from its declaration to its column-zero closing brace. */
function classBody(source, name) {
  const start = source.indexOf(`class ${name} `);
  assert.notEqual(start, -1, `${name} not found`);
  return source.slice(start, source.indexOf("\n}\n", start));
}

test("the official Codeforces platform reaches no HTML at all", () => {
  // The reason the split is worth having, asserted structurally rather than by
  // counting requests. An official add is pure JSON API: it cannot be
  // Cloudflare-challenged, and needs no tab open on codeforces.com. The two
  // platforms share a source, so this reads the official class's file: it
  // may not reach the page seam, the problems page or a scraper.
  const code = stripComments(readFileSync(path.join(folderOf("codeforces-official"), "platform.js"), "utf8"));
  const offenders = ["page(", "problemsPage", "scrapers/", "DOMParser"].filter((name) => code.includes(name));
  assert.deepEqual(offenders, [], "the official path must stay pure JSON API");
});

test("only the hidden-standings path reads HTML on Codeforces", () => {
  // Officially there is no HTML left at all, which the test above pins. On the
  // gym side one page survives: a gym whose standings the setter hid answers
  // FAILED to `contest.standings`, and the `/gym/<id>` problems page is the one
  // page those contests still render.
  //
  // This used to count importers of `http.js`. That file is gone — the client
  // lives on the platform's `Source` now — so it counts **page reads** instead,
  // which is what it was really about. A second one would mean a visible gym
  // had started scraping again, and no other test would notice: the result is
  // correct either way and only the request count differs.
  const sources = stripComments(
    readFileSync(path.join(siteOf("codeforces-gyms"), "sources.js"), "utf8"),
  );

  // Any method on the client, not `getDocument` specifically. Pinning the
  // method name is how this goes vacuous without failing: it was `.get` until
  // the client started answering with a parsed Document, at which point a
  // name-specific regex matches nothing and "exactly one page read" reads as
  // zero.
  // `this.page(...)` is the one way a page is read; the method's own
  // definition is `page(url)`, which this pattern does not match.
  const fetched = [...sources.matchAll(/\bthis\.page\(([^)]*)\)/g)].map((m) => m[1].trim());

  assert.equal(fetched.length, 1, `expected one page read, got ${fetched.length}`);
  assert.ok(
    !fetched[0].includes("standings"),
    `a standings page is being read again — a visible gym comes from the API: ${fetched[0]}`,
  );

});

test("a platform has estimator.js iff its descriptor claims canEstimate", () => {
  // Two declarations of one fact, in two places, and nothing but this makes
  // them agree. `contest-manager.js` reads `canEstimate` in exactly one place
  // to decide what a *gap* means: true, and a problem left unrated after the
  // estimator ran is a bug it refuses loudly on; false, and the same gap is a
  // problem the site has not rated, stored as `rating: null` and shown as
  // `???`. The Platform constructor refuses a class whose methods disagree
  // with the flag; this is the same fact at the level of files, which is where
  // a reader looks first. Two platforms sharing a site share its estimator,
  // so they must agree on the claim.
  const offenders = [];

  for (const platform of listPlatforms()) {
    const has = readdirSync(siteOf(platform.id)).includes("estimator.js");
    const claimed = platform.capabilities.canEstimate === true;
    if (has === claimed) continue;
    offenders.push(
      has
        ? `${platform.id} ships estimator.js but declares canEstimate: false`
        : `${platform.id} declares canEstimate: true but has no estimator.js`,
    );
  }

  assert.deepEqual(offenders, [], "the capability and the file are one fact");
});

test("an estimator is pure", async () => {
  // The split that makes every fit testable without a network stack: the
  // platform's `readField` reads the site and answers a status when it
  // cannot; estimator.js takes what it read and fits. An estimator that
  // imported a source, a client or its platform would be I/O and maths in one
  // function again, testable only by stubbing fetch.
  const offenders = [];
  let estimators = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    if (path.basename(file) !== "estimator.js") continue;
    const relative = path.relative(ROOT, file);
    const code = stripComments(readFileSync(file, "utf8"));
    estimators++;

    if (!Object.keys(await import(file)).includes("estimate")) offenders.push(`${relative} does not export estimate()`);
    for (const spec of importsOf(code)) {
      if (/(sources|site-client|platform)\.js$/.test(spec)) offenders.push(`${relative} imports ${spec}`);
    }
    if (/\bfetch\s*\(/.test(code)) offenders.push(`${relative} calls fetch()`);
  }

  assert.deepEqual(offenders, []);
  // Codeforces' base plus AtCoder's; the Codeforces pair share one fit.
  assert.equal(estimators, 2, `expected two estimators, found ${estimators}`);
});

test("nothing in a scrapers/ folder fetches", () => {
  // This one carries more weight than it used to. "Read" is the verb of I/O,
  // so the folder's name no longer says by itself that these never go and get
  // anything — a `scrapers/` file that opened a connection would read as
  // doing exactly what it says. This assertion is what keeps it unambiguous,
  // and it is the same objection that ruled out calling the folder scrapers/.
  // What the folder is for. Its files take a page the platform already has —
  // a `Document`, or the raw HTML string in the two `page-globals.js` — and
  // return values; the fetching lives one level up in `scraping.js` and
  // `http.js`. That separation is what lets every reader be exercised in Node
  // against `linkedom` with no network stack anywhere, which is most of the
  // coverage these platforms have.
  //
  // It is also the first thing a hurried change would break: reaching for the
  // client from inside a reader is the shortest path to "just fetch page two
  // here", and nothing else would notice, since the result is correct and only
  // the testability is gone.
  const clients = ["http.js", "api.js", "site-client.js", "scraping.js"];
  const offenders = [];
  const scrapers = [];

  for (const root of siteFolders()) {
    if (!readdirSync(root).includes("scrapers")) continue;

    for (const file of sourceFiles(path.join(root, "scrapers"), [".js"])) {
      const relative = path.relative(ROOT, file);
      const code = stripComments(readFileSync(file, "utf8"));
      scrapers.push(relative);

      for (const spec of importsOf(code)) {
        if (clients.some((name) => spec.endsWith(name))) {
          offenders.push(`${relative} imports ${spec}`);
        }
      }
      if (/\bfetch\s*\(/.test(code)) offenders.push(`${relative} calls fetch()`);
    }
  }

  assert.deepEqual(offenders, [], "a scraper takes a page, it does not go and get one");

  // Or the loop above proves nothing: a rename that emptied every folder would
  // pass it silently. Six files across three platforms, and codeforces-official
  // deliberately has none — it reads no HTML at all, which the test above pins
  // from the other direction.
  assert.equal(scrapers.length, 6, `expected six scrapers, found ${scrapers.join(", ")}`);
});

test("a site client routes through its own site", () => {
  // `createSiteClient({ site })` derives the tab-routing match patterns from the
  // site's `hostPermissions`. Naming the *wrong* site is the failure worth
  // pinning, because nothing else notices it: there is no matching tab, so
  // every request falls back to a direct fetch and still succeeds — it just
  // stops carrying the session, and only the session-gated routes break, the
  // same way they do when the user has no tab open. So the only `site` a
  // sources.js may hand the client is the one it imports from its own
  // `site.js`.
  //
  // A client with no `site` is deliberate in exactly one place: Codeforces'
  // signed API passes a direct `fetchImpl` instead, because it works
  // anonymously and routing it through a tab would add a dependency it does
  // not need. Anywhere else, a missing `site` is a direct fetch that quietly
  // stops carrying the session — which `createSiteClient` itself refuses.
  const offenders = [];
  const clients = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!code.includes("createSiteClient(")) continue;
    const relative = path.relative(ROOT, file);
    clients.push(relative);

    const importsOwnSite = /import\s*\{\s*site\s*\}\s*from\s*"\.\/site\.js"/.test(code);
    for (const call of code.split("createSiteClient(").slice(1)) {
      const head = call.slice(0, call.indexOf("refusal"));
      const routed = /\bsite\s*[,:]/.test(head);
      if (!routed && !head.includes("fetchImpl:")) offenders.push(`${relative} builds a client with neither a site nor a fetchImpl`);
      if (routed && !importsOwnSite) offenders.push(`${relative} routes through a site it did not import from ./site.js`);
      if (/\bsite:\s*(?!site\b)\w+/.test(head)) offenders.push(`${relative} routes through something other than its own site`);
    }
  }

  assert.deepEqual(offenders, [], "a client must speak to the site it belongs to");
  // Three files: AtCoder, CodeChef, and Codeforces, whose one sources.js builds
  // both the signed API client and the HTML client a hidden gym needs.
  assert.equal(clients.length, 3, `expected three site clients, found ${clients.join(", ")}`);
});

test("Codeforces signs in exactly one place", () => {
  // The duplication with a real failure mode used to be two copies of the
  // signing routine, pinned against each other. A wrong `apiSig` comes back as
  // an ordinary FAILED, so nothing else would notice a fix landing in one copy.
  // Now there is one, in the base, and this is what keeps a second from
  // growing back in a subclass.
  const signers = sourceFiles(PLATFORMS, [".js"])
    .filter((file) => /\b(_callMethod|_sha512)\s*\([^)]*\)\s*\{/.test(stripComments(readFileSync(file, "utf8"))))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(signers, ["core/platforms/codeforces/sources.js"]);
});

/**
 * The root of a platform folder is a closed set.
 *
 * `scrapers/` was the first half of this idea and was left half-done: HTML
 * readers got a folder, and everything else open-ended stayed loose at the
 * root, where you could not tell a contract file from that platform's own
 * invention. Nine names below are the contract. Anything a platform can have N
 * of belongs in a folder named for its kind, so `ls` answers which is which.
 *
 * It is not a style rule. A flat root let two names mislead for months, with
 * nothing to contradict them: `contest-submissions.js` sat beside
 * `submissions.js` doing something unrelated — everyone's submissions, to
 * rebuild a hidden-standings gym, against yours, to clear the queue — and
 * `solve-stats.js` returned a contest's name, problems, ratings, tags, start
 * time and phase, of which counts were one field. Both are now named for the
 * endpoint they read, inside `sources/`.
 */
const PLATFORM_ROOT_FILES = new Set([
  // Always: the registry's view, the contract with every decision and every
  // post-add pass, and the site's reads.
  "descriptor.js",
  "platform.js",
  "sources.js",
  // Where the platform estimates: the pure fit.
  "estimator.js",
]);

const SITE_FILES = new Set(["site.js", "sources.js", "platform.js", "estimator.js"]);
const CHILD_FILES = new Set(["platform.js"]);

test("a site's root holds only contract names, and a child platform's only its class", () => {
  const offenders = [];
  const children = new Set([...FOLDERS.platforms.values()].filter((p) => p.folder !== p.site).map((p) => p.folder));

  for (const folder of FOLDERS.sites) {
    const entries = readdirSync(path.join(ROOT, folder), { withFileTypes: true });
    if (!entries.some((e) => e.name === "sources.js")) offenders.push(`${folder} has no sources.js`);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!PLATFORM_FOLDERS.has(entry.name) && !children.has(`${folder}/${entry.name}`)) {
          offenders.push(`${folder}/${entry.name}/ is neither scrapers/ nor a platform of this site`);
        }
        continue;
      }
      if (!SITE_FILES.has(entry.name)) {
        offenders.push(`${folder}/${entry.name} is not a contract name — put it in scrapers/, or argue here for widening the root`);
      }
    }
  }

  for (const folder of children) {
    for (const entry of readdirSync(path.join(ROOT, folder), { withFileTypes: true })) {
      if (entry.isDirectory() || !CHILD_FILES.has(entry.name)) {
        offenders.push(`${folder}/${entry.name} — a platform under a site holds only its class`);
      }
    }
  }

  assert.deepEqual(offenders, [], "the root of a site folder is a closed set");
});

test("every scraper is one, by the definition rather than by folder", async () => {
  // `scrapers/` held six files that shared a folder and nothing else — some
  // exporting one extractor, some three, one keeping its selectors in a block
  // and the rest scattering them. This is the definition, asserted: one class
  // per page, `read` overridden, selectors declared in one place.
  //
  // The base's `read` throws rather than returning null on purpose, so a
  // subclass that forgets to override it fails loudly here and at runtime,
  // rather than reading as "this page never matches".
  const { Scraper } = await import("../core/platforms/scraper.js");
  const offenders = [];
  let scrapers = 0;

  for (const root of siteFolders()) {
    if (!readdirSync(root).includes("scrapers")) continue;

    for (const file of sourceFiles(path.join(root, "scrapers"), [".js"])) {
      const relative = path.relative(ROOT, file);
      scrapers++;

      const exported = Object.values(await import(file)).filter(
        (value) => typeof value === "function",
      );

      if (exported.length !== 1) {
        offenders.push(`${relative} exports ${exported.length} things, expected one class`);
        continue;
      }

      const scraper = exported[0];
      if (!(scraper.prototype instanceof Scraper)) {
        offenders.push(`${relative}'s ${scraper.name} does not extend Scraper`);
        continue;
      }
      if (scraper.scrape === Scraper.scrape) {
        offenders.push(`${relative}'s ${scraper.name} never overrides scrape()`);
      }
      if (Object.keys(scraper.selectors ?? {}).length === 0) {
        offenders.push(`${relative}'s ${scraper.name} declares no selectors`);
      }
    }
  }

  assert.deepEqual(offenders, [], "a scraper owns one page and says how it reads it");
  assert.equal(scrapers, 6, `expected six scrapers, found ${scrapers}`);
});

test("a sources.js exports one Source class, and at most a singleton of it", async () => {
  // What made "what do these have in common" hard to answer: one sources.js
  // exported a class and six free functions, another a singleton and a reset
  // seam, a third a constant. Everything a site's reads need is now on the
  // class — endpoints as methods, payload vocabulary as statics — so the file
  // is the class, plus the one instance a platform with no credentials keeps.
  const { Source } = await import("../core/platforms/source.js");
  const offenders = [];
  let checked = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"]).filter((f) => path.basename(f) === "sources.js")) {
    const relative = path.relative(ROOT, file);
    const exported = await import(file);
    checked++;

    const classes = Object.values(exported).filter(
      (value) => typeof value === "function" && value.prototype instanceof Source,
    );
    if (classes.length !== 1) {
      offenders.push(`${relative} exports ${classes.length} Source classes, expected one — a site has one set of routes`);
      continue;
    }

    for (const [name, value] of Object.entries(exported)) {
      if (value === classes[0]) continue;
      if (name === "sources" && value instanceof classes[0]) continue;
      offenders.push(`${relative} also exports ${name} — put it on the class, or in the module that owns it`);
    }
  }

  assert.deepEqual(offenders, []);
  assert.equal(checked, 3, `expected three sources.js, found ${checked}`);
});

test("a source singleton is reached through the session, never imported", () => {
  // The second idiom this removed. A platform's class attaches the singleton
  // to the session it builds; everything else reads `session.sources`, which
  // is the seam a test injects a fake through. A module that imported the
  // singleton instead would work in production and be untestable.
  const offenders = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    if (path.basename(file) === "platform.js") continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (/import\s*\{[^}]*\bsources\b[^}]*\}\s*from\s*"[^"]*sources\.js"/.test(code)) {
      offenders.push(`${path.relative(ROOT, file)} imports the sources singleton`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("a scraper is called only from a sources.js, so a platform never sees a Document", () => {
  // The rule that makes every folder read alike: a source answers routes — a
  // JSON endpoint, or a page handed to its scraper — and a platform decides
  // over what came back. AtCoder's class used to scrape the profile itself and
  // CodeChef's the dashboard, so the same kind of work sat in two places.
  const offenders = [];
  let importers = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!importsOf(code).some((spec) => spec.includes("/scrapers/"))) continue;
    importers++;
    if (path.basename(file) !== "sources.js") {
      offenders.push(`${path.relative(ROOT, file)} imports a scraper`);
    }
  }

  assert.deepEqual(offenders, [], "a scraper takes a page the source fetched; only the source calls it");
  assert.equal(importers, 3, `expected three sources to scrape, found ${importers}`);
});

test("a source never answers with a status", () => {
  // A status is a decision — wait, refuse, retry — and deciding is the
  // platform's. A source that imported the vocabulary would be deciding.
  const offenders = sourceFiles(PLATFORMS, [".js"])
    .filter((file) => path.basename(file) === "sources.js")
    .filter((file) => importsOf(stripComments(readFileSync(file, "utf8"))).some((spec) => spec.endsWith("contest-status.js")))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(offenders, []);
});

test("every platform declares its describing members first, in the base's order", async () => {
  // A platform is its own descriptor, and four classes read alike only if a
  // reader finds `matchUrl` in the same place in each: the members in
  // `DESCRIPTOR_MEMBERS` come first, in that order, and every hook after them.
  const { DESCRIPTOR_MEMBERS } = await import("../core/platforms/platform.js");
  const rank = new Map(DESCRIPTOR_MEMBERS.map((name, i) => [name, i]));
  const offenders = [];

  for (const platform of INSTANCES) {
    const source = stripComments(readFileSync(path.join(folderOf(platform.id), "platform.js"), "utf8"));
    const start = source.indexOf(`class ${platform.constructor.name} `);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const declared = [...body.matchAll(/^  (?:static\s+|async\s+)?(\w+)\s*[=(]/gm)].map((m) => m[1]);

    const describing = declared.filter((n) => rank.has(n));
    const sorted = [...describing].sort((a, b) => rank.get(a) - rank.get(b));
    if (describing.join() !== sorted.join()) offenders.push(`${platform.id}: ${describing.join(", ")}`);

    const firstHook = declared.findIndex((n) => !rank.has(n) && n !== "site" && n !== "Sources");
    const lastDescribing = declared.map((n) => rank.has(n)).lastIndexOf(true);
    if (firstHook !== -1 && lastDescribing > firstHook) {
      offenders.push(`${platform.id}: ${declared[lastDescribing]} is declared after the hook ${declared[firstHook]}`);
    }
  }

  assert.deepEqual(offenders, [], "describing members first, in DESCRIPTOR_MEMBERS order; hooks after");
});

test("DOMParser is constructed in exactly one place", () => {
  // What makes every reader testable in Node against linkedom: they take a
  // Document and never build one. It was three places until the two
  // `page-globals.js` stopped regexing raw HTML — those globals live in a
  // `<script>`, so they select it like anything else.
  const built = sourceFiles(CORE, [".js"])
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("new DOMParser"))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(built, ["core/services/site-client.js"]);
});
