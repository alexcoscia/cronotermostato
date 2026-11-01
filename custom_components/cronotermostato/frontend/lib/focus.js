// Focus helpers for the modal dialog: the element that has the focus when it opens
// (it may sit inside nested shadow roots) and its return when the dialog closes.

/** The focused element, looking through shadow roots. `root` is a document or a shadow root. */
export function deepActiveElement(root = globalThis.document) {
  let active = root?.activeElement ?? null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Give the focus back to `element`, only if it is still in the page. */
export function restoreFocus(element) {
  if (element && element.isConnected && typeof element.focus === "function") element.focus();
}
