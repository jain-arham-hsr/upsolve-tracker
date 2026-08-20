/**
 * The platform filter, shared by the Queue and Contests views.
 *
 * A dropdown rather than a row of chips: the chip row grew with every platform
 * added and competed for width with the very list it filters. One control
 * stays one line however many platforms exist, and the open panel has room for
 * full names and icons where a chip did not.
 *
 * The selection is persisted rather than held on a view instance, because both
 * views are destroyed and rebuilt on every tab switch.
 */
import { listFilterPlatforms, listFilterGroups } from "../platforms/registry.js";
import { escapeHtml } from "./escape-html.js";
import { platformIcon } from "./platform-icons.js";
import { bindDismiss } from "./dismissable.js";

export const PLATFORM_FILTER_KEY = "cf_trainer.platform_filter";

/** The single-select key this replaced, read once so a saved choice survives. */
const LEGACY_KEY = "cf_trainer.contest_filter";
const LEGACY_MAP = { OFFICIAL: ["codeforces:OFFICIAL"], GYM: ["codeforces:GYM"] };

/**
 * @returns {Promise<string[]>} selected keys. Empty means no filter — which is
 *   deliberately not the same as "nothing selected, so show nothing".
 */
export async function loadFilter() {
  const stored = await chrome.storage.local.get({
    [PLATFORM_FILTER_KEY]: null,
    [LEGACY_KEY]: null,
  });

  const selected = stored[PLATFORM_FILTER_KEY];
  if (Array.isArray(selected)) return selected;

  return LEGACY_MAP[stored[LEGACY_KEY]] ?? [];
}

export async function saveFilter(keys) {
  await chrome.storage.local.set({ [PLATFORM_FILTER_KEY]: keys });
}

/**
 * The collapsed button plus its panel.
 *
 * The button shows the active selection as marks, so what is filtered stays
 * readable without opening anything.
 */
export function renderFilterControl(selected) {
  const platforms = listFilterPlatforms();
  if (platforms.length <= 1) return "";

  const total = listFilterGroups().length;
  const active = selected.filter((key) => listFilterGroups().some((g) => g.key === key));

  const summary = active.length === 0
    ? `<span class="filter-summary">All platforms</span>`
    : `${marksFor(platforms, active)}<span class="filter-summary">${active.length} of ${total}</span>`;

  return `
    <button type="button" class="filter-button" data-filter-toggle aria-expanded="false">
      ${summary}<span class="filter-caret" aria-hidden="true">▾</span>
    </button>
    <div class="filter-panel hidden" data-filter-panel>
      ${platforms.map((entry) => renderPlatformEntry(entry, active)).join("")}
    </div>`;
}

/** One mark per platform with anything selected — deduplicated, in fixed order. */
function marksFor(platforms, active) {
  return platforms
    .filter(({ groups }) => groups.some((group) => active.includes(group.key)))
    .map(({ platform }) => platformIcon(platform.id, platform.shortLabel))
    .join("");
}

function renderPlatformEntry({ platform, groups }, active) {
  // One group: the platform itself is the checkbox. Several: a header, then a
  // nested row each, so "Official" and "Gym" read under "Codeforces".
  if (groups.length === 1) {
    return row(groups[0].key, platform.label, active, {
      mark: platformIcon(platform.id, platform.shortLabel),
    });
  }

  return `
    <div class="filter-group">
      <div class="filter-group-head">
        ${platformIcon(platform.id, platform.shortLabel)}
        <span>${escapeHtml(platform.label)}</span>
      </div>
      ${groups.map((group) => row(group.key, group.label, active, { nested: true })).join("")}
    </div>`;
}

function row(key, label, active, { mark = "", nested = false } = {}) {
  const on = active.includes(key);
  return `
    <button type="button" class="filter-row${nested ? " is-nested" : ""}"
            data-filter-key="${escapeHtml(key)}" aria-pressed="${on}">
      <span class="filter-check" aria-hidden="true">${on ? "✓" : ""}</span>
      ${mark}
      <span class="filter-row-label">${escapeHtml(label)}</span>
    </button>`;
}

/**
 * Wires the control. Toggling a row re-renders in place so the button summary
 * and the checkmarks stay in step, and the panel stays open — filtering is
 * usually several toggles, not one.
 */
export function bindFilterControl(root, getSelected, onChange) {
  let teardown = null;

  const panel = () => root.querySelector("[data-filter-panel]");
  const button = () => root.querySelector("[data-filter-toggle]");

  const close = () => {
    panel()?.classList.add("hidden");
    button()?.setAttribute("aria-expanded", "false");
    teardown?.();
    teardown = null;
  };

  const open = () => {
    panel()?.classList.remove("hidden");
    button()?.setAttribute("aria-expanded", "true");
    teardown = bindDismiss(root, close);
  };

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-filter-toggle]")) {
      panel()?.classList.contains("hidden") ? open() : close();
      return;
    }

    const rowEl = event.target.closest("[data-filter-key]");
    if (!rowEl || !root.contains(rowEl)) return;

    const key = rowEl.dataset.filterKey;
    const current = getSelected();
    const next = current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key];

    await saveFilter(next);
    await onChange(next);

    // onChange re-renders the control, which drops the open panel with it.
    open();
  });

  return close;
}
