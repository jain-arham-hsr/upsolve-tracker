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
const ALLOWED = {
  "core/ui/views/stats-view.js":
    "renderHint gates a tag-backfill hint on Codeforces official contests. It " +
    "looks dead — 0 of 68 tracked contests match — but pipeline.js still stores " +
    "publishedDataCheckedAt: null when a problemset sync does not complete, so " +
    "it can fire. Making it agnostic is not free: the honest condition is 'this " +
    "platform publishes bulk problem data', and simply dropping the id test " +
    "would catch Codeforces gyms, whose tags come from the standings instead — " +
    "so the hint's advice would be wrong for them.",

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
  // is coupled just as surely as if it had said "codeforces".
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
  for (const name of ["rating-models/rasch.js", "queue-order.js", "contest-status.js"]) {
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
