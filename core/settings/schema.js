/**
 * The settings page, declared by hand.
 *
 * Every field has a **slug**, and anything anywhere reads a slug without
 * knowing who declared it — the shape WordPress uses, where
 * `add_settings_section` / `add_settings_field` describe the page and
 * `get_option('slug')` reads a value from anywhere.
 *
 * ## Why this is not generated from the descriptors any more
 *
 * It was, and the argument for that was real: adding a platform touched no file
 * here. But a section is a **credential set**, not a platform, and the two
 * stopped being the same thing the moment Codeforces became two platforms —
 * `codeforces-official` and `codeforces-gyms` are one account, one key pair,
 * one thing to fill in. Generating per platform would have asked for that key
 * pair twice, on a page where the two copies would then have to agree.
 *
 * The abstraction was also thinner than it looked: it spanned three sections
 * that are genuinely different — Codeforces wants a handle *and* a key pair
 * behind a button, the other two want a handle checked on change — so it was
 * abstracting over a difference rather than a similarity.
 *
 * ## This is the one file outside core/platforms/ that may name a platform
 *
 * `verify.adapter` has to name one, and `tests/module-boundaries.test.js`
 * allows it here for the same reason it allows `registry.js` and
 * `adapters.js`: a hand-authored page is declarative data, not a branch. The
 * exception is scoped to this file — `store.js` and the options page itself
 * stay agnostic, and the test still fails if either names a platform.
 *
 * **The slugs are the ones already in use**, so nothing stored had to move. A
 * typo in a `secret` slug is the one failure here that is silent: the value
 * comes back empty and reads as a setting you never saved. `npm run smoke`
 * checks exactly that.
 */

/**
 * @typedef {object} SettingsField
 * @property {string} slug   storage key, and the name every reader asks for
 * @property {string} label
 * @property {"local"|"secret"} store  chrome.storage.local, or IndexedDB —
 *   `secret` is what keeps a value out of the exported JSON backup
 * @property {"text"|"password"} type
 * @property {string} [placeholder]
 * @property {string} [help]  injected as trusted HTML; authored here, in this
 *   repo, which is the deliberate exception to the escaping rule
 */

export const SECTIONS = [
  {
    slug: "codeforces",
    title: "Codeforces",
    fields: [
      {
        slug: "upsolve_tracker.handle",
        label: "Handle",
        store: "local",
        type: "text",
        placeholder: "e.g., tourist",
        help: "Used to look up your accepted submissions.",
      },
      {
        slug: "api_key",
        label: "API key",
        store: "secret",
        type: "text",
        placeholder: "e.g., 70f9b...",
        help:
          'Generate a key pair at <a href="https://codeforces.com/settings/api" target="_blank" rel="noreferrer">codeforces.com/settings/api</a>, then paste both halves below. The pair is stored in this browser only, is used to sign requests to codeforces.com, and is kept out of the JSON backup on purpose.',
      },
      {
        slug: "api_secret",
        label: "API secret",
        store: "secret",
        type: "password",
        placeholder: "••••••••",
        help: "The secret half of the same key pair.",
      },
    ],

    /**
     * A button rather than verifying on change, because three fields have to be
     * filled before the check can mean anything — and a signed request fired
     * after each one would mostly be asking with an incomplete key pair.
     *
     * `adapter` names which platform runs the check, and is asserted against
     * the registry by `tests/module-boundaries.test.js` — a typo here is
     * otherwise silent, since `getAdapter` returns null and the button throws
     * only once pressed.
     *
     * Either Codeforces platform would do: they hold byte-identical copies of
     * `identity.js`, which `tests/module-boundaries.test.js` pins against each
     * other. This names official because that is the one most users configure
     * for.
     */
    verify: {
      trigger: "button",
      adapter: "codeforces-official",
      label: "Test connection",
      help: "Checks the handle and key against Codeforces before you rely on them.",
      incomplete: "Fill in all three fields first.",
    },
  },

  {
    slug: "atcoder",
    title: "AtCoder",
    fields: [
      {
        slug: "upsolve_tracker.atcoder_handle",
        label: "Handle",
        store: "local",
        type: "text",
        placeholder: "e.g., tourist",
        help: "No key needed — the handle alone reads which problems you have solved, directly from AtCoder.",
      },
    ],

    /** One field, so there is nothing to wait for before checking it. */
    verify: { trigger: "change", adapter: "atcoder" },
  },

  {
    slug: "codechef",
    title: "CodeChef",
    fields: [
      {
        slug: "upsolve_tracker.codechef_handle",
        label: "Handle",
        store: "local",
        type: "text",
        placeholder: "e.g., tourist",
        help:
          "No key needed. CodeChef answers for whoever is signed in at codechef.com, " +
          "so this handle is what that session gets checked against — if they don't " +
          "match, syncing stops rather than reading somebody else's solves.",
      },
    ],

    verify: { trigger: "change", adapter: "codechef" },
  },
];

/** Every field across every section, so a reader can resolve a slug alone. */
export const FIELDS = SECTIONS.flatMap((section) => section.fields);

/**
 * Where a slug is stored. Throws rather than guessing: an unknown slug means a
 * typo, and defaulting it to `local` would write a secret into the backup.
 */
export function fieldFor(slug) {
  const field = FIELDS.find((candidate) => candidate.slug === slug);
  if (!field) throw new Error(`No setting declared with slug "${slug}"`);
  return field;
}
