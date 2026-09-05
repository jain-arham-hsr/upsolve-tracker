/**
 * The settings page had never been executed by any automated check.
 *
 * That mattered more than the usual "no coverage" complaint: three
 * verifyIdentity paths, credential save/load and the folder picker all live
 * there, and a `nullAt`-class typo would have shipped. The sections were also
 * hand-written three times and had drifted — AtCoder's verdict line had no CSS
 * rule at all and fell back to the body's 16px, and for a while AtCoder had no
 * verdict at all while the other two did.
 *
 * The *schema* is hand-written again, but the *markup* is not, which is the
 * distinction that keeps that drift from coming back — and what makes this
 * testable in Node, since rendering stays a pure function of what the schema
 * declares.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

import { renderSettingsSections, describeIdentity } from "../core/ui/options/sections.js";
import { SECTIONS } from "../core/settings/schema.js";
import { listPlatforms } from "../core/platforms/registry.js";

const render = (sections = SECTIONS) =>
  new DOMParser()
    .parseFromString(`<body>${renderSettingsSections(sections)}</body>`, "text/html")
    .querySelector("body");

test("every declared section is rendered exactly once", () => {
  const doc = render();
  const sections = [...doc.querySelectorAll(".settings-section")];

  assert.deepEqual(
    sections.map((s) => s.getAttribute("data-section")),
    SECTIONS.map((s) => s.slug),
  );
  assert.deepEqual(
    sections.map((s) => s.querySelector(".section-head").textContent),
    SECTIONS.map((s) => s.title),
  );
});

test("a credential set is asked for once, however many platforms use it", () => {
  // The whole reason the page stopped being generated per platform. Codeforces
  // official and gyms are one account and one key pair; rendering per platform
  // would ask for it twice, on a page where the two copies would then have to
  // agree with each other.
  //
  // Asserted through the *slugs*, not through a platform count, so it keeps
  // meaning the same thing when a platform is added or renamed.
  const doc = render();

  for (const field of SECTIONS.flatMap((section) => section.fields)) {
    assert.equal(
      doc.querySelectorAll(`[data-field="${field.slug}"]`).length,
      1,
      `${field.slug} is asked for more than once, so two inputs write one key`,
    );
  }

  assert.ok(
    doc.querySelectorAll(".settings-section").length <= listPlatforms().length,
    "there should never be more sections than platforms",
  );
});

test("every declared field becomes a labelled input of the declared type", () => {
  const doc = render();

  for (const section of SECTIONS) {
    const el = doc.querySelector(`[data-section="${section.slug}"]`);

    for (const field of section.fields) {
      const input = el.querySelector(`[data-field="${field.slug}"]`);
      assert.ok(input, `${section.slug} never rendered an input for ${field.slug}`);
      assert.equal(input.getAttribute("type"), field.type);
      assert.equal(input.getAttribute("placeholder"), field.placeholder ?? "");

      // A label that points at nothing is the accessibility half of the drift
      // this file exists to catch.
      const label = el.querySelector(`label[for="${input.id}"]`);
      assert.ok(label, `${field.slug}'s label does not point at its input`);
      assert.equal(label.textContent, field.label);
    }

    assert.equal(
      el.querySelectorAll("input").length,
      section.fields.length,
      `${section.slug} rendered inputs it never declared`,
    );
  }
});

test("a secret is never rendered as a field the page would treat as ordinary text", () => {
  // api_secret declares type "password"; if that stopped being honoured the
  // secret would render in the clear on a page anyone can open.
  const doc = render();
  for (const field of SECTIONS.flatMap((s) => s.fields).filter((f) => f.type === "password")) {
    assert.equal(doc.querySelector(`[data-field="${field.slug}"]`).getAttribute("type"), "password");
  }
});

test("each section gets exactly one verdict line, wherever its trigger puts it", () => {
  const doc = render();

  for (const section of SECTIONS) {
    const el = doc.querySelector(`[data-section="${section.slug}"]`);
    const statuses = el.querySelectorAll(`[data-status="${section.slug}"]`);
    assert.equal(statuses.length, 1, `${section.slug} should have one verdict line`);

    const status = statuses[0];
    if (section.verify.trigger === "button") {
      // Inline beside the button, which .test-row spaces with gap — so it must
      // NOT be a direct child of .form-group, or the CSS adds a second margin.
      assert.ok(status.closest(".test-row"), "a button's verdict sits in its row");
    } else {
      assert.equal(
        status.parentElement.className,
        "form-group",
        "a change-triggered verdict is a direct child of .form-group, which is what the CSS selects",
      );
    }
  }
});

test("a button-triggered section renders its button; a change-triggered one does not", () => {
  const doc = render();

  for (const section of SECTIONS) {
    const el = doc.querySelector(`[data-section="${section.slug}"]`);
    const button = el.querySelector(`[data-verify="${section.slug}"]`);

    if (section.verify.trigger === "button") {
      assert.ok(button, `${section.slug} declared a button and did not get one`);
      assert.equal(button.textContent, section.verify.label);
    } else {
      assert.equal(button, null, `${section.slug} verifies on change and needs no button`);
    }
  }
});

test("a platform's own words are used for the resolved account", () => {
  // "Connected as" where a handle is looked up, "Signed in as" where the
  // browser session *is* the identity. Shared code must not decide which.
  const looked_up = { verifyIdentity() {} };
  assert.equal(describeIdentity(looked_up, { username: "tourist" }), "Connected as tourist.");

  const session_based = { describeIdentity: (i) => `Signed in as ${i.username}.` };
  assert.equal(describeIdentity(session_based, { username: "tourist" }), "Signed in as tourist.");
});

test("a section declared without fields fails here rather than rendering an empty box", () => {
  assert.throws(
    () => renderSettingsSections([{ slug: "newsite", title: "New Site", verify: { trigger: "change" } }]),
    "a half-declared section should not render a heading over nothing",
  );
});
