/**
 * The settings page.
 *
 * It knows about *sections and fields*, never about platforms. Sections come
 * from `core/settings/schema.js`, and the only platform id involved is
 * `section.verify.adapter` — a string handed straight to `getPlatform()` and
 * never read here. So this file stays agnostic even though the schema it
 * renders is hand-written.
 *
 * A section is a **credential set** rather than a platform, which is what lets
 * two Codeforces platforms share one key pair and one "Test connection" button
 * instead of rendering the same three fields twice.
 *
 * The verdicts are the adapters' own words. This page used to compose its own
 * for CodeChef — re-checking `session.signedIn` and writing a "signed out"
 * message that `verifyIdentity` already produces — so the same condition read
 * differently here and in the queue's status strip. One message, one author.
 */
import { getPlatform } from "../../platforms/registry.js";
import { reconcileOnSignIn, resetCloudState, saveToCloud } from "../../services/cloud-sync.js";
import { chooseQueue } from "../choose-queue.js";
import {
  isAccountConfigured,
  isSignedIn,
  signIn,
  signOut,
  watchSignIn,
  whoAmI,
} from "../../services/account.js";
import { renderGoogleButton } from "../google-button.js";
import { SECTIONS } from "../../settings/schema.js";
import { readSection, writeSettings } from "../../settings/store.js";
import { renderSettingsSections, describeIdentity } from "./sections.js";


document.addEventListener("DOMContentLoaded", async () => {
  if (isAccountConfigured() && !(await settleGate())) return;
  document.getElementById("settings-body").classList.remove("hidden");
  await openSettings();
});

/**
 * Settings are stored in the account with the queue, so a signed-out page has
 * none of its own: it shows a sign-in prompt and nothing else — no fields, no
 * checks against the sites, no Save.
 *
 * The page follows sign-in changes made anywhere, the panel included, by
 * reloading: every field on it is read once on load, and a reload is the one
 * way to guarantee none of them shows a value from before the change. A build
 * with no Firebase configured cannot sign in, so it opens without this.
 *
 * @returns {Promise<boolean>} whether to open the settings
 */
async function settleGate() {
  let signedIn = false;
  try {
    signedIn = await isSignedIn();
  } catch (error) {
    console.info("[settings] couldn't read the session:", error.message);
  }

  // Mid sign-in, the page reloads once the queue is reconciled, not the moment
  // Firebase reports the account — a reload then would abandon the reconcile.
  let signingIn = false;
  await watchSignIn(async () => {
    if (signingIn) return;
    if ((await isSignedIn()) !== signedIn) location.reload();
  });
  if (signedIn) return true;

  const gate = document.getElementById("signin-gate");
  const button = document.getElementById("btn-signin");
  const status = document.getElementById("signin-gate-status");
  const say = (message, failed = false) => {
    status.textContent = message;
    status.classList.toggle("hidden", message === "");
    status.classList.toggle("failure", failed);
  };

  renderGoogleButton(button);
  gate.classList.remove("hidden");
  button.addEventListener("click", async () => {
    signingIn = true;
    button.disabled = true;
    try {
      say("Signing in…");
      await signIn();
      say("Syncing your queue…");
      await reconcileOnSignIn({ choose: chooseQueue });
      location.reload();
    } catch (error) {
      // Closing Google's prompt lands here too, and its own wording says so.
      say(`✕ ${error.message}`, true);
      signingIn = false;
      button.disabled = false;
    }
  });
  return false;
}

async function openSettings() {
  const mount = document.getElementById("settings-sections");
  mount.innerHTML = renderSettingsSections(SECTIONS);

  const saveBtn = document.getElementById("save-btn");
  const saveMsg = document.getElementById("save-msg");

  const inputFor = (slug) => mount.querySelector(`[data-field="${slug}"]`);
  const statusFor = (slug) => mount.querySelector(`[data-status="${slug}"]`);

  /** What is currently *typed*, which is what a check must be run against. */
  const typedValues = (section) =>
    Object.fromEntries(
      section.fields.map((field) => [field.slug, inputFor(field.slug).value.trim()]),
    );

  // ==========================================
  // JOB 1: LOAD EXISTING SETTINGS
  // ==========================================
  const saved = await Promise.all(SECTIONS.map((section) => readSection(section)));

  saved.forEach((values) => {
    for (const [slug, value] of Object.entries(values)) {
      if (value) inputFor(slug).value = value;
    }
  });

  // ==========================================
  // JOB 2: WHOSE ACCOUNT IS THIS?
  // ==========================================
  //
  // One path for every platform, and deliberately **the same `verifyIdentity`
  // the sync calls** — a check that exercises a different call can pass while
  // the real path fails. It runs against the values typed here rather than the
  // saved ones, so a wrong key tells you before you come to rely on it.
  const setStatus = (element, message, ok) => {
    element.textContent = message;
    element.classList.toggle("hidden", message === "");
    element.classList.toggle("success", ok === true);
    element.classList.toggle("failure", ok === false);
  };

  async function verify(section) {
    const status = statusFor(section.slug);
    const values = typedValues(section);

    // Only what everyone fills in. A half-filled key pair still reaches the
    // check, which says plainly that it wants both halves.
    if (section.fields.some((field) => !field.ownerOnly && !values[field.slug])) {
      // A section you have not filled in yet is not a failure, so it says
      // nothing — unless it asked you to press something, in which case it owes
      // you an explanation for doing nothing. `ok` stays undefined when there is
      // no message, or an empty line would still be marked red.
      const message = section.verify.incomplete ?? "";
      setStatus(status, message, message ? false : undefined);
      return;
    }

    setStatus(status, "Checking…");
    const adapter = getPlatform(section.verify.adapter);

    try {
      const identity = await adapter.verifyIdentity(await adapter.createSessionFrom(values));
      setStatus(status, `✓ ${describeIdentity(adapter, identity)}`, true);
    } catch (error) {
      // The adapters explain their own failures well — an unknown handle, a
      // bad key, a signed-out session, the wrong account. Passing the message
      // through beats guessing which field was wrong.
      setStatus(status, `✕ ${error.message}`, false);
    }
  }

  // ==========================================
  // JOB 3: THE ACCOUNT, AND SIGNING OUT
  // ==========================================
  //
  // Signing in happens at the gate, before any of this exists; here the only
  // action is leaving. Started before the platform checks below and not
  // awaited, since those wait on three sites in turn and this has nothing to do
  // with them.
  //
  // The role comes from `config/owner`, the document `firestore.rules` checks
  // before any catalog write. Showing "Owner" here grants nothing; the rules
  // decide on every write regardless.
  const accountBtn = document.getElementById("account-btn");
  const accountStatus = document.getElementById("account-status");
  const accountId = document.getElementById("account-id");
  const ROLE_NOTE = { owner: " · Owner", user: "", [null]: " · couldn't check owner status" };

  /**
   * The owner-only fields — the Codeforces key pair — for an install that
   * rates contests itself: the catalog's owner, or a build with no Firebase.
   * Everyone else takes every rating from the catalog and never needs one, so
   * never sees one. Showing them grants nothing: the key only signs requests
   * to Codeforces, and a modified extension could show itself anything.
   */
  function showOwnerFields(show) {
    for (const group of mount.querySelectorAll("[data-owner-only]")) group.hidden = !show;
  }

  function showAccount(who) {
    showOwnerFields(who?.role === "owner");
    setStatus(
      accountStatus,
      who ? `✓ Signed in as ${who.email ?? "your Google account"}${ROLE_NOTE[who.role]}` : "",
      who ? true : undefined,
    );
    // The id `config/owner` names. Shown rather than left to the Firebase
    // console because it is the one value a self-hoster has to copy from here.
    accountId.textContent = who ? `User ID: ${who.uid}` : "";
    accountId.classList.toggle("hidden", !who);
  }

  // The button starts disabled in the markup and only this enables it, so it
  // cannot be pressed before the page knows who is signed in — and a page
  // where this never ran is visibly different from one that did.
  async function loadAccount() {
    if (!isAccountConfigured()) {
      showOwnerFields(true);
      setStatus(accountStatus, "Sign-in isn't set up in this build.");
      return;
    }
    try {
      showAccount(await whoAmI());
    } catch (error) {
      setStatus(accountStatus, `✕ ${error.message}`, false);
    }
    accountBtn.disabled = false;
  }

  accountBtn.addEventListener("click", async () => {
    accountBtn.disabled = true;
    try {
      await signOut();
      // The fingerprints describe this account's cloud copy; another account
      // signing in next must reconcile from scratch.
      await resetCloudState();
      // Back to the gate. The auth listener would get there too; reloading
      // here does not leave it to timing.
      location.reload();
    } catch (error) {
      // Still signed in, so the button still means what it says.
      setStatus(accountStatus, `✕ ${error.message}`, false);
      accountBtn.disabled = false;
    }
  });

  loadAccount();

  for (const section of SECTIONS) {
    if (section.verify.trigger === "button") {
      const button = mount.querySelector(`[data-verify="${section.slug}"]`);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await verify(section);
        } finally {
          button.disabled = false;
        }
      });
      continue;
    }

    // Checked on load as well as on change: the dangerous state on a
    // session-based platform is being signed in as someone else, which
    // otherwise looks exactly like a normal sync.
    const last = section.fields.at(-1);
    inputFor(last.slug).addEventListener("change", () => verify(section));
    await verify(section);
  }

  // ==========================================
  // JOB 4: SAVE TO STORAGE
  // ==========================================
  saveBtn.addEventListener("click", async () => {
    await Promise.all(SECTIONS.map((section) => writeSettings(typedValues(section))));
    // Handles travel with the queue, so a second device needs only its own
    // API key pair. Secrets never leave this device: they are in IndexedDB.
    const outcome = await saveToCloud();
    // The settings are saved on this device either way; the outcome only
    // says how far they got beyond it, so it is a second sentence and stays
    // up long enough to be read.
    saveMsg.textContent = outcome ? `Saved on this device. ${outcome.message}` : "Saved successfully!";
    saveMsg.classList.toggle("is-warning", outcome?.tone === "warning");
    saveMsg.classList.toggle("is-error", outcome?.tone === "error");

    saveMsg.classList.remove("hidden");
    clearTimeout(saveMsg.hideTimer);
    saveMsg.hideTimer = setTimeout(() => saveMsg.classList.add("hidden"), outcome ? 6000 : 2500);
  });
}
