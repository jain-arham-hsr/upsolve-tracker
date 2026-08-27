/**
 * `core/` is platform-agnostic; `core/platforms/<id>/` is where a platform's
 * own code lives. That was aspiration rather than fact until recently: three
 * wholly-Codeforces modules sat directly under `core/` — solve stats, the
 * rating distribution and the problemset sync — imported by nothing but the
 * Codeforces adapter.
 *
 * The cost was not tidiness. Sitting beside `queue-order.js` those files could
 * not say "codeforces" in their names without looking odd, and could not say
 * what they were without it, so they ended up with names like `get-prob-stats`
 * that described almost nothing.
 *
 * This asserts the boundary by **imports**, not by prose. Every module here
 * discusses Codeforces, AtCoder and CodeChef in its comments — that is the
 * domain — so scanning for platform names would fail on documentation and
 * prove nothing about coupling.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const CORE = new URL("../core", import.meta.url).pathname;

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

test("no module directly under core/ imports from a specific platform", () => {
  const offenders = [];

  for (const entry of readdirSync(CORE, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

    for (const spec of importsOf(path.join(CORE, entry.name))) {
      // `platforms/registry.js` and `platforms/adapters.js` are the agnostic
      // entry points and are exactly what shared code should be reaching for.
      if (/^\.\/platforms\/[^/]+\/.+/.test(spec)) {
        offenders.push(`${entry.name} → ${spec}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a platform-specific module belongs under core/platforms/<id>/, not core/",
  );
});

test("the shared modules that need no imports still need none", () => {
  // rating-estimator is pure maths, queue-order pure comparison, contest-status
  // pure vocabulary. If one of them grows an import, it has probably grown a
  // dependency on something platform-shaped, which is worth noticing.
  for (const name of [
    "rating-estimator.js",
    "queue-order.js",
    "contest-status.js",
  ]) {
    assert.deepEqual(
      importsOf(path.join(CORE, name)),
      [],
      `${name} should stay dependency-free`,
    );
  }
});
