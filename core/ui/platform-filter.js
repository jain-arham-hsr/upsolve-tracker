/**
 * The platform filter, shared by the Queue and Contests views.
 *
 * Rendered as toggle chips rather than a `<select>`: the filter is
 * multi-select now, and a narrow side panel has no room for a multiple-choice
 * dropdown. Which chips exist comes from the registry, so a new platform
 * appears here without touching either view.
 *
 * The selection is persisted rather than held on a view instance, because both
 * views are destroyed and rebuilt on every tab switch.
 */
import { listFilterGroups } from "../platforms/registry.js";
import { escapeHtml } from "./escape-html.js";

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

/** Chips for every group the registry knows about. */
export function renderFilterChips(selected) {
  const groups = listFilterGroups();
  if (groups.length <= 1) return "";

  const chips = groups
    .map((group) => {
      const on = selected.includes(group.key) ? " is-on" : "";
      return `<button type="button" class="filter-chip${on}" data-filter-key="${escapeHtml(
        group.key,
      )}">${escapeHtml(group.label)}</button>`;
    })
    .join("");

  const allOn = selected.length === 0 ? " is-on" : "";
  return (
    `<button type="button" class="filter-chip${allOn}" data-filter-key="">All</button>` + chips
  );
}

/**
 * Wires the chips. "All" clears the selection; toggling the last active chip
 * off clears it too, since an empty queue with every chip dark reads as a bug
 * rather than a filter.
 */
export function bindFilterChips(root, getSelected, onChange) {
  root.addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-filter-key]");
    if (!chip || !root.contains(chip)) return;

    const key = chip.dataset.filterKey;
    const current = getSelected();

    let next;
    if (key === "") {
      next = [];
    } else if (current.includes(key)) {
      next = current.filter((entry) => entry !== key);
    } else {
      next = [...current, key];
    }

    await saveFilter(next);
    await onChange(next);
  });
}
