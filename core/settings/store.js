/**
 * Reading and writing settings by slug.
 *
 * The two stores are an implementation detail of *where* a value is safe to
 * keep, not of what it means, so callers get one flat map and never have to
 * know that a Codeforces secret lives somewhere a handle does not. Routing is
 * driven entirely by each field's declared `store`, so this file names no
 * platform and none of it changes when one is added.
 */
import { readSecret, writeSecret } from "../services/secure-store.js";
import { SECTIONS, fieldFor } from "./schema.js";

/**
 * @param {string[]} slugs
 * @returns {Promise<Record<string, string|null>>} keyed by slug, missing
 *   values as `null` rather than absent — a caller checking truthiness should
 *   not have to also check presence.
 */
export async function getSettings(slugs) {
  const fields = slugs.map(fieldFor);

  const localSlugs = fields.filter((f) => f.store === "local").map((f) => f.slug);
  const stored = localSlugs.length ? await chrome.storage.local.get(localSlugs) : {};

  const entries = await Promise.all(
    fields.map(async (field) => [
      field.slug,
      field.store === "secret" ? await readSecret(field.slug) : (stored[field.slug] ?? null),
    ]),
  );

  return Object.fromEntries(entries);
}

/** The write half, routing each slug to the store its field declared. */
export async function writeSettings(values) {
  const local = {};
  const writes = [];

  for (const [slug, value] of Object.entries(values)) {
    const field = fieldFor(slug);
    if (field.store === "secret") writes.push(writeSecret(slug, value ?? ""));
    else local[slug] = value ?? "";
  }

  if (Object.keys(local).length) writes.push(chrome.storage.local.set(local));
  await Promise.all(writes);
}

/** Every value in one section, keyed by slug. */
export const readSection = (section) =>
  getSettings(section.fields.map((field) => field.slug));

/**
 * True once *any* section has every field it needs — owner-only ones aside.
 *
 * A section is a credential set, so this asks whether *something* can sync —
 * not whether every platform can. It previously demanded Codeforces
 * credentials, so someone using only AtCoder, which needs none, was shown a
 * setup prompt and a refresh button that looked broken.
 */
export async function hasCompleteSetup() {
  // A section is usable once every field it cannot do without is filled;
  // owner-only ones — the Codeforces key pair — are not asked for.
  const filled = await Promise.all(
    SECTIONS.map(async (section) => {
      const values = await readSection(section);
      return section.fields.filter((field) => !field.ownerOnly).every((field) => values[field.slug]);
    }),
  );
  return filled.some(Boolean);
}
