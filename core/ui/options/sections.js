/**
 * One Settings section per entry in `core/settings/schema.js`.
 *
 * A section is a **credential set**, not a platform. Those were the same thing
 * until Codeforces became two platforms sharing one account and one key pair —
 * rendering per platform would then ask for that pair twice, on a page where
 * the two copies would have to agree with each other.
 *
 * This file knows about *fields*, never about platforms: it renders whatever
 * the schema declares and puts each section's slug on the markup so the page
 * can find it again. The one platform id involved is `verify.adapter`, which is
 * a string it passes to `getPlatform()` without reading.
 *
 * `help` and `label` are authored in the repo, in the schema, and are injected
 * as **trusted HTML** so the Codeforces key-pair note can carry a link to
 * codeforces.com/settings/api. That is the exception, not the rule: anything
 * originating outside the extension still goes through `escape-html.js`.
 */

/**
 * @param {object[]} sections - from `core/settings/schema.js`.
 * @returns {string} markup for every section.
 */
export function renderSettingsSections(sections) {
  return sections.map(renderSection).join("\n");
}

function renderSection(section) {
  const fields = section.fields.map((field, index) =>
    renderField(section, field, index === section.fields.length - 1),
  );

  return `
    <section class="settings-section" data-section="${section.slug}">
      <h3 class="section-head">${section.title}</h3>
${fields.join("\n")}${renderVerifyRow(section)}
    </section>`;
}

/**
 * The verdict rides inside the last field's group when a section verifies on
 * change, because it is a statement about the value just typed. A section with
 * a button gets its own group instead, below — see `renderVerifyRow`.
 */
function renderField(section, field, isLast) {
  const onChange = section.verify.trigger === "change" && isLast;
  const id = `setting-${field.slug}`;

  return `
      <div class="form-group">
        <label for="${id}">${field.label}</label>
        <p class="help-text">${field.help}</p>
        <input type="${field.type}" id="${id}" data-field="${field.slug}"
               placeholder="${field.placeholder ?? ""}" spellcheck="false" />${
                 onChange ? `\n        <div class="status-text" data-status="${section.slug}"></div>` : ""
               }
      </div>`;
}

function renderVerifyRow(section) {
  if (section.verify.trigger !== "button") return "";

  // Explanation above the button and its verdict, not underneath: the result
  // used to land on top of the help text.
  return `

      <div class="form-group">
        <p class="help-text">${section.verify.help ?? ""}</p>
        <div class="test-row">
          <button data-verify="${section.slug}" class="btn secondary">${section.verify.label}</button>
          <span class="status-text hidden" data-status="${section.slug}"></span>
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
