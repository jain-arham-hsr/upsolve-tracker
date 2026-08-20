/**
 * Close-on-outside-click and close-on-Escape, for the panel's popovers.
 *
 * Shared by the platform filter and the contest row's ⋮ menu. Both need the
 * same three behaviours, and two bespoke implementations would inevitably
 * differ in one of them.
 */

/**
 * @param {HTMLElement} panel - clicks inside this are not "outside"
 * @param {() => void} close
 * @returns {() => void} teardown — call it when closing, or listeners leak
 *   every time the popover opens.
 */
export function bindDismiss(panel, close) {
  const onPointerDown = (event) => {
    if (!panel.contains(event.target)) close();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  // Capture phase: a handler inside the page that stops propagation should not
  // be able to leave the popover stuck open.
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown);
  };
}
