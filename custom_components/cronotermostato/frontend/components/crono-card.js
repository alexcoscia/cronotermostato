// The Lovelace card `cronotermostato-card`. Two views (option `view`):
//   "rooms"  (default) compact status of the rooms that follow a program: name, status in words,
//            current program, "until HH:MM", the Manual badge with "Back to automatic", pause and
//            forcing. It reuses `crono-rooms` / `crono-room-card` / `crono-manual-dialog` (compact,
//            read only: assigning and removing rooms stays in the editor) over the same store.
//   "editor" the full editor (`crono-editor`), with the card's `hass`.
// The card announces itself in the card picker (`window.customCards`) and offers a visual editor
// (`cronotermostato-card-editor`). Only HA's own card API is used: setConfig, set hass,
// getCardSize, getGridOptions, getStubConfig, getConfigElement.

import { LitElement, html, css, nothing } from "../lit.js";
import { tokens, base } from "../styles.js";
import { syncTheme, watchTheme } from "../lib/theme.js";
import { iconWarn } from "../icons.js";
import { sharedStore } from "../lib/store.js";
import { createT } from "../lib/i18n.js";
import { errorMessage } from "../lib/program-list.js";
import { normalizeConfig, createRowsMemo } from "../lib/card-config.js";
import "./crono-editor.js";
import "./crono-rooms.js";
import "./crono-card-editor.js";

export const CARD_TYPE = "cronotermostato-card";
export const DOCUMENTATION_URL = "https://github.com/alexcoscia/cronotermostato#readme";
const NARROW_PX = 600;
// Estimate for getCardSize when the card is not laid out yet (1 line = 50 px). Measured in Chrome
// at 360 px: a compact room 167-173 px (up to 247 with a long name), card chrome ~40 px, title ~42 px;
// the full editor 6174 px at 360 px and 4452 px at 800 px (the narrow value is used: too tall is harmless).
const ROOM_PX = 170;
const CHROME_PX = 40;
const TITLE_PX = 42;
const EDITOR_SIZE = 120;

/** Adds the card to `window.customCards` once (the module can be loaded twice; other cards may be there already). */
export function announceCard() {
  const cards = Array.isArray(window.customCards) ? window.customCards : (window.customCards = []);
  if (cards.some((card) => card?.type === CARD_TYPE)) return;
  cards.push({
    type: CARD_TYPE,
    name: "Cronotermostato",
    description: "Weekly heating programs: status and manual override of the rooms, or the full editor.", // English only: HA does not translate this field
    preview: false, // the card needs the integration and talks to it: no live preview in the picker
    documentationURL: DOCUMENTATION_URL,
  });
}

export class CronotermostatoCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _state: { state: true },
    _narrow: { state: true },
  };

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        container-type: inline-size;
        color: var(--crono-text);
      }
      .card {
        background: var(--crono-surface);
        border: 1px solid var(--crono-line);
        border-radius: var(--crono-radius);
        box-shadow: var(--crono-shadow);
        overflow: hidden;
        min-width: 0;
      }
      .card.bare {
        background: transparent;
        border: 0;
        box-shadow: none;
        overflow: visible;
      }
      h2 {
        padding: 16px 16px 4px;
        font-size: 20px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .bare > h2 {
        padding-inline: 0;
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 16px 12px;
        min-width: 0;
      }
      .bare > .body {
        padding: 0;
      }
      .msg button {
        margin-inline-start: auto;
      }
    `,
  ];

  static getConfigElement() {
    return document.createElement("cronotermostato-card-editor");
  }

  /** The configuration of a card just added from the picker: the compact view over every room that follows a program. */
  static getStubConfig() {
    return { view: "rooms" };
  }

  constructor() {
    super();
    this.hass = undefined;
    this._config = null;
    this._narrow = false;
    // The compact view uses the store shared by all the cards of the page (one subscription, one
    // read). The editor view has its own store inside `crono-editor` (a single long-lived instance).
    this._shared = sharedStore;
    this._store = null; // set while this card holds a reference of the shared store
    this._state = this._shared.peek().getState();
    this._off = null;
    this._resize = null;
    this._started = false;
    this._memo = createRowsMemo();
  }

  /** Called by Home Assistant with the configuration; a thrown error is shown by HA in place of the card. */
  setConfig(config) {
    this._config = normalizeConfig(config);
  }

  getCardSize() {
    const config = this._config ?? { view: "rooms", title: "" };
    // Connected and laid out: the measured height (1 line = 50 px). Otherwise an estimate.
    const measured = this.isConnected === true ? Number(this.offsetHeight) : 0;
    if (measured > 0) return Math.max(1, Math.ceil(measured / 50));
    const title = config.title ? TITLE_PX : 0;
    if (config.view === "editor") return Math.ceil(title / 50) + EDITOR_SIZE;
    return Math.ceil((CHROME_PX + title + Math.max(1, this._view().rows.length) * ROOM_PX) / 50);
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof ResizeObserver === "function") {
      this._resize = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect?.width ?? 0;
        this._narrow = width > 0 && width < NARROW_PX;
      });
      this._resize.observe(this);
    }
    this._syncStore();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._resize = null;
    this._releaseStore();
  }

  willUpdate(changed) {
    if (changed.has("hass") && this.hass) {
      if (this._started) this._store.setHass(this.hass);
      syncTheme(this, this.hass);
    }
    if (changed.has("hass") || changed.has("_config")) this._syncStore();
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) watchTheme(this, this.hass, changed.get("hass"));
  }

  // The shared store belongs to the compact view; the editor view has its own inside `crono-editor`.
  _syncStore() {
    const wanted = this.isConnected && this.hass !== undefined && this._config?.view === "rooms";
    if (wanted && !this._started) {
      this._started = true;
      this._store = this._shared.acquire(this.hass);
      this._state = this._store.getState();
      this._off = this._store.subscribe((state) => {
        this._state = state;
      });
    } else if (!wanted) {
      this._releaseStore();
    }
  }

  /** Gives back the listener and the reference of the shared store (the last card to leave stops it). */
  _releaseStore() {
    this._off?.();
    this._off = null;
    if (this._started) {
      this._started = false;
      this._shared.release();
    }
  }

  /** {rows, hass}: the rows of this card and the `hass` for the children, both stable while nothing relevant changed. */
  _view() {
    if (!this._config) return { rows: [], hass: this.hass };
    return this._memo({ hass: this.hass, rooms: this._state?.rooms, programs: this._state?.programs, config: this._config });
  }

  // Stable functions: new closures at every render would make the children render again.
  _refresh = () => this._shared.peek().refresh();
  _getState = () => this._shared.peek().getState();

  render() {
    const config = this._config;
    if (!config) return nothing;
    const t = createT(this.hass);
    const editor = config.view === "editor";
    return html`<div class="card ${editor ? "bare" : ""}">
      ${config.title ? html`<h2>${config.title}</h2>` : nothing}
      ${editor
        ? html`<crono-editor .hass=${this.hass} .programId=${config.program_id}></crono-editor>`
        : html`<div class="body">${this._renderRooms(t)}</div>`}
    </div>`;
  }

  _renderRooms(t) {
    const state = this._state;
    if (this.hass === undefined) return html`<p class="msg" role="status">${t("common.loading")}</p>`;
    if (state.notLoaded) return html`<p class="msg warn" role="status">${iconWarn()}<span>${t("state.not_loaded")}</span></p>`;
    if (state.error) {
      return html`<p class="msg error" role="alert">
        ${iconWarn()}<span>${errorMessage(t, state.error)}</span>
        <button class="btn" type="button" @click=${this._refresh}>${t("common.retry")}</button>
      </p>`;
    }
    const { rows, hass } = this._view();
    if (state.loading && rows.length === 0) return html`<p class="msg" role="status">${t("common.loading")}</p>`;
    if (rows.length === 0) {
      const filtered = this._config.rooms !== null || this._config.program_id !== null;
      const assigned = (Array.isArray(state.rooms) ? state.rooms : []).length > 0;
      return html`<p class="msg">${t(filtered && assigned ? "card.no_match" : "card.no_rooms")}</p>`;
    }
    return html`<crono-rooms
      compact
      .hass=${hass}
      .state=${state}
      .program=${null}
      .canEdit=${false}
      .refresh=${this._refresh}
      .getState=${this._getState}
      .rows=${rows}
    ></crono-rooms>`;
  }
}

if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, CronotermostatoCard);
