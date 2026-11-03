// Shared styles. Colours of text, surfaces, lines and the accent come from the
// theme of Home Assistant (CSS variables) with a fallback, so they follow any
// theme. The colours of the modes (amber heating, blue cooling, grey off) and
// of the statuses are our own, in two sets: the component sets the `dark`
// attribute on itself (lib/theme.js) from the colours of the theme in use, not only from
// `hass.themes.darkMode`, which a custom dark theme may leave false. Tokens are defined by
// `crono-editor`, `cronotermostato-card` and the card editor; the inner components inherit them.

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
    --crono-heat-v1-bg: #f08b74;
    --crono-heat-v1: #4f1204;
    --crono-heat-v1-line: #b3432a;
    --crono-heat-v2-bg: #ecd22e;
    --crono-heat-v2: #403600;
    --crono-heat-v2-line: #8f7a00;
    --crono-heat-v3-bg: #a3bf55;
    --crono-heat-v3: #1f2c02;
    --crono-heat-v3-line: #5f7a1c;
    --crono-cool-v1-bg: #6fd9ea;
    --crono-cool-v1: #033b45;
    --crono-cool-v1-line: #0c8399;
    --crono-cool-v2-bg: #c3a3f0;
    --crono-cool-v2: #2e1070;
    --crono-cool-v2-line: #7a4fc0;
    --crono-cool-v3-bg: #6fa9f0;
    --crono-cool-v3: #06234f;
    --crono-cool-v3-line: #2f6fc4;
    --crono-off-v1-bg: #a4aab6;
    --crono-off-v1: #14181d;
    --crono-off-v1-line: #5f6672;
    --crono-off-v2-bg: #747c8b;
    --crono-off-v2: #05070a;
    --crono-off-v2-line: #3f4652;
    --crono-off-v3-bg: #38404c;
    --crono-off-v3: #ffffff;
    --crono-off-v3-line: #1c2229;
    --crono-ok: #0f6636;
    --crono-ok-bg: #d6f1e0;
    --crono-field-line: #6f7a88;
    color: var(--crono-text);
    color-scheme: light; /* native controls (select, number arrows, scrollbars, datalist) follow the set in use */
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
    --crono-cool-line: #5b88d8;
    --crono-off: #c4cbd5;
    --crono-off-bg: #2b3038;
    --crono-off-line: #8791a0;
    --crono-heat-v1-bg: #7f2e1a;
    --crono-heat-v1: #ffd9cd;
    --crono-heat-v1-line: #d9674a;
    --crono-heat-v2-bg: #7a6a00;
    --crono-heat-v2: #fff6b0;
    --crono-heat-v2-line: #bfa200;
    --crono-heat-v3-bg: #3c5c1c;
    --crono-heat-v3: #dff0b5;
    --crono-heat-v3-line: #7aa83c;
    --crono-cool-v1-bg: #0a5c70;
    --crono-cool-v1: #c0f3fc;
    --crono-cool-v1-line: #2fa5c0;
    --crono-cool-v2-bg: #6b4fd6;
    --crono-cool-v2: #ffffff;
    --crono-cool-v2-line: #9a85f0;
    --crono-cool-v3-bg: #2a6fc0;
    --crono-cool-v3: #ffffff;
    --crono-cool-v3-line: #6aa6f0;
    --crono-off-v1-bg: #575e6b;
    --crono-off-v1: #ffffff;
    --crono-off-v1-line: #8a94a3;
    --crono-off-v2-bg: #7f8999;
    --crono-off-v2: #05070a;
    --crono-off-v2-line: #b0b9c6;
    --crono-off-v3-bg: #b4bdc9;
    --crono-off-v3: #0b0e12;
    --crono-off-v3-line: #d0d7e0;
    --crono-ok: #8be0ae;
    --crono-ok-bg: #123a24;
    --crono-field-line: #8b94a1;
    color-scheme: dark;
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
  ::placeholder {
    color: var(--crono-muted); /* the default grey of the browser is not tied to the theme */
    opacity: 1;
  }
  option {
    background: var(--crono-surface);
    color: var(--crono-text);
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
  .b-heat.v1 {
    background-color: var(--crono-heat-v1-bg);
    color: var(--crono-heat-v1);
    border-color: var(--crono-heat-v1-line);
  }
  .b-heat.v2 {
    background-color: var(--crono-heat-v2-bg);
    color: var(--crono-heat-v2);
    border-color: var(--crono-heat-v2-line);
  }
  .b-heat.v3 {
    background-color: var(--crono-heat-v3-bg);
    color: var(--crono-heat-v3);
    border-color: var(--crono-heat-v3-line);
  }
  .b-cool.v1 {
    background-color: var(--crono-cool-v1-bg);
    color: var(--crono-cool-v1);
    border-color: var(--crono-cool-v1-line);
  }
  .b-cool.v2 {
    background-color: var(--crono-cool-v2-bg);
    color: var(--crono-cool-v2);
    border-color: var(--crono-cool-v2-line);
  }
  .b-cool.v3 {
    background-color: var(--crono-cool-v3-bg);
    color: var(--crono-cool-v3);
    border-color: var(--crono-cool-v3-line);
  }
  .b-off.v1 {
    background-color: var(--crono-off-v1-bg);
    color: var(--crono-off-v1);
    border-color: var(--crono-off-v1-line);
  }
  .b-off.v2 {
    background-color: var(--crono-off-v2-bg);
    color: var(--crono-off-v2);
    border-color: var(--crono-off-v2-line);
  }
  .b-off.v3 {
    background-color: var(--crono-off-v3-bg);
    color: var(--crono-off-v3);
    border-color: var(--crono-off-v3-line);
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
