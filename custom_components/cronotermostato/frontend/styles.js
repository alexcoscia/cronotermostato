// Shared styles. Colours of text, surfaces, lines and the accent come from the
// theme of Home Assistant (CSS variables) with a fallback, so they follow any
// theme. The colours of the modes (amber heating, blue cooling, grey off) and
// of the statuses are our own, in two sets: the editor sets the `dark`
// attribute on itself from `hass.themes.darkMode`. Tokens are defined by
// `crono-editor`; the inner components inherit them.

import { css } from "./lit.js";

export const tokens = css`
  :host {
    --crono-text: var(--primary-text-color, #1b2129);
    --crono-muted: var(--secondary-text-color, #566170);
    --crono-bg: var(--primary-background-color, #eceff3);
    --crono-surface: var(--card-background-color, #ffffff);
    --crono-surface2: var(--secondary-background-color, #f4f6f8);
    --crono-line: var(--divider-color, #cfd5dd);
    --crono-accent: var(--primary-color, #0f6b63);
    --crono-radius: var(--ha-card-border-radius, 12px);
    --crono-shadow: var(--ha-card-box-shadow, 0 1px 2px rgba(20, 30, 40, 0.08));
    --crono-focus: var(--primary-color, #0f6b63);
    --crono-error: #a31d1d;
    --crono-error-bg: #fde0e0;
    --crono-warn: #7f4500;
    --crono-warn-bg: #ffefc2;
    --crono-heat: #7a4300;
    --crono-heat-bg: #fde8bd;
    --crono-heat-line: #9f6200;
    --crono-cool: #1b4a9e;
    --crono-cool-bg: #d8e6fd;
    --crono-cool-line: #2f64c0;
    --crono-off: #464e5b;
    --crono-off-bg: #e3e6ea;
    --crono-off-line: #757f8e;
    --crono-ok: #0f6636;
    --crono-ok-bg: #d6f1e0;
    --crono-field-line: #6f7a88;
    color: var(--crono-text);
  }
  :host([dark]) {
    --crono-error: #ffb3b3;
    --crono-error-bg: #4a1717;
    --crono-warn: #ffd37a;
    --crono-warn-bg: #4a3608;
    --crono-heat: #fcd38a;
    --crono-heat-bg: #4a3410;
    --crono-heat-line: #b9791a;
    --crono-cool: #b3cdff;
    --crono-cool-bg: #14305e;
    --crono-cool-line: #4673c6;
    --crono-off: #c4cbd5;
    --crono-off-bg: #2b3038;
    --crono-off-line: #6b7482;
    --crono-ok: #8be0ae;
    --crono-ok-bg: #123a24;
    --crono-field-line: #8b94a1;
  }
`;

/** Rules used by several components: buttons, focus, messages, hidden text. */
export const base = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  button,
  input {
    font: inherit;
    color: inherit;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .muted {
    color: var(--crono-muted);
  }
  :focus-visible {
    outline: 3px solid var(--crono-focus);
    outline-offset: 2px;
  }
  .btn {
    min-height: 44px;
    min-width: 44px;
    padding: 0 14px;
    border-radius: 10px;
    border: 1px solid var(--crono-line);
    background: var(--crono-surface);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
  }
  .btn:hover {
    background: var(--crono-surface2);
  }
  /* White text on the accent of HA is not readable with its default blue (2.6:1), so the fill is
     the accent darkened by half (contrast.test.mjs checks it for several accents). Browsers
     without color-mix get a fixed dark teal. */
  .btn.primary {
    background: #0f6b63;
    color: #ffffff;
    border-color: transparent;
    font-weight: 600;
  }
  @supports (background: color-mix(in srgb, red 50%, black)) {
    .btn.primary {
      background: color-mix(in srgb, var(--crono-accent) 50%, black);
    }
  }
  .btn.danger {
    color: var(--crono-error);
    border-color: var(--crono-error);
  }
  .btn[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .ic {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .msg {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--crono-line);
    background: var(--crono-surface2);
  }
  .msg.error {
    background: var(--crono-error-bg);
    color: var(--crono-error);
    border-color: var(--crono-error);
  }
  .msg.warn {
    background: var(--crono-warn-bg);
    color: var(--crono-warn);
    border-color: var(--crono-warn);
  }
  .msg > span {
    color: var(--crono-text);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .badge.warn {
    background: var(--crono-warn-bg);
    color: var(--crono-warn);
  }
`;

/**
 * Colours of the modes on any element with the class b-heat / b-cool / b-off. A calculated
 * element gets a dashed border; stripes (`hatch`) are only ever drawn in a narrow strip beside
 * or below the text, or on elements that carry no text, never behind it.
 */
export const modeColors = css`
  .b-heat {
    background-color: var(--crono-heat-bg);
    color: var(--crono-heat);
    border-color: var(--crono-heat-line);
  }
  .b-cool {
    background-color: var(--crono-cool-bg);
    color: var(--crono-cool);
    border-color: var(--crono-cool-line);
  }
  .b-off {
    background-color: var(--crono-off-bg);
    color: var(--crono-off);
    border-color: var(--crono-off-line);
  }
  .is-auto {
    border-style: dashed;
  }
  /* Stripes in the colour of the mode (currentColor): for a strip or an element without text. */
  .hatch {
    background-image: repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px);
  }
`;

/** Form fields and error lines, shared by the band row and the dialogs. */
export const fields = css`
  label,
  .fl {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--crono-muted);
    min-width: 0;
  }
  input[type="text"],
  input[type="number"],
  select {
    min-height: 44px;
    width: 100%;
    min-width: 0;
    padding: 0 10px;
    border: 1px solid var(--crono-field-line);
    border-radius: 8px;
    background: var(--crono-surface);
    color: var(--crono-text);
    font-weight: 400;
  }
  input[aria-invalid="true"],
  select[aria-invalid="true"] {
    border: 2px solid var(--crono-error);
  }
  input[readonly] {
    background: var(--crono-surface2);
  }
  input:disabled,
  select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .fe {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    color: var(--crono-error);
    font-size: 12.5px;
    font-weight: 600;
  }
  .fe .ic {
    margin-top: 2px;
  }
  .fw {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    color: var(--crono-warn);
    font-size: 12.5px;
    font-weight: 600;
  }
  .fw .ic {
    margin-top: 2px;
  }
`;
