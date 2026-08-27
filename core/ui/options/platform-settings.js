/**
 * One Settings section per platform, built from what each descriptor declares.
 *
 * These three sections used to be hand-written, three times, in
 * `options/index.html` — and drifted exactly as you would expect. AtCoder's
 * verdict line had no CSS rule at all and fell back to the body's 16px, sat
 * flush against its input, and for a long time AtCoder had no verdict at all
 * while the other two did. A section is now the descriptor's answer, so a
 * platform cannot be added and half-wired.
 *
 * `help` and `label` are authored in the repo, in the descriptors, and are
 * injected as **trusted HTML** so the Codeforces key-pair note can carry a link
 * to codeforces.com/settings/api. That is the exception, not the rule: anything
 * originating outside the extension still goes through `escape-html.js`.
 */

/**
 * @param {object[]} platforms - descriptors, from `listPlatforms()`.
 * @returns {string} markup for every platform section.
 */
export function renderPlatformSettings(platforms) {
  return platforms.map(renderSection).join("\n");
}

function renderSection(platform) {
  const fields = platform.settingsFields.map((field, index) =>
    renderField(platform, field, index === platform.settingsFields.length - 1),
  );

  return `
    <section class="settings-section" data-platform="${platform.id}">
      <h3 class="section-head">${platform.label}</h3>
${fields.join("\n")}${renderVerifyRow(platform)}
    </section>`;
}

/**
 * The verdict rides inside the last field's group when a section verifies on
 * change, because it is a statement about the value just typed. A section with
 * a button gets its own group instead, below — see `renderVerifyRow`.
 */
function renderField(platform, field, isLast) {
  const onChange = platform.verify.trigger === "change" && isLast;
  const id = `setting-${field.key}`;

  return `
      <div class="form-group">
        <label for="${id}">${field.label}</label>
        <p class="help-text">${field.help}</p>
        <input type="${field.type}" id="${id}" data-field="${field.key}"
               placeholder="${field.placeholder ?? ""}" spellcheck="false" />${
                 onChange ? `\n        <div class="status-text" data-status="${platform.id}"></div>` : ""
               }
      </div>`;
}

function renderVerifyRow(platform) {
  if (platform.verify.trigger !== "button") return "";

  // Explanation above the button and its verdict, not underneath: the result
  // used to land on top of the help text.
  return `

      <div class="form-group">
        <p class="help-text">${platform.verify.help ?? ""}</p>
        <div class="test-row">
          <button data-verify="${platform.id}" class="btn secondary">${platform.verify.label}</button>
          <span class="status-text hidden" data-status="${platform.id}"></span>
        </div>
      </div>`;
}

/**
 * How Settings names the account it resolved.
 *
 * "Connected as" where a handle is looked up, "Signed in as" on CodeChef where
 * the browser session really *is* the identity. The distinction is real and
 * worth keeping, so a platform that needs different words says so itself —
 * otherwise this would be a branch on the platform, in shared code, which is
 * the thing being removed.
 */
export function describeIdentity(adapter, identity) {
  return adapter.describeIdentity?.(identity) ?? `Connected as ${identity.username}.`;
}
