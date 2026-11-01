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
import { iconWarn } from "../icons.js";
import { createStore } from "../lib/store.js";
import { createT } from "../lib/i18n.js";
import { errorMessage } from "../lib/program-list.js";
import { roomRows } from "../lib/rooms.js";
import { normalizeConfig, cardRows } from "../lib/card-config.js";
import "./crono-editor.js";
import "./crono-rooms.js";
import "./crono-card-editor.js";

export const CARD_TYPE = "cronotermostato-card";
export const DOCUMENTATION_URL = "https://github.com/alexcoscia/cronotermostato#readme";
const NARROW_PX = 600;
const ROOM_SIZE = 3; // lines of a room in getCardSize (1 line = 50 px)
const EDITOR_SIZE = 12;

/** Adds the card to `window.customCards` once (the module can be loaded twice; other cards may be there already). */
export function announceCard() {
  const cards = Array.isArray(window.customCards) ? window.customCards : (window.customCards = []);
  if (cards.some((card) => card?.type === CARD_TYPE)) return;
  cards.push({
    type: CARD_TYPE,
    name: "Cronotermostato",
    description: "Weekly heating programs: status and manual override of the rooms, or the full editor. / Programmi settimanali del riscaldamento: stato e forzatura delle stanze, oppure l'editor completo.",
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
    this._store = createStore();
    this._state = this._store.getState();
    this._off = null;
    this._resize = null;
    this._started = false;
  }

  /** Called by Home Assistant with the configuration; a thrown error is shown by HA in place of the card. */
  setConfig(config) {
    this._config = normalizeConfig(config);
  }

  getCardSize() {
    const config = this._config ?? { view: "rooms", title: "" };
    const title = config.title ? 1 : 0;
    if (config.view === "editor") return title + EDITOR_SIZE;
    return title + Math.max(1, this._rows().length) * ROOM_SIZE;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback() {
    super.connectedCallback();
    this._off = this._store.subscribe((state) => {
      this._state = state;
    });
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
    this._off?.();
    this._off = null;
    this._resize?.disconnect();
    this._resize = null;
    this._store.stop();
    this._started = false;
  }

  willUpdate(changed) {
    if (changed.has("hass") && this.hass) {
      this._store.setHass(this.hass);
      this.toggleAttribute("dark", this.hass.themes?.darkMode === true);
    }
    if (changed.has("hass") || changed.has("_config")) this._syncStore();
  }

  // The store belongs to the compact view; the editor view has its own inside `crono-editor`.
  _syncStore() {
    const wanted = this.isConnected && this.hass !== undefined && this._config?.view === "rooms";
    if (wanted && !this._started) {
      this._started = true;
      this._store.start(this.hass);
    } else if (!wanted && this._started) {
      this._started = false;
      this._store.stop();
    }
  }

  _rows() {
    const config = this._config;
    if (!config) return [];
    const rows = roomRows({ hass: this.hass, rooms: this._state?.rooms, programs: this._state?.programs, programId: null });
    return cardRows(rows, config);
  }

  _refresh = () => this._store.refresh();

  render() {
    const config = this._config;
    if (!config) return nothing;
    const t = createT(this.hass);
    const editor = config.view === "editor";
    return html`<div class="card ${editor ? "bare" : ""}">
      ${config.title ? html`<h2>${config.title}</h2>` : nothing}
      ${editor
        ? html`<crono-editor .hass=${this.hass} .narrow=${this._narrow} .programId=${config.program_id}></crono-editor>`
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
    const rows = this._rows();
    if (state.loading && rows.length === 0) return html`<p class="msg" role="status">${t("common.loading")}</p>`;
    if (rows.length === 0) {
      const filtered = this._config.rooms !== null || this._config.program_id !== null;
      const assigned = (Array.isArray(state.rooms) ? state.rooms : []).length > 0;
      return html`<p class="msg">${t(filtered && assigned ? "card.no_match" : "card.no_rooms")}</p>`;
    }
    return html`<crono-rooms
      compact
      .hass=${this.hass}
      .state=${state}
      .program=${null}
      .canEdit=${false}
      .refresh=${this._refresh}
      .getState=${() => this._store.getState()}
      .filter=${(all) => cardRows(all, this._config)}
    ></crono-rooms>`;
  }
}

if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, CronotermostatoCard);
