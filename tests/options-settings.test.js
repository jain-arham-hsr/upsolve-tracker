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
 * They are generated from the descriptors now, which is what makes this
 * testable in Node: rendering is a pure function of what each platform
 * declares, so the whole page's platform half can be asserted without a
 * browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";

import { renderPlatformSettings, describeIdentity } from "../core/ui/options/platform-settings.js";
import { listPlatforms } from "../core/platforms/registry.js";

const render = (platforms = listPlatforms()) =>
  new DOMParser()
    .parseFromString(`<body>${renderPlatformSettings(platforms)}</body>`, "text/html")
    .querySelector("body");

test("every registered platform gets exactly one section", () => {
  const doc = render();
  const sections = [...doc.querySelectorAll(".settings-section")];

  assert.deepEqual(
    sections.map((s) => s.getAttribute("data-platform")),
    listPlatforms().map((p) => p.id),
    "a platform must not be able to exist without a settings section",
  );
  assert.deepEqual(
    sections.map((s) => s.querySelector(".section-head").textContent),
    listPlatforms().map((p) => p.label),
  );
});

test("every declared field becomes a labelled input of the declared type", () => {
  const doc = render();

  for (const platform of listPlatforms()) {
    const section = doc.querySelector(`[data-platform="${platform.id}"]`);

    for (const field of platform.settingsFields) {
      const input = section.querySelector(`[data-field="${field.key}"]`);
      assert.ok(input, `${platform.id} never rendered an input for ${field.key}`);
      assert.equal(input.getAttribute("type"), field.type);
      assert.equal(input.getAttribute("placeholder"), field.placeholder ?? "");

      // A label that points at nothing is the accessibility half of the drift
      // this file exists to catch.
      const label = section.querySelector(`label[for="${input.id}"]`);
      assert.ok(label, `${field.key}'s label does not point at its input`);
      assert.equal(label.textContent, field.label);
    }

    assert.equal(
      section.querySelectorAll("input").length,
      platform.settingsFields.length,
      `${platform.id} rendered inputs it never declared`,
    );
  }
});

test("a secret is never rendered as a field the page would treat as ordinary text", () => {
  // api_secret declares type "password"; if that stopped being honoured the
  // secret would render in the clear on a page anyone can open.
  const doc = render();
  for (const platform of listPlatforms()) {
    for (const field of platform.settingsFields.filter((f) => f.type === "password")) {
      const input = doc.querySelector(`[data-field="${field.key}"]`);
      assert.equal(input.getAttribute("type"), "password");
    }
  }
});

test("each platform gets exactly one verdict line, wherever its trigger puts it", () => {
  const doc = render();

  for (const platform of listPlatforms()) {
    const section = doc.querySelector(`[data-platform="${platform.id}"]`);
    const statuses = section.querySelectorAll(`[data-status="${platform.id}"]`);
    assert.equal(statuses.length, 1, `${platform.id} should have one verdict line`);

    const status = statuses[0];
    if (platform.verify.trigger === "button") {
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

  for (const platform of listPlatforms()) {
    const section = doc.querySelector(`[data-platform="${platform.id}"]`);
    const button = section.querySelector(`[data-verify="${platform.id}"]`);

    if (platform.verify.trigger === "button") {
      assert.ok(button, `${platform.id} declared a button and did not get one`);
      assert.equal(button.textContent, platform.verify.label);
    } else {
      assert.equal(button, null, `${platform.id} verifies on change and needs no button`);
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

test("a platform added without settings fields fails here rather than rendering an empty box", () => {
  assert.throws(
    () => renderPlatformSettings([{ id: "newsite", label: "New Site", verify: { trigger: "change" } }]),
    "a half-registered platform should not render a heading over nothing",
  );
});
