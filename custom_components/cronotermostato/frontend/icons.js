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
