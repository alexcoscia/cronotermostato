// Small inline icons (decorative: always hidden from assistive technology; the
// meaning is carried by the text next to them). Static markup only.

import { html, svg } from "./lit.js";

const wrap = (path, width = 2) =>
  html`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${width} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;

export const iconPlus = () => wrap(svg`<path d="M12 5v14M5 12h14"/>`, 2.4);
export const iconEdit = () => wrap(svg`<path d="M4 20h4L19 9l-4-4L4 16z"/>`);
export const iconCopy = () => wrap(svg`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>`);
export const iconTrash = () => wrap(svg`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`);
export const iconWarn = () => wrap(svg`<path d="M12 3l10 18H2zM12 10v5M12 18v.01"/>`);
export const iconCheck = () => wrap(svg`<path d="M5 12l5 5L20 7"/>`, 2.4);
export const iconMenu = () => wrap(svg`<path d="M4 6h16M4 12h16M4 18h16"/>`, 2.4);
export const iconHeat = () => wrap(svg`<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2.5-4.5C10 10 11 6 12 3z"/>`);
export const iconCool = () => wrap(svg`<path d="M12 2v20M4.2 7l15.6 10M4.2 17L19.8 7M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>`);
export const iconOff = () => wrap(svg`<path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0"/>`);
export const iconAuto = () => wrap(svg`<path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>`);
export const iconMinus = () => wrap(svg`<path d="M5 12h14"/>`, 2.4);
export const iconDot = () => wrap(svg`<circle cx="12" cy="12" r="5" fill="currentColor"/>`);
export const iconX = () => wrap(svg`<path d="M6 6l12 12M18 6L6 18"/>`, 2.4);
export const iconMode = (mode) => (mode === "cool" ? iconCool() : mode === "off" ? iconOff() : iconHeat());
export const iconFlag = () => wrap(svg`<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`);
export const iconPause = () => wrap(svg`<path d="M8 5v14M16 5v14"/>`, 2.6);
export const iconInfo = () => wrap(svg`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>`);
export const iconHand = () => wrap(svg`<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3.5L4 14a1.5 1.5 0 0 1 2.5-1.5L8 14"/>`);
