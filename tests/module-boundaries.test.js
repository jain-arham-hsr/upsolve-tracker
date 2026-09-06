/**
 * Everything outside `core/platforms/` is platform-agnostic, and this is what
 * says so.
 *
 * `registry.js` and `adapters.js` are the only two modules allowed to know
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
    "enumerator alongside registry.js and adapters.js, and for the same reason: " +
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
      // registry.js and adapters.js are the agnostic entry points and are
      // exactly what shared code should be reaching for.
      if (/platforms\/(?!registry\.js|adapters\.js)[^/]+\/.+/.test(spec)) {
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
 * Codeforces is two platforms in two folders with nothing between them.
 *
 * The three tests below are what keeps that true. Without them the split is a
 * convention, and a convention erodes on the first shortcut — the cheapest of
 * which is to reach sideways for something the other folder already has.
 */
const cfFolders = ["codeforces-official", "codeforces-gyms"];

test("the two Codeforces platforms do not import each other", () => {
  const offenders = [];

  for (const folder of cfFolders) {
    const other = cfFolders.find((candidate) => candidate !== folder);
    const dir = path.join(PLATFORMS, folder);

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

test("a folder under core/platforms/ has a descriptor iff it is registered", () => {
  // This is what stops a shared `codeforces-common/` reappearing between the
  // two: a folder with no descriptor is not a platform, and there is nowhere
  // else for one to sit. It also catches the opposite — a platform folder that
  // was written but never wired into registry.js, which would simply never run.
  //
  // Note this reads **one level only**, which is deliberate rather than an
  // oversight: `dom-parsers/` is a folder under a platform and has no
  // descriptor, so a recursive walk would fail it.
  const registered = new Set(listPlatforms().map((platform) => platform.id));
  const folders = readdirSync(PLATFORMS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const folder of folders) {
    const hasDescriptor = readdirSync(path.join(PLATFORMS, folder)).includes("descriptor.js");
    assert.equal(
      hasDescriptor,
      registered.has(folder),
      hasDescriptor
        ? `core/platforms/${folder}/ has a descriptor but is not in registry.js`
        : `core/platforms/${folder}/ is registered but has no descriptor.js`,
    );
  }

  assert.deepEqual(
    folders.slice().sort(),
    [...registered].sort(),
    "every platform folder is a registered platform, and vice versa",
  );
});

test("the official Codeforces platform reaches no HTML at all", () => {
  // The reason the split is worth having, asserted structurally rather than by
  // counting requests. An official add is pure JSON API: it cannot be
  // Cloudflare-challenged, and needs no tab open on codeforces.com.
  //
  // `tests/codeforces-adapter.test.js` asserts the same thing dynamically, by
  // failing if a request is issued while reaching the estimator. This one
  // catches the import before it can ever run.
  const forbidden = ["http.js", "scraping.js", "dom-parsers", "DOMParser"];
  const offenders = [];

  for (const file of sourceFiles(path.join(PLATFORMS, "codeforces-official"), [".js"])) {
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
  // So `http.js` must have exactly one importer, and it must be the module that
  // reads that page. A second importer would mean a visible gym had started
  // scraping again — which is what this change removed, and which no unit test
  // would otherwise notice, since the result is correct either way and only the
  // request count differs.
  // Scoped to the gym folder's own client: AtCoder has an `http.js` too, and
  // it is none of this test's business.
  const importers = sourceFiles(path.join(PLATFORMS, "codeforces-gyms"), [".js"])
    .filter((file) => importsOf(readFileSync(file, "utf8")).some((s) => s.endsWith("http.js")))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(importers, ["core/platforms/codeforces-gyms/scraping.js"]);

  const scraping = readFileSync(
    path.join(PLATFORMS, "codeforces-gyms", "scraping.js"),
    "utf8",
  );
  // Inspect the fetched URLs themselves, not the file. The import path used to
  // be `./standings-dom.js`, which read as a standings fetch and is half the
  // reason that file was renamed; keep measuring the URLs regardless, since the
  // next stale name will not announce itself either.
  // Any method on the client, not `get` specifically. Pinning the method name
  // is how this goes vacuous without failing: it was `.get` until the client
  // started answering with a parsed Document, at which point a name-specific
  // regex matches nothing and "exactly one page fetch" reads as zero.
  const fetched = [...stripComments(scraping).matchAll(/CodeforcesHttp\.\w+\(([^)]*)\)/g)]
    .map((m) => m[1].trim());

  assert.equal(fetched.length, 1, `expected one page fetch, got ${fetched.length}`);
  assert.ok(
    !fetched[0].includes("standings"),
    `a standings page is being fetched again — a visible gym is read from the API: ${fetched[0]}`,
  );
});

test("a platform has estimator.js iff its descriptor claims canEstimate", () => {
  // These are two declarations of one fact, in two files, and nothing made them
  // agree. `contest-manager.js` reads `canEstimate` in exactly one place to
  // decide what a *gap* means: true, and a problem left unrated after the
  // estimator ran is a bug it refuses loudly on; false, and the same gap is
  // simply a problem the site has not rated, stored as `rating: null` and shown
  // as `???`. So a platform claiming the capability with no estimator to run
  // would refuse every add, and one estimating without the claim would quietly
  // store `???` beside numbers it had already worked out.
  //
  // It holds on all four today, but only since AtCoder flipped — before that
  // AtCoder shipped an estimator and declared `false`, which is exactly the
  // half-migrated state this catches.
  const offenders = [];

  for (const platform of listPlatforms()) {
    const hasEstimator = readdirSync(path.join(PLATFORMS, platform.id)).includes("estimator.js");
    const claimed = platform.capabilities.canEstimate === true;
    if (hasEstimator === claimed) continue;

    offenders.push(
      hasEstimator
        ? `${platform.id} ships estimator.js but declares canEstimate: false`
        : `${platform.id} declares canEstimate: true but has no estimator.js`,
    );
  }

  assert.deepEqual(offenders, [], "the capability and the file are one fact");
});

test("nothing in a dom-parsers/ folder fetches", () => {
  // What the folder is for. Its files take a page the platform already has —
  // a `Document`, or the raw HTML string in the two `page-globals.js` — and
  // return values; the fetching lives one level up in `scraping.js` and
  // `http.js`. That separation is what lets every parser be exercised in Node
  // against `linkedom` with no network stack anywhere, which is most of the
  // coverage these platforms have.
  //
  // It is also the first thing a hurried change would break: reaching for the
  // client from inside a parser is the shortest path to "just fetch page two
  // here", and nothing else would notice, since the result is correct and only
  // the testability is gone.
  const clients = ["http.js", "api.js", "site-client.js", "scraping.js"];
  const offenders = [];
  const parsers = [];

  for (const platform of listPlatforms()) {
    const root = path.join(PLATFORMS, platform.id);
    if (!readdirSync(root).includes("dom-parsers")) continue;

    for (const file of sourceFiles(path.join(root, "dom-parsers"), [".js"])) {
      const relative = path.relative(ROOT, file);
      const code = stripComments(readFileSync(file, "utf8"));
      parsers.push(relative);

      for (const spec of importsOf(code)) {
        if (clients.some((name) => spec.endsWith(name))) {
          offenders.push(`${relative} imports ${spec}`);
        }
      }
      if (/\bfetch\s*\(/.test(code)) offenders.push(`${relative} calls fetch()`);
    }
  }

  assert.deepEqual(offenders, [], "a parser takes a page, it does not go and get one");

  // Or the loop above proves nothing: a rename that emptied every folder would
  // pass it silently. Six files across three platforms, and codeforces-official
  // deliberately has none — it reads no HTML at all, which the test above pins
  // from the other direction.
  assert.equal(parsers.length, 6, `expected six parsers, found ${parsers.join(", ")}`);
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

  for (const platform of listPlatforms()) {
    for (const file of sourceFiles(path.join(PLATFORMS, platform.id), [".js"])) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (!code.includes("createSiteClient(")) continue;

      const relative = path.relative(ROOT, file);
      clients.push(relative);

      const routed = /\bsite:\s*(\w+)/.exec(code)?.[1] ?? null;
      const own = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/descriptor\.js"/.exec(code)?.[1] ?? null;

      if (!routed) offenders.push(`${relative} builds a site client naming no site`);
      else if (routed !== own) {
        offenders.push(`${relative} routes through \`${routed}\`, not its own \`${own}\``);
      }
    }
  }

  assert.deepEqual(offenders, [], "a client must speak to the site it belongs to");

  // Or a rename could empty the loop and pass. Three: AtCoder, CodeChef, gyms —
  // codeforces-official has no site client, being pure signed JSON API.
  assert.equal(clients.length, 3, `expected three site clients, found ${clients.join(", ")}`);
});

/**
 * The two Codeforces folders duplicate three things on purpose, and until now
 * nothing checked that the copies still matched.
 *
 * They are separate platforms with no shared folder between them — that is the
 * design, and `codeforces-common/` is not coming back. What the design owes in
 * exchange is a guarantee that a fix landing in one copy lands in both, which
 * was previously discipline alone. Three comments in the tree claimed
 * `tests/codeforces-signing.test.js` provided it. No such file has ever
 * existed.
 */
const CF = ["codeforces-official", "codeforces-gyms"];

const bothCopies = (relative) =>
  CF.map((id) => readFileSync(path.join(PLATFORMS, id, relative), "utf8"));

for (const file of ["identity.js", "submissions.js"]) {
  test(`both Codeforces folders hold the same ${file}`, () => {
    // Byte-identical, comments included: one handle, one key pair, one settings
    // section, so there is nothing in either file that should differ. Anything
    // that ever *should* differ is a sign the file is doing too much.
    const [official, gyms] = bothCopies(file);

    assert.equal(
      official,
      gyms,
      `core/platforms/*/${file} are duplicated on purpose — change both, or ` +
        `move what diverged into the platform that needs it`,
    );
  });
}

test("both Codeforces clients share one signing implementation", () => {
  // The duplication with a real failure mode, per api.js's own header: a fix to
  // the signature applied to one file only. A wrong `apiSig` comes back as an
  // ordinary FAILED, so nothing else would notice.
  //
  // Scoped to the two signing methods rather than the whole file, because the
  // endpoint halves are genuinely different — official has the problemset and
  // the unsigned public standings, gyms has contest.status.
  const method = (source, name) => {
    const start = source.indexOf(`  async ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);

    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`${name} is unbalanced`);
  };

  const [official, gyms] = bothCopies("api.js");

  for (const name of ["_callMethod", "_sha512"]) {
    assert.equal(
      method(official, name),
      method(gyms, name),
      `${name} has drifted between the two Codeforces clients — change both`,
    );
  }
});

/**
 * The root of a platform folder is a closed set.
 *
 * `dom-parsers/` was the first half of this idea and was left half-done: HTML
 * parsers got a folder, and everything else open-ended stayed loose at the
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
  // Always.
  "descriptor.js",
  "identity.js",
  "problems.js",
  "submissions.js",
  // Where the platform estimates.
  "estimator.js",
  "field.js",
  // How it reaches the site.
  "api.js",
  "http.js",
  "scraping.js",
]);

/** One file per page / pass / endpoint — a platform may have any number. */
const PLATFORM_FOLDERS = new Set(["dom-parsers", "sync", "sources"]);

test("a platform's root holds only contract names", () => {
  const offenders = [];

  for (const platform of listPlatforms()) {
    for (const entry of readdirSync(path.join(PLATFORMS, platform.id), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        if (!PLATFORM_FOLDERS.has(entry.name)) {
          offenders.push(`${platform.id}/${entry.name}/ is not a known kind of folder`);
        }
        continue;
      }

      if (!PLATFORM_ROOT_FILES.has(entry.name)) {
        offenders.push(
          `${platform.id}/${entry.name} is not a contract name — put it in ` +
            `${[...PLATFORM_FOLDERS].join("/, ")}/, or say why it is a tenth root name`,
        );
      }
    }
  }

  assert.deepEqual(offenders, [], "the root of a platform folder is a closed set");
});

test("every parser is one, by the definition rather than by folder", async () => {
  // `dom-parsers/` held six files that shared a folder and nothing else — some
  // exporting one extractor, some three, one keeping its selectors in a block
  // and the rest scattering them. This is the definition, asserted: one class
  // per page, `parse` overridden, selectors declared in one place.
  //
  // The base's `parse` throws rather than returning null on purpose, so a
  // subclass that forgets to override it fails loudly here and at runtime,
  // rather than reading as "this page never matches".
  const { PageParser } = await import("../core/platforms/page-parser.js");
  const offenders = [];
  let parsers = 0;

  for (const platform of listPlatforms()) {
    const root = path.join(PLATFORMS, platform.id);
    if (!readdirSync(root).includes("dom-parsers")) continue;

    for (const file of sourceFiles(path.join(root, "dom-parsers"), [".js"])) {
      const relative = path.relative(ROOT, file);
      parsers++;

      const exported = Object.values(await import(file)).filter(
        (value) => typeof value === "function",
      );

      if (exported.length !== 1) {
        offenders.push(`${relative} exports ${exported.length} things, expected one class`);
        continue;
      }

      const parser = exported[0];
      if (!(parser.prototype instanceof PageParser)) {
        offenders.push(`${relative}'s ${parser.name} does not extend PageParser`);
        continue;
      }
      if (parser.parse === PageParser.parse) {
        offenders.push(`${relative}'s ${parser.name} never overrides parse()`);
      }
      if (Object.keys(parser.selectors ?? {}).length === 0) {
        offenders.push(`${relative}'s ${parser.name} declares no selectors`);
      }
    }
  }

  assert.deepEqual(offenders, [], "a parser owns one page and says how it reads it");
  assert.equal(parsers, 6, `expected six parsers, found ${parsers}`);
});

test("DOMParser is constructed in exactly one place", () => {
  // What makes every parser testable in Node against linkedom: they take a
  // Document and never build one. It was three places until the two
  // `page-globals.js` stopped regexing raw HTML — those globals live in a
  // `<script>`, so they select it like anything else.
  const built = sourceFiles(CORE, [".js"])
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("new DOMParser"))
    .map((file) => path.relative(ROOT, file));

  assert.deepEqual(built, ["core/services/site-client.js"]);
});
