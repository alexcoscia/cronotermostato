// Entry point of the Cronotermostato frontend, loaded by Home Assistant as a
// module (versioned URL). It defines the sidebar panel, the Lovelace card
// (`cronotermostato-card`, with its visual editor) and announces the card in the card picker.

import { LitElement, html, css } from "./lit.js";
import { iconMenu } from "./icons.js";
import { createT } from "./lib/i18n.js";
import "./components/crono-editor.js";
import { announceCard } from "./components/crono-card.js"; // defines cronotermostato-card and its editor

export class CronotermostatoPanel extends LitElement {
  // Set by Home Assistant on a custom panel.
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
  };

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--primary-background-color, #eceff3);
      color: var(--primary-text-color, #1b2129);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 56px;
      padding: 0 12px;
      padding-top: env(safe-area-inset-top, 0px);
      background: var(--app-header-background-color, var(--primary-color, #0f6b63));
      color: var(--app-header-text-color, var(--text-primary-color, #fff));
      box-shadow: var(--mdc-top-app-bar-fixed-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.2));
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 400;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    button {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid currentColor;
      outline-offset: -3px;
    }
    .ic {
      width: 24px;
      height: 24px;
    }
    crono-editor {
      padding: 16px;
      padding-left: max(16px, env(safe-area-inset-left, 0px));
      padding-right: max(16px, env(safe-area-inset-right, 0px));
      padding-bottom: 40px;
    }
  `;

  constructor() {
    super();
    this.hass = undefined;
    this.narrow = false;
    this.route = undefined;
    this.panel = undefined;
  }

  _toggleMenu() {
    // The convention of Home Assistant: the panel asks the shell to open the sidebar.
    this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  render() {
    const t = createT(this.hass);
    return html`
      <header>
        ${this.narrow ? html`<button type="button" aria-label=${t("app.menu")} @click=${this._toggleMenu}>${iconMenu()}</button>` : ""}
        <h1>${t("app.title")}</h1>
      </header>
      <crono-editor .hass=${this.hass} .narrow=${this.narrow}></crono-editor>
    `;
  }
}

if (!customElements.get("cronotermostato-panel")) customElements.define("cronotermostato-panel", CronotermostatoPanel);

announceCard();
