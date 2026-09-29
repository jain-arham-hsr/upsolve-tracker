/**
 * Everything outside `core/platforms/` is platform-agnostic, and this is what
 * says so.
 *
 * `registry.js` is the only module allowed to know
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

/**
 * Two words, each meaning one thing. A **site** is a host the extension talks
 * to: a folder with `site.js`, its `api.js`, its `scraper.js` where it reads
 * pages, and its fit where it estimates. A
 * **platform** is a registered kind of contest on a site: a folder whose
 * `platform.js` exports the class a registered instance was built from,
 * which is the site folder itself (AtCoder, CodeChef) or a direct child of it
 * (Codeforces' official/, gyms/ and group-contests/). Anything else is an offender.
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
    if (!entry.isDirectory()) continue;
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
    // others are not: getPlatform throws and the button reports it on click.
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

test("rating-models/ holds only the statistical models", () => {
  // The owner's rule for the folder: the two models and nothing else. The
  // team collapse and the strata shape lived here once, on the argument that
  // Codeforces' two platforms could not share a file — and drifted back into
  // `codeforces/api.js` the moment one file read every Codeforces field. A
  // helper that lands here again is Codeforces' maths wearing a shared name.
  assert.deepEqual(
    readdirSync(path.join(CORE, "rating-models")).sort(),
    ["rasch-upper-asymptote.js", "rasch.js"],
  );
});

/**
 * Exports that exist for the tests alone, each a seam rather than dead code:
 * a pure step CLAUDE.md documents as tested directly because it fails quietly,
 * or the storage key a test seeds. Anything else exported from a shared module
 * and unread by production is a leftover — `site-client.js#get()` survived the
 * `Api`/`Scraper` split that way, with nothing to notice it had lost its last
 * caller.
 */
const TEST_SEAMS = new Set([
  "progress-manager.js#applySolvedStatus",
  "services/platform-identity.js#classifyIdentity",
  "services/platform-identity.js#getStoredIdentity",
  "services/platform-identity.js#IDENTITY_STORAGE_KEY",
  "services/user-ratings.js#RATING_KEYS",
]);

test("every export of a shared module is read by production, or is a named test seam", () => {
  const shared = [...sourceFiles(CORE, [".js"])]
    .filter((file) => [CORE, path.join(CORE, "services")].includes(path.dirname(file)));
  const production = sourceFiles(CORE, [".js", ".html"])
    .concat(sourceFiles(path.join(ROOT, "targets"), [".js"]))
    .map((file) => [file, stripComments(readFileSync(file, "utf8"))]);
  const offenders = [];

  for (const file of shared) {
    const relative = path.relative(CORE, file);
    const code = stripComments(readFileSync(file, "utf8"));
    const names = [
      ...[...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]),
      ...[...code.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) =>
        m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean),
      ),
    ];

    for (const name of names) {
      if (TEST_SEAMS.has(`${relative}#${name}`)) continue;
      const read = production.some(([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text));
      if (!read) offenders.push(`${relative} exports ${name}, which nothing in production reads`);
    }
  }

  assert.deepEqual(offenders, [], "an export nobody reads is a leftover, or a seam that should be named above");
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
    // The three-layer split — transport, routes, payload readers, and a
    // folder of page classes — folded into one `api.js` and one `scraper.js`
    // per site, each owning its own client and its own reading.
    "sources.js",
    "payloads.js",
    "scrapers/",
    "Sources",
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

/** Every `api.js` and `scraper.js` under a site, with its kind. */
function siteReaders() {
  const out = [];
  for (const root of siteFolders()) {
    for (const name of ["api.js", "scraper.js"]) {
      const file = path.join(root, name);
      if (readdirSync(root).includes(name)) out.push({ file, kind: name, relative: path.relative(ROOT, file) });
    }
  }
  return out;
}

/**
 * The name and body of every `export function` in a file, matched by braces.
 * A parser has no template literal with a brace in it, so naive matching is
 * enough here; anything cleverer would be a parser of its own.
 */
function exportedFunctions(code) {
  const out = [];
  for (const match of code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
    let depth = 0;
    let i = code.indexOf("{", match.index);
    const start = i;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) break;
    }
    out.push({ name: match[1], body: code.slice(start, i + 1) });
  }
  return out;
}

test("the official Codeforces platform reaches no HTML at all", () => {
  // The reason the split is worth having, asserted structurally rather than by
  // counting requests. An official add is pure JSON API: it cannot be
  // Cloudflare-challenged, and needs no tab open on codeforces.com. The two
  // platforms share a site, so this reads the official class's file: it may
  // not name the scraper, read a page, or build a Document.
  const code = stripComments(readFileSync(path.join(folderOf("codeforces-official"), "platform.js"), "utf8"));
  const offenders = ["scraper", "Scraper", "document(", "DOMParser"].filter((name) => code.includes(name));
  assert.deepEqual(offenders, [], "the official path must stay pure JSON API");
});

test("only hidden-standings gyms and group contests read HTML on Codeforces", () => {
  // Officially there is no HTML left at all, which the test above pins. Two
  // pages survive. The `/gym/<id>` problems page, for a gym whose standings the
  // setter hid — `contest.standings` answers FAILED and that is the one page
  // those contests still render. And the standings page, for a group contest,
  // which the API cannot see at all: `contest.standings` and `contest.status`
  // both answer "not found" to a member's key.
  const scraper = stripComments(readFileSync(path.join(siteOf("codeforces-gyms"), "scraper.js"), "utf8"));

  // `this.document(...)` is the one way a page is read; the base's own
  // definition is `document(path, init)`, which this pattern does not match.
  const fetched = [...scraper.matchAll(/\bthis\.document\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.equal(fetched.length, 2, `expected two page reads, got ${fetched.length}`);

  // The standings read is for group contests alone. A visible gym reaching it
  // would be scraping again, and no other test would notice: the result is
  // correct either way and only the request count differs.
  const readers = ["codeforces-gyms", "codeforces-group-contests"].filter((id) =>
    stripComments(readFileSync(path.join(folderOf(id), "platform.js"), "utf8")).includes("standingsPage("),
  );
  assert.deepEqual(readers, ["codeforces-group-contests"], "only group contests read the standings page");
});

test("a site has estimator.js iff its platforms claim canEstimate", () => {
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

test("an estimator is only the fit: it imports the models and nothing else", async () => {
  // `core/rating-models/` is the maths with no site in it; `estimator.js` is
  // what a site does around it — its scale, its bounds, its policy for a
  // problem nobody solved. Which rows a field is read from is the API's
  // question, so an estimator that imported `api.js` would be reading again,
  // and one that imported a client would be I/O and maths in one function,
  // testable only by stubbing fetch.
  const offenders = [];
  let estimators = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    if (path.basename(file) !== "estimator.js") continue;
    const relative = path.relative(ROOT, file);
    const code = stripComments(readFileSync(file, "utf8"));
    estimators++;

    if (!Object.keys(await import(file)).includes("estimate")) offenders.push(`${relative} does not export estimate()`);
    for (const spec of importsOf(code)) {
      if (!spec.includes("/rating-models/")) offenders.push(`${relative} imports ${spec}`);
    }
    if (/\bfetch\s*\(/.test(code)) offenders.push(`${relative} calls fetch()`);
  }

  assert.deepEqual(offenders, []);
  assert.equal(estimators, 2, `expected two estimators, found ${estimators}`);
});

test("a parse* export takes a document or a payload and never fetches", () => {
  // The rule that keeps every parser runnable in Node against linkedom with
  // no network stack, which is most of the coverage these sites have. A
  // parser lives beside the route that fetches for it, in the same file, and
  // reaching for `this.client` from inside one is the shortest path to "just
  // fetch page two here" — nothing else would notice, since the result is
  // correct and only the testability is gone.
  const offenders = [];
  let parsers = 0;

  for (const { file, relative } of siteReaders()) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const { name, body } of exportedFunctions(code)) {
      if (!name.startsWith("parse")) continue;
      parsers++;
      for (const forbidden of ["fetch(", "this.", "client", "await "]) {
        if (body.includes(forbidden)) offenders.push(`${relative}#${name} contains "${forbidden}"`);
      }
    }
  }

  assert.deepEqual(offenders, [], "a parser takes what was fetched; it does not go and get it");
  // Or the loop above proves nothing: a rename that dropped the prefix from
  // every parser would pass it silently. Seven page parsers across three sites
  // plus CodeChef's difficulty sentinel reader.
  assert.equal(parsers, 8, `expected eight parse* exports, found ${parsers}`);
});

test("pages are read only in a scraper.js, and JSON only in an api.js", () => {
  // The two ways data arrives, kept to their two files. An `api.js` that read a
  // page, or a `platform.js` that did, would put page knowledge back where the
  // three-layer split used to have it; a `scraper.js` that read JSON would be
  // an API with the wrong name.
  const offenders = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const name = path.basename(file);
    const relative = path.relative(ROOT, file);
    const code = stripComments(readFileSync(file, "utf8"));

    if (name !== "scraper.js" && /\bgetDocument\b|\.document\(/.test(code)) {
      offenders.push(`${relative} reads a page — only a scraper.js does`);
    }
    if (name !== "api.js" && /\bgetJson\b|\.json\(/.test(code)) {
      offenders.push(`${relative} reads JSON — only an api.js does`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("a client is built in api.js or scraper.js, and routes through its own site", () => {
  // `createSiteClient({ site })` derives the tab-routing match patterns from the
  // site's `hostPermissions`. Naming the *wrong* site is the failure worth
  // pinning, because nothing else notices it: there is no matching tab, so
  // every request falls back to a direct fetch and still succeeds — it just
  // stops carrying the session, and only the session-gated routes break, the
  // same way they do when the user has no tab open. So the only `site` a
  // client may be handed is the one the file imports from its own `site.js`.
  //
  // Each of the two files owns its client: an API's is tuned for JSON routes,
  // a scraper's for pages, and on Codeforces they differ in every parameter.
  // A `platform.js` that built one would be transport and decision in one
  // place again. A client with no `site` is deliberate in exactly one place —
  // Codeforces' signed API passes a direct `fetchImpl`, because it works
  // anonymously and routing it through a tab would add a dependency it does
  // not need.
  const offenders = [];
  const clients = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!code.includes("createSiteClient(")) continue;
    const relative = path.relative(ROOT, file);
    if (!["api.js", "scraper.js"].includes(path.basename(file))) {
      offenders.push(`${relative} builds a client — only api.js and scraper.js do`);
      continue;
    }
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
  assert.equal(clients.length, 6, `expected six clients — two per site — found ${clients.join(", ")}`);
});

test("Codeforces signs in exactly one place, and it is the API", () => {
  // The duplication with a real failure mode used to be two copies of the
  // signing routine. A wrong `apiSig` comes back as an ordinary FAILED, so
  // nothing else would notice a fix landing in one copy. Now there is one, in
  // `codeforces/api.js` beside the routes it signs — and the hash is
  // constructed nowhere else under core/platforms/.
  const signers = sourceFiles(PLATFORMS, [".js"])
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("crypto.subtle"))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(signers, ["core/platforms/codeforces/api.js"]);
});

/**
 * The root of a site folder is a closed set.
 *
 * Five names, and a reader can tell from `ls` what a site does: `scraper.js`
 * present means it reads pages, `estimator.js` present means it estimates.
 * Where a site does not do the thing the file is simply absent, and the
 * absence says something too.
 *
 * It is not a style rule. A flat root once let two invented names mislead
 * for months, with nothing to contradict them: `contest-submissions.js` sat
 * beside `submissions.js` doing something unrelated, and `solve-stats.js`
 * returned a contest's name, problems, ratings, tags, start time and phase,
 * of which counts were one field.
 *
 * `CLAUDE.md` is the one widening, and it is not code: it is the site's own
 * documentation, which used to live in the root `CLAUDE.md` until that file
 * outgrew its size limit. A subdirectory's `CLAUDE.md` is loaded only when a
 * file in that directory is read, so putting each site's notes beside its code
 * is what keeps them in context exactly when they are relevant and out of it
 * otherwise. It says nothing about what the site *does*, which is the property
 * the rest of this set protects, and `.js` is still closed against invention.
 */
const SITE_FILES = new Set(["site.js", "api.js", "scraper.js", "estimator.js", "platform.js", "CLAUDE.md"]);
const SITE_REQUIRED = ["site.js", "api.js"];
const CHILD_FILES = new Set(["platform.js"]);

test("a site's root holds only contract names, and a child platform's only its class", () => {
  const offenders = [];
  const children = new Set([...FOLDERS.platforms.values()].filter((p) => p.folder !== p.site).map((p) => p.folder));

  for (const folder of FOLDERS.sites) {
    const entries = readdirSync(path.join(ROOT, folder), { withFileTypes: true });
    for (const required of SITE_REQUIRED) {
      if (!entries.some((e) => e.name === required)) offenders.push(`${folder} has no ${required}`);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!children.has(`${folder}/${entry.name}`)) {
          offenders.push(`${folder}/${entry.name}/ is not a platform of this site`);
        }
        continue;
      }
      if (!SITE_FILES.has(entry.name)) {
        offenders.push(`${folder}/${entry.name} is not a contract name — it belongs in api.js or scraper.js, or argue here for widening the root`);
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

test("an api.js is one Api class and its readers; a scraper.js one Scraper class and its parsers", async () => {
  // What each file may export, so "what do these have in common" has one
  // answer per kind. An `api.js`: exactly one `Api` subclass, at most one
  // instance of it named `api`, and otherwise functions and constants that
  // read a payload. A `scraper.js`: exactly one `Scraper` subclass, at most
  // one instance named `scraper`, and otherwise only `parse*` functions. And
  // each class answers the two statics itself rather than inheriting the
  // base's throw.
  const { Api } = await import("../core/platforms/api.js");
  const { Scraper } = await import("../core/platforms/scraper.js");
  const offenders = [];
  let apis = 0;
  let scrapers = 0;

  for (const { file, kind, relative } of siteReaders()) {
    const Base = kind === "api.js" ? Api : Scraper;
    const singleton = kind === "api.js" ? "api" : "scraper";
    const exported = await import(file);
    if (kind === "api.js") apis++;
    else scrapers++;

    const classes = Object.values(exported).filter(
      (value) => typeof value === "function" && value.prototype instanceof Base,
    );
    if (classes.length !== 1) {
      offenders.push(`${relative} exports ${classes.length} ${Base.name} classes, expected one`);
      continue;
    }
    const [Class] = classes;
    for (const member of ["fromSettings", "reset"]) {
      if (Class[member] === Base[member]) offenders.push(`${relative}'s ${Class.name} inherits static ${member}() rather than answering it`);
    }

    for (const [name, value] of Object.entries(exported)) {
      if (value === Class) continue;
      if (name === singleton && value instanceof Class) continue;
      if (typeof value === "function" && value.prototype instanceof Base) continue;
      if (kind === "scraper.js" && !(typeof value === "function" && name.startsWith("parse"))) {
        offenders.push(`${relative} also exports ${name} — a scraper.js exports its class, its instance and parse* functions only`);
      }
      if (kind === "api.js" && typeof value === "function" && value.prototype instanceof Object && /^[A-Z]/.test(name)) {
        offenders.push(`${relative} also exports the class ${name}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
  assert.equal(apis, 3, `expected three api.js, found ${apis}`);
  assert.equal(scrapers, 3, `expected three scraper.js, found ${scrapers}`);
});

test("a platform's static Api and Scraper are its site's classes", async () => {
  // The session is built from them, so a platform naming another site's
  // class would read the wrong site and every route would 404 politely.
  // And a site's scraper.js exists for a reason: at least one of its
  // platforms reads pages through it.
  const offenders = [];

  for (const platform of INSTANCES) {
    const site = siteOf(platform.id);
    const { Api: api, Scraper: scraper } = platform.constructor;
    const { [api?.name]: siteApi } = await import(path.join(site, "api.js"));
    if (siteApi !== api) offenders.push(`${platform.id}'s Api is not its site's api.js class`);

    const hasScraper = readdirSync(site).includes("scraper.js");
    if (scraper && !hasScraper) offenders.push(`${platform.id} declares a Scraper but its site has no scraper.js`);
    if (scraper && hasScraper) {
      const { [scraper.name]: siteScraper } = await import(path.join(site, "scraper.js"));
      if (siteScraper !== scraper) offenders.push(`${platform.id}'s Scraper is not its site's scraper.js class`);
    }
  }

  for (const folder of siteFolders()) {
    if (!readdirSync(folder).includes("scraper.js")) continue;
    const relative = path.relative(ROOT, folder);
    const readers = INSTANCES.filter((p) => siteOf(p.id) === folder && p.constructor.Scraper);
    if (readers.length === 0) offenders.push(`${relative}/scraper.js exists but no platform of the site declares it`);
  }

  assert.deepEqual(offenders, []);
});

test("a singleton is reached through the session, never imported", () => {
  // A platform's class names the singleton's class in `static Api`; the base
  // attaches the instance to the session it builds; everything else reads
  // `session.api` or `session.scraper`, which is the seam a test injects a
  // fake through. A module that imported the singleton instead would work in
  // production and be untestable.
  const offenders = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/import\s*\{[^}]*\b(api|scraper)\b[^}]*\}\s*from\s*"[^"]*(api|scraper)\.js"/.test(code)) {
      offenders.push(`${path.relative(ROOT, file)} imports a singleton`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("neither an api.js nor a scraper.js answers with a status", () => {
  // A status is a decision — wait, refuse, retry — and deciding is the
  // platform's. A reader that imported the vocabulary would be deciding.
  const offenders = siteReaders()
    .filter(({ file }) => importsOf(stripComments(readFileSync(file, "utf8"))).some((spec) => spec.endsWith("contest-status.js")))
    .map(({ relative }) => relative);

  assert.deepEqual(offenders, []);
});

test("every platform declares its describing members first, in the base's order", async () => {
  // A platform is its own descriptor, and four classes read alike only if a
  // reader finds `matchUrl` in the same place in each: the members in
  // `DESCRIPTOR_MEMBERS` come first, in that order, and every hook after them.
  const { DESCRIPTOR_MEMBERS } = await import("../core/platforms/platform.js");
  const rank = new Map(DESCRIPTOR_MEMBERS.map((name, i) => [name, i]));
  const statics = new Set(["site", "Api", "Scraper"]);
  const offenders = [];

  for (const platform of INSTANCES) {
    const source = stripComments(readFileSync(path.join(folderOf(platform.id), "platform.js"), "utf8"));
    const body = classBody(source, platform.constructor.name);
    const declared = [...body.matchAll(/^  (?:static\s+|async\s+)?(\w+)\s*[=(]/gm)].map((m) => m[1]);

    const describing = declared.filter((n) => rank.has(n));
    const sorted = [...describing].sort((a, b) => rank.get(a) - rank.get(b));
    if (describing.join() !== sorted.join()) offenders.push(`${platform.id}: ${describing.join(", ")}`);

    const firstHook = declared.findIndex((n) => !rank.has(n) && !statics.has(n));
    const lastDescribing = declared.map((n) => rank.has(n)).lastIndexOf(true);
    if (firstHook !== -1 && lastDescribing > firstHook) {
      offenders.push(`${platform.id}: ${declared[lastDescribing]} is declared after the hook ${declared[firstHook]}`);
    }
  }

  assert.deepEqual(offenders, [], "describing members first, in DESCRIPTOR_MEMBERS order; hooks after");
});

test("DOMParser is constructed in exactly one place", () => {
  // What makes every parser testable in Node against linkedom: they take a
  // Document and never build one. The string→Document step happens once, in
  // `site-client.js#getDocument`.
  const built = sourceFiles(CORE, [".js"])
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("new DOMParser"))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(built, ["core/services/site-client.js"]);
});
