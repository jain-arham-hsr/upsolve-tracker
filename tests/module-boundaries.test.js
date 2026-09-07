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
    "enumerator alongside registry.js and platforms.js, and for the same reason: " +
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

/** One file per page / pass — a platform may have any number of each. */
const PLATFORM_FOLDERS = new Set(["scrapers", "sync"]);

/**
 * Every folder under core/platforms/ is one of two things, and platforms.js is
 * what says which. A **platform folder** is one whose platform.js exports the
 * class a registered instance was built from. A **base folder** is one whose
 * platform.js exports a class at least two registered instances extend and
 * none is built from — codeforces/ is the one there is. Anything else is an
 * offender: a folder with no platform.js, a class nobody registers or extends.
 *
 * Classified once, at load, because most of the checks below need to know
 * where a platform lives without assuming its folder is named after its id.
 */
const { getAdapter } = await import("../core/platforms/platforms.js");
const { Platform } = await import("../core/platforms/platform.js");
const INSTANCES = listPlatforms().map((platform) => getAdapter(platform.id));

/** Folders under core/platforms/ that could hold a platform or a base. */
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
  const platforms = new Map();
  const bases = [];
  const baseClasses = new Map();
  const offenders = [];

  for (const dir of candidateDirs(PLATFORMS)) {
    const relative = path.relative(ROOT, dir);
    if (!readdirSync(dir).includes("platform.js")) {
      offenders.push(`${relative} has no platform.js`);
      continue;
    }

    const classes = Object.values(await import(path.join(dir, "platform.js"))).filter(
      (value) => typeof value === "function" && value.prototype instanceof Platform,
    );
    if (classes.length !== 1) {
      offenders.push(`${relative}/platform.js exports ${classes.length} Platform classes, expected one`);
      continue;
    }

    const [cls] = classes;
    const builtFrom = INSTANCES.filter((instance) => instance.constructor === cls);
    const extending = INSTANCES.filter(
      (instance) => instance instanceof cls && instance.constructor !== cls,
    );

    if (builtFrom.length === 1 && extending.length === 0) platforms.set(builtFrom[0].id, relative);
    else if (builtFrom.length === 0 && extending.length >= 2) {
      bases.push(relative);
      baseClasses.set(relative, cls);
    }
    else {
      offenders.push(
        `${relative}/platform.js: ${cls.name} is built by ${builtFrom.length} platform(s) ` +
          `and extended by ${extending.length} — neither a platform nor a base`,
      );
    }
  }

  return { platforms, bases, baseClasses, offenders };
}

const FOLDERS = await classifyFolders();

/** Absolute folder of a registered platform. */
const folderOf = (id) => path.join(ROOT, FOLDERS.platforms.get(id));

/** A platform's own folder, then every base folder it inherits from. */
const foldersOf = (id) => [
  folderOf(id),
  ...[...FOLDERS.baseClasses]
    .filter(([, cls]) => getAdapter(id) instanceof cls)
    .map(([folder]) => path.join(ROOT, folder)),
];

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
      // registry.js and platforms.js are the agnostic entry points and are
      // exactly what shared code should be reaching for.
      if (/platforms\/(?!registry\.js|platforms\.js)[^/]+\/.+/.test(spec)) {
        offenders.push(`${file} → ${spec}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "shared code must go through getAdapter()/getPlatform(), not reach into a platform folder",
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
 * Codeforces is two platforms over one base folder. What the account shares —
 * identity, the submission stream, the signed client — is inherited from
 * `codeforces/`; what the site publishes differently stays in each platform.
 * They import the base and never each other.
 */
const cfFolders = ["codeforces-official", "codeforces-gyms"];

test("the two Codeforces platforms do not import each other", () => {
  const offenders = [];

  for (const folder of cfFolders) {
    const other = cfFolders.find((candidate) => candidate !== folder);
    const dir = folderOf(folder);

    for (const file of sourceFiles(dir, [".js"])) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (spec.includes(other)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "the folders share an account, not code — duplicate it or lift it to core/",
  );
});

test("every folder under core/platforms/ is a platform or a base, and platforms.js says which", () => {
  assert.deepEqual(FOLDERS.offenders, [], "a folder that is neither has nowhere to be");

  assert.deepEqual(
    [...FOLDERS.platforms.keys()].sort(),
    listPlatforms().map((platform) => platform.id).sort(),
    "every registered platform has exactly one folder, and every platform folder is registered",
  );

  // A platform folder carries its descriptor; a base carries none, since a
  // base is not a platform and the registry must not be able to list it.
  for (const [id, folder] of FOLDERS.platforms) {
    assert.ok(readdirSync(path.join(ROOT, folder)).includes("descriptor.js"), `${id} has no descriptor.js`);
  }
  for (const folder of FOLDERS.bases) {
    assert.ok(
      !readdirSync(path.join(ROOT, folder)).includes("descriptor.js"),
      `${folder} is a base folder and must not carry a descriptor of its own`,
    );
  }

  // Or a base could quietly become a platform, or vice versa, and pass.
  assert.deepEqual(FOLDERS.bases, ["core/platforms/codeforces"]);
});

test("the official Codeforces platform reaches no HTML at all", () => {
  // The reason the split is worth having, asserted structurally rather than by
  // counting requests. An official add is pure JSON API: it cannot be
  // Cloudflare-challenged, and needs no tab open on codeforces.com.
  //
  // `tests/codeforces-adapter.test.js` asserts the same thing dynamically, by
  // failing if a request is issued while reaching the estimator. This one
  // catches the import before it can ever run.
  // Keyed on what is still observable. It used to list `http.js` and
  // `scraping.js` too, which worked only while a file name told you which kind
  // of site a platform talked to; with one `sources.js` everywhere, it does
  // not. What remains is exact: an official add reaches no markup, so it
  // imports nothing from a `scrapers/` folder and constructs no `DOMParser`.
  const forbidden = ["scrapers", "DOMParser"];
  const offenders = [];

  for (const file of sourceFiles(folderOf("codeforces-official"), [".js"])) {
    const relative = path.relative(ROOT, file);
    const code = stripComments(readFileSync(file, "utf8"));

    for (const name of forbidden) {
      if (importsOf(code).some((spec) => spec.endsWith(name)) || code.includes(name)) {
        offenders.push(`${relative} uses ${name}`);
      }
    }
  }

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
    readFileSync(path.join(folderOf("codeforces-gyms"), "sources.js"), "utf8"),
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

  // And the official half reads no page at all, which is why it has no
  // `scrapers/` folder to go with it.
  assert.ok(
    !readdirSync(folderOf("codeforces-official")).includes("scrapers"),
    "codeforces-official grew a scrapers/ folder — it should read no HTML",
  );
});

test("a platform has field.js and estimator.js iff its descriptor claims canEstimate", () => {
  // Two declarations of one fact, in two places, and nothing but this makes
  // them agree. `contest-manager.js` reads `canEstimate` in exactly one place
  // to decide what a *gap* means: true, and a problem left unrated after the
  // estimator ran is a bug it refuses loudly on; false, and the same gap is a
  // problem the site has not rated, stored as `rating: null` and shown as
  // `???`. The Platform constructor refuses a class whose methods disagree
  // with the flag; this is the same fact at the level of files, which is where
  // a reader looks first — and the files may sit in a base folder, as the
  // Codeforces estimator does.
  const offenders = [];

  for (const platform of listPlatforms()) {
    const has = (name) => foldersOf(platform.id).some((dir) => readdirSync(dir).includes(name));
    const claimed = platform.capabilities.canEstimate === true;

    for (const file of ["field.js", "estimator.js"]) {
      if (has(file) === claimed) continue;
      offenders.push(
        has(file)
          ? `${platform.id} ships ${file} but declares canEstimate: false`
          : `${platform.id} declares canEstimate: true but has no ${file}`,
      );
    }
  }

  assert.deepEqual(offenders, [], "the capability and the files are one fact");
});

test("an estimator is pure, and a field is where the reading happens", async () => {
  // The split that makes every fit testable without a network stack: field.js
  // reads the site and answers a status when it cannot; estimator.js takes
  // what it read and fits. An estimator that imported a source, a client or
  // its own field.js would be the old shape back — I/O and maths in one
  // function, testable only by stubbing fetch.
  const offenders = [];
  let estimators = 0;
  let fields = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    const relative = path.relative(ROOT, file);
    const name = path.basename(file);
    if (name !== "estimator.js" && name !== "field.js") continue;

    const code = stripComments(readFileSync(file, "utf8"));
    const exported = Object.keys(await import(file));

    if (name === "estimator.js") {
      estimators++;
      if (!exported.includes("estimate")) offenders.push(`${relative} does not export estimate()`);
      for (const spec of importsOf(code)) {
        if (/(sources|site-client|field)\.js$/.test(spec)) offenders.push(`${relative} imports ${spec}`);
      }
      if (/\bfetch\s*\(/.test(code)) offenders.push(`${relative} calls fetch()`);
    } else {
      fields++;
      // A base folder's field.js holds what the platforms' fields share, and
      // is not itself a field; only a platform's own must read.
      const inPlatform = [...FOLDERS.platforms.values()].some((folder) => relative.startsWith(folder + "/"));
      if (inPlatform && !exported.includes("readField")) offenders.push(`${relative} does not export readField()`);
    }
  }

  assert.deepEqual(offenders, []);
  // Codeforces' base plus AtCoder's; three platforms read a field of their own
  // and the Codeforces pair share what happens below the handles.
  assert.equal(estimators, 2, `expected two estimators, found ${estimators}`);
  assert.equal(fields, 4, `expected four field modules, found ${fields}`);
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

  for (const platform of listPlatforms()) {
    const root = folderOf(platform.id);
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

test("a site client routes through its own platform's descriptor", () => {
  // `createSiteClient({ site })` derives the tab-routing match patterns from the
  // descriptor's `hostPermissions`, which replaced three platforms each spelling
  // out `createPageFetch({ matchPatterns: X.hostPermissions })`.
  //
  // Naming the *wrong* descriptor is the failure worth pinning, because nothing
  // else notices it. There is no matching tab, so every request falls back to a
  // direct fetch and still succeeds — it just stops carrying the session, so
  // only the session-gated routes break, and they break exactly the way they do
  // when the user has no tab open, which is a supported state that reports
  // itself politely. Confirmed by pointing AtCoder's client at Codeforces:
  // all 420 tests stayed green.
  //
  // A missing `site` throws from `createSiteClient` itself, so that half needs
  // no test here.
  const offenders = [];
  const clients = [];

  for (const file of sourceFiles(PLATFORMS, [".js"])) {
    {
      const code = stripComments(readFileSync(file, "utf8"));
      if (!code.includes("createSiteClient(")) continue;

      const relative = path.relative(ROOT, file);
      clients.push(relative);

      const routed = /\bsite:\s*(\w+)/.exec(code)?.[1] ?? null;
      const own = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/descriptor\.js"/.exec(code)?.[1] ?? null;

      // A client with no `site` is deliberate in exactly one place: Codeforces'
      // signed API passes a direct `fetchImpl` instead, because it works
      // anonymously and routing it through a tab would add a dependency it does
      // not need. Anywhere else, a missing `site` is the silent bug this test
      // exists for — a direct fetch that quietly stops carrying the session.
      if (!routed) {
        if (!code.includes("fetchImpl:")) {
          offenders.push(`${relative} builds a site client with neither a site nor a fetchImpl`);
        }
        continue;
      }
      if (routed !== own) {
        offenders.push(`${relative} routes through \`${routed}\`, not its own \`${own}\``);
      }
    }
  }

  assert.deepEqual(offenders, [], "a client must speak to the site it belongs to");

  // Or a rename could empty the loop and pass. Four: AtCoder, CodeChef, the
  // signed Codeforces API in its base, and the HTML client a hidden gym needs.
  assert.equal(clients.length, 4, `expected four site clients, found ${clients.join(", ")}`);
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
  // Always: the registry's view, the contract, and the site's reads.
  "descriptor.js",
  "platform.js",
  "sources.js",
  // Where the platform estimates.
  "estimator.js",
  "field.js",
]);

/**
 * A base folder is a platform folder minus the descriptor — plus `site.js`,
 * the pieces of a descriptor its platforms share, which the registry never
 * sees directly.
 */
const REQUIRED = { platform: ["descriptor.js", "platform.js", "sources.js"], base: ["platform.js", "sources.js"] };
const BASE_ONLY_FILES = new Set(["site.js"]);

test("a platform's root holds only contract names", () => {
  const offenders = [];
  const folders = [
    ...[...FOLDERS.platforms.values()].map((folder) => [folder, "platform"]),
    ...FOLDERS.bases.map((folder) => [folder, "base"]),
  ];

  for (const [folder, kind] of folders) {
    const entries = readdirSync(path.join(ROOT, folder), { withFileTypes: true });
    const names = entries.map((entry) => entry.name);

    for (const required of REQUIRED[kind]) {
      if (!names.includes(required)) offenders.push(`${folder} has no ${required}`);
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // A base may hold its platforms' folders; a platform may not.
        const isPlatform = FOLDERS.platforms.has(
          [...FOLDERS.platforms].find(([, f]) => f === `${folder}/${entry.name}`)?.[0],
        );
        if (!PLATFORM_FOLDERS.has(entry.name) && !(kind === "base" && isPlatform)) {
          offenders.push(`${folder}/${entry.name}/ is not a known kind of folder`);
        }
        continue;
      }

      if (kind === "base" && BASE_ONLY_FILES.has(entry.name)) continue;
      if (!PLATFORM_ROOT_FILES.has(entry.name)) {
        offenders.push(
          `${folder}/${entry.name} is not a contract name — put it in ` +
            `${[...PLATFORM_FOLDERS].map((f) => `${f}/`).join(" or ")}, or argue ` +
            `here for widening the root`,
        );
      }
    }
  }

  assert.deepEqual(offenders, [], "the root of a platform folder is a closed set");
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

  for (const platform of listPlatforms()) {
    const root = folderOf(platform.id);
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

    const classes = Object.entries(exported).filter(
      ([, value]) => typeof value === "function" && value.prototype instanceof Source,
    );
    if (classes.length !== 1) {
      offenders.push(`${relative} exports ${classes.length} Source classes, expected one`);
      continue;
    }
    const [, cls] = classes[0];

    for (const [name, value] of Object.entries(exported)) {
      if (value === cls) continue;
      if (name === "sources" && value instanceof cls) continue;
      offenders.push(`${relative} also exports ${name} — put it on the class, or in the module that owns it`);
    }
  }

  assert.deepEqual(offenders, []);
  assert.equal(checked, 5, `expected five sources.js, found ${checked}`);
});

test("a sync pass exports sync(session, contests, onProgress) and nothing else", async () => {
  // Four passes took four argument lists — the client first, or not at all.
  // One shape, so `syncMetadata` composes them without knowing which is which.
  const offenders = [];
  let checked = 0;

  for (const file of sourceFiles(PLATFORMS, [".js"]).filter((f) => path.basename(path.dirname(f)) === "sync")) {
    const relative = path.relative(ROOT, file);
    const exported = Object.keys(await import(file));
    checked++;

    if (exported.length !== 1 || exported[0] !== "sync") {
      offenders.push(`${relative} exports ${exported.join(", ") || "nothing"}, expected exactly sync`);
    }
    const code = stripComments(readFileSync(file, "utf8"));
    if (!/export\s+async\s+function\s+sync\s*\(\s*session\s*,\s*contests\s*,\s*onProgress\b/.test(code)) {
      offenders.push(`${relative}'s sync() does not take (session, contests, onProgress)`);
    }
  }

  assert.deepEqual(offenders, []);
  assert.equal(checked, 5, `expected five sync passes, found ${checked}`);
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
