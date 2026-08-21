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

export const PLATFORM_FILTER_KEY = "upsolve_tracker.platform_filter";

/** The single-select key this replaced, read once so a saved choice survives. */
const LEGACY_KEY = "upsolve_tracker.contest_filter";
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
      ${renderRows(platforms, active)}
    </div>`;
}

/** One mark per platform with anything selected — deduplicated, in fixed order. */
function marksFor(platforms, active) {
  return platforms
    .filter(({ groups }) => groups.some((group) => active.includes(group.key)))
    .map(({ platform }) => platformIcon(platform.id, platform.shortLabel))
    .join("");
}

/**
 * One row per filter group, flat.
 *
 * Codeforces contributes two and everyone else one, but they all read the same
 * way — each row carries its platform's mark and names itself in full, so
 * nothing depends on a header above it.
 */
function renderRows(platforms, active) {
  return platforms
    .flatMap(({ platform, groups }) =>
      groups.map((group) => {
        const on = active.includes(group.key);
        return `
          <button type="button" class="filter-row"
                  data-filter-key="${escapeHtml(group.key)}" aria-pressed="${on}">
            <span class="filter-check" aria-hidden="true">${on ? "✓" : ""}</span>
            ${platformIcon(platform.id, platform.shortLabel)}
            <span class="filter-row-label">${escapeHtml(group.label)}</span>
          </button>`;
      }),
    )
    .join("");
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
