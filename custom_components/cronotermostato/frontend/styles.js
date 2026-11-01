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
    --crono-accent-fg: var(--text-primary-color, #ffffff);
    --crono-radius: var(--ha-card-border-radius, 12px);
    --crono-shadow: var(--ha-card-box-shadow, 0 1px 2px rgba(20, 30, 40, 0.08));
    --crono-focus: var(--primary-color, #0f6b63);
    --crono-error: #a31d1d;
    --crono-error-bg: #fde0e0;
    --crono-warn: #7f4500;
    --crono-warn-bg: #ffefc2;
    --crono-heat: #7a4300;
    --crono-heat-bg: #fde8bd;
    --crono-heat-line: #d99a2b;
    --crono-cool: #1b4a9e;
    --crono-cool-bg: #d8e6fd;
    --crono-cool-line: #6c9be8;
    --crono-off: #464e5b;
    --crono-off-bg: #e3e6ea;
    --crono-off-line: #9aa3af;
    --crono-ok: #0f6636;
    --crono-ok-bg: #d6f1e0;
    --crono-hatch: rgba(27, 33, 41, 0.28);
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
    --crono-hatch: rgba(232, 236, 241, 0.3);
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
  .btn.primary {
    background: var(--crono-accent);
    color: var(--crono-accent-fg);
    border-color: transparent;
    font-weight: 600;
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
