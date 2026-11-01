// Visual editor of the Lovelace card (`cronotermostato-card-editor`), opened by the card picker
// of Home Assistant. Plain native controls (select, text input, checkboxes with labels): no `ha-*`
// component, which may not be loaded yet when the editor opens. Every change sends the whole
// configuration in a `config-changed` event, as Home Assistant requires.
// Program and room names are bound as text, never as markup.

import { LitElement, html, css, nothing } from "../lit.js";
import { tokens, base, fields } from "../styles.js";
import { syncTheme, watchTheme } from "../lib/theme.js";
import { createT } from "../lib/i18n.js";
import { loadState } from "../lib/api.js";
import { climateRooms } from "../lib/climate.js";
import { VIEWS, DEFAULT_VIEW } from "../lib/card-config.js";

const MAX_ATTEMPTS = 2; // the first read and one retry
const OPTIONS = ["title", "program_id", "rooms"];

export class CronoCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _programs: { state: true }, // null until read (or if it cannot be read: then a text field is shown)
  };

  static styles = [
    tokens,
    base,
    fields,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: var(--crono-text);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-bottom: 4px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--crono-muted);
      }
      .hint {
        font-size: 13px;
        color: var(--crono-muted);
      }
      label.check {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        font-size: 14px;
        font-weight: 400;
        color: var(--crono-text);
        overflow-wrap: anywhere;
      }
      input[type="checkbox"] {
        width: 22px;
        height: 22px;
        flex: none;
        accent-color: var(--crono-accent);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this._config = { view: DEFAULT_VIEW };
    this._programs = null;
    this._loaded = false;
    this._loading = false;
    this._attempts = 0;
  }

  /** Called by Home Assistant; never throws (the editor must open even on a configuration the card refuses). */
  setConfig(config) {
    this._config = config !== null && typeof config === "object" && !Array.isArray(config) ? { ...config } : { view: DEFAULT_VIEW };
  }

  willUpdate(changed) {
    if (changed.has("hass") && this.hass) syncTheme(this, this.hass);
    if (changed.has("hass") && this.hass && !this._loaded && !this._loading && this._attempts < MAX_ATTEMPTS) this._loadPrograms();
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) watchTheme(this, this.hass, changed.get("hass"));
  }

  // One read of the programs for the dropdown; if it fails, ONE more attempt the next time `hass`
  // changes (HA replaces it often). Never a loop; after that the text field stays.
  _loadPrograms() {
    this._loading = true;
    this._attempts += 1;
    loadState(this.hass).then(
      (state) => {
        this._loading = false;
        this._loaded = true;
        this._programs = state.programs.map((p) => ({ id: p.program_id ?? p.id, name: String(p.name ?? "") }));
      },
      () => {
        this._loading = false;
        this._programs = null;
      },
    );
  }

  get _view() {
    return VIEWS.includes(this._config.view) ? this._config.view : DEFAULT_VIEW;
  }

  get _rooms() {
    return Array.isArray(this._config.rooms) ? this._config.rooms.filter((id) => typeof id === "string") : [];
  }

  /** Sends the configuration: empty options are removed, keys unknown to the editor (type, grid_options...) are kept. */
  _emit(next) {
    const config = { ...next };
    for (const key of OPTIONS) {
      const value = config[key];
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0)) delete config[key];
    }
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  _valueChanged(key, value) {
    this._emit({ ...this._config, [key]: value });
  }

  _roomToggled(id, checked) {
    const chosen = new Set(this._rooms);
    if (checked) chosen.add(id);
    else chosen.delete(id);
    const known = climateRooms(this.hass).map((room) => room.id);
    // known rooms in their list order, then ids the list of HA no longer has
    const ordered = [...known.filter((room) => chosen.has(room)), ...[...chosen].filter((room) => !known.includes(room))];
    this._emit({ ...this._config, rooms: ordered });
  }

  render() {
    const t = createT(this.hass);
    const view = this._view;
    const title = typeof this._config.title === "string" ? this._config.title : "";
    return html`
      <div class="field">
        <label for="view">${t("card.view")}</label>
        <select id="view" @change=${(e) => this._valueChanged("view", e.target.value)}>
          <option value="rooms" ?selected=${view === "rooms"}>${t("card.view_rooms")}</option>
          <option value="editor" ?selected=${view === "editor"}>${t("card.view_editor")}</option>
        </select>
      </div>
      <div class="field">
        <label for="title">${t("card.title")}</label>
        <input id="title" type="text" .value=${title} @input=${(e) => this._valueChanged("title", e.target.value)} />
      </div>
      ${this._renderProgram(t, view)}
      ${view === "rooms" ? this._renderRooms(t) : nothing}
    `;
  }

  _renderProgram(t, view) {
    const current = typeof this._config.program_id === "string" ? this._config.program_id : "";
    const hint = t(view === "rooms" ? "card.program_hint_rooms" : "card.program_hint_editor");
    if (this._programs === null) {
      return html`<div class="field">
        <label for="program">${t("card.program_id")}</label>
        <input id="program" type="text" aria-describedby="program-hint" .value=${current} @input=${(e) => this._valueChanged("program_id", e.target.value)} />
        <span class="hint" id="program-hint">${hint}</span>
      </div>`;
    }
    const known = this._programs.some((program) => program.id === current);
    return html`<div class="field">
      <label for="program">${t("card.program")}</label>
      <select id="program" aria-describedby="program-hint" @change=${(e) => this._valueChanged("program_id", e.target.value)}>
        <option value="" ?selected=${current === ""}>${t("card.program_any")}</option>
        ${this._programs.map((program) => html`<option value=${program.id} ?selected=${program.id === current}>${program.name}</option>`)}
        ${current !== "" && !known ? html`<option value=${current} selected>${t("card.program_missing", { id: current })}</option>` : nothing}
      </select>
      <span class="hint" id="program-hint">${hint}</span>
    </div>`;
  }

  _renderRooms(t) {
    const climates = climateRooms(this.hass);
    const chosen = new Set(this._rooms);
    const known = new Set(climates.map((room) => room.id));
    const missing = this._rooms.filter((id) => !known.has(id));
    const entries = [...climates.map((room) => ({ id: room.id, label: room.name })), ...missing.map((id) => ({ id, label: t("card.room_missing", { id }) }))];
    return html`<fieldset aria-describedby="rooms-hint">
      <legend>${t("card.rooms")}</legend>
      <span class="hint" id="rooms-hint">${t("card.rooms_hint")}</span>
      ${entries.length === 0
        ? html`<p class="hint">${t("card.rooms_none")}</p>`
        : entries.map(
            (entry) => html`<label class="check">
              <input type="checkbox" .checked=${chosen.has(entry.id)} @change=${(e) => this._roomToggled(entry.id, e.target.checked)} />
              <span>${entry.label}</span>
            </label>`,
          )}
    </fieldset>`;
  }
}

if (!customElements.get("cronotermostato-card-editor")) customElements.define("cronotermostato-card-editor", CronoCardEditor);
