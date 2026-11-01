// One band of a day: start, end, mode, temperature and preset, each with its
// own label, and the errors of the band next to the field at fault. The row only
// reports changes (`crono-band-change` with {row, patch}); the editor owns the
// draft. Fields are committed on `change` (leaving the field or Enter), so a
// half-typed time never re-sorts the list under the cursor. Everything that
// comes from the user (preset) is bound as text.

import { LitElement, html, css, nothing, live } from "../lit.js";
import { base, modeColors, fields } from "../styles.js";
import { iconTrash, iconWarn, iconPlus, iconMinus, iconAuto, iconMode } from "../icons.js";
import { createT, formatNumber } from "../lib/i18n.js";
import { normalizeTime, presetIsKnown, stepTemperature } from "../lib/day-editing.js";

let uid = 0;
const MODES = ["heat", "cool", "off"];

export class CronoBandRow extends LitElement {
  static properties = {
    hass: { attribute: false },
    band: { attribute: false }, // a row of mergeDay: {key, start, end, mode, temperature, preset, auto}
    errors: { attribute: false }, // errors of this band
    step: { type: Number },
    presets: { attribute: false }, // string[]: union of the presets of the assigned rooms
    hasRooms: { type: Boolean }, // some room is assigned (a free preset can be checked)
    readOnly: { type: Boolean },
    selected: { type: Boolean, reflect: true },
    highlight: { type: Boolean, reflect: true }, // just added: a short highlight and a visible tag
  };

  static styles = [
    base,
    modeColors,
    fields,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      .row {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr);
        border: 1px solid;
        border-radius: 10px;
        overflow: hidden;
      }
      :host([selected]) .row {
        box-shadow: 0 0 0 3px var(--crono-focus);
      }
      .row.has-err {
        border: 2px solid var(--crono-error);
      }
      .row:focus {
        outline: none; /* programmatic focus only (tabindex -1): the ring of the row is the selection */
      }
      .row:focus-visible {
        outline: 3px solid var(--crono-focus);
        outline-offset: 2px;
      }
      .sw {
        background: currentColor;
      }
      /* A calculated band: the stripes are in the side strip, the text stays on a plain background. */
      .is-auto .sw {
        background: repeating-linear-gradient(135deg, currentColor 0 3px, transparent 3px 7px);
      }
      :host([highlight]) .row {
        animation: crono-added 1.6s ease-out 1;
      }
      @keyframes crono-added {
        from {
          box-shadow: 0 0 0 7px var(--crono-focus);
        }
        to {
          box-shadow: 0 0 0 0 transparent;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        :host([highlight]) .row {
          animation: none;
        }
      }
      .newtag {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        font-size: 12.5px;
        font-weight: 700;
        padding: 1px 8px;
        border: 1px solid currentColor;
        border-radius: 6px;
        color: var(--crono-text);
      }
      label {
        color: var(--crono-text); /* the muted colour is not guaranteed 4.5:1 on the tinted background of a mode */
      }
      .body {
        display: grid;
        gap: 10px;
        padding: 10px;
        min-width: 0;
        color: var(--crono-text);
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        align-items: center;
        min-width: 0;
      }
      .range {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
      }
      .mode,
      .autotag {
        color: var(--crono-text);
      }
      .mode {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-weight: 600;
        font-size: 12.5px;
      }
      .head .grow {
        flex: 1 1 auto;
      }
      .autotag {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        font-size: 12.5px;
        font-weight: 700;
        padding: 1px 8px;
        border: 1px dashed currentColor;
        border-radius: 6px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .span2 {
        grid-column: 1 / -1;
      }
      .cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      input.time,
      input.num {
        font-variant-numeric: tabular-nums;
      }
      .stepper {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 44px;
        gap: 6px;
        align-items: center;
      }
      .stepper input {
        text-align: center;
      }
      .stepper button {
        min-width: 44px;
        min-height: 44px;
        padding: 0;
        border: 1px solid var(--crono-line);
        border-radius: 8px;
        background: var(--crono-surface);
        color: var(--crono-text);
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .stepper button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .hint {
        font-size: 12.5px;
        color: var(--crono-text);
      }
      .values {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 16px;
        margin: 0;
      }
      .values > div {
        display: flex;
        gap: 6px;
      }
      .values dt {
        font-weight: 600;
      }
      .values dd {
        margin: 0;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .ro .head .range,
      .ro .head .mode {
        display: inline-flex;
      }
      .ro .head {
        justify-content: flex-start;
        grid-column: auto;
        grid-row: auto;
      }
      .ro .body {
        grid-template-columns: minmax(0, 1fr);
      }
      .ro .notes {
        grid-column: auto;
      }
      @container (min-width: 960px) {
        .grid {
          grid-template-columns: 100px 100px 170px 200px minmax(120px, 1fr);
          align-items: start;
        }
        .span2 {
          grid-column: auto;
        }
        .head .range,
        .head .mode {
          display: none;
        }
        .head {
          justify-content: flex-end;
        }
        .body {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
        }
        .head {
          grid-column: 2;
          grid-row: 1;
        }
        .grid,
        .notes {
          grid-column: 1;
        }
      }
      .notes {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.band = null;
    this.errors = [];
    this.step = 0.5;
    this.presets = [];
    this.hasRooms = false;
    this.readOnly = false;
    this.selected = false;
    this._id = `r${++uid}`;
  }

  _emit(patch) {
    this.dispatchEvent(new CustomEvent("crono-band-change", { detail: { row: this.band, patch }, bubbles: true, composed: true }));
  }

  _remove() {
    this.dispatchEvent(new CustomEvent("crono-band-remove", { detail: { row: this.band }, bubbles: true, composed: true }));
  }

  _onTime(field) {
    return (event) => {
      const value = normalizeTime(event.target.value);
      event.target.value = value;
      if (value !== this.band[field]) this._emit({ [field]: value });
    };
  }

  _onMode = (event) => this._emit({ mode: event.target.value });

  _onTemperature = (event) => this._emit({ temperature: event.target.value });

  _onPreset = (event) => {
    const value = event.target.value;
    this._emit({ preset: value.trim() === "" ? null : value });
  };

  _bump(direction) {
    this._emit({ temperature: stepTemperature(this.band.temperature, this.step, direction) });
  }

  /** Move the focus to the first field (after adding a band). Read only: to the row itself. */
  focusFirst() {
    const input = this.renderRoot?.querySelector("input.time:not([disabled])");
    if (input) input.focus();
    else this.focusRow();
  }

  /** Move the focus to the row (not a tab stop) without opening a keyboard on a phone: used when the bar segment is touched. */
  focusRow() {
    this.renderRoot?.querySelector(".row")?.focus({ preventScroll: true });
  }

  // The error lines of a field. They are linked to the field by aria-describedby (ids from
  // `errorIds`) and by aria-invalid, so they are read when the field gets the focus; the
  // summary of the editor announces the count when it changes. field "*": all (read only).
  _errorLines(t, ids, field) {
    const list = this._errorsOf(field);
    return list.map((e, i) => html`<span class="fe" id=${`${ids}-${field === "*" ? "all" : field}-${i}`}>${iconWarn()}<span>${t(`validation.${e.code}`)}</span></span>`);
  }

  _errorsOf(field) {
    return (this.errors ?? []).filter((e) => field === "*" || (e.field ?? null) === field);
  }

  render() {
    const band = this.band;
    if (!band) return nothing;
    const t = createT(this.hass);
    const id = this._id;
    const errors = this.errors ?? [];
    const has = (field) => errors.some((e) => (e.field ?? null) === field);
    const errorIds = (field) => errors.filter((e) => (e.field ?? null) === field).map((_, i) => `${id}-${field}-${i}`);
    const describedby = (field, ...extra) => [...extra, ...errorIds(field)].join(" ") || undefined;
    const hintId = `${id}-timehint`;
    const off = band.mode === "off";
    const modeClass = MODES.includes(band.mode) ? `b-${band.mode}` : "b-off";
    const locked = this.readOnly;
    const unknownPreset = this.hasRooms && !off && !presetIsKnown(band.preset, this.presets);
    const rowLabel = t("band.row", { start: String(band.start), end: String(band.end) });
    const tempValue = band.temperature === null || band.temperature === undefined ? "" : String(band.temperature);
    const header = html`
          <div class="head">
            <span class="range">${band.start}–${band.end}</span>
            <span class="mode">${iconMode(band.mode)}${MODES.includes(band.mode) ? t(`mode.${band.mode}`) : ""}</span>
            ${band.auto ? html`<span class="autotag">${iconAuto()}${t("band.calculated")}</span>` : nothing}
            ${this.highlight ? html`<span class="newtag">${iconPlus()}${t("band.added")}</span>` : nothing}
            <span class="grow"></span>
            ${locked || band.auto
              ? nothing
              : html`<button class="btn danger" type="button" aria-label=${t("band.remove_named", { start: String(band.start), end: String(band.end) })} title=${t("band.remove")} @click=${this._remove}>${iconTrash()}<span class="sr">${t("band.remove")}</span></button>`}
          </div>`;
    if (locked) return this._renderReadOnly(t, { band, off, modeClass, rowLabel, header, tempValue });
    return html`
      <div class="row ${modeClass} ${band.auto ? "is-auto" : ""} ${errors.length ? "has-err" : ""}" role="group" aria-label=${rowLabel} tabindex="-1">
        <span class="sw" aria-hidden="true"></span>
        <div class="body">
          ${header}
          <span class="sr" id=${hintId}>${t("band.time_hint")}</span>
          <div class="grid">
            <div class="cell">
              <label for=${`${id}-start`}>${t("band.start")}</label>
              <input class="time" id=${`${id}-start`} type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" .value=${live(String(band.start))} aria-invalid=${has("start") ? "true" : "false"} aria-describedby=${describedby("start", hintId) ?? nothing} @change=${this._onTime("start")} />
              ${this._errorLines(t, id, "start")}
            </div>
            <div class="cell">
              <label for=${`${id}-end`}>${t("band.end")}</label>
              <input class="time" id=${`${id}-end`} type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" .value=${live(String(band.end))} aria-invalid=${has("end") ? "true" : "false"} aria-describedby=${describedby("end", hintId) ?? nothing} @change=${this._onTime("end")} />
              ${this._errorLines(t, id, "end")}
            </div>
            <div class="cell span2">
              <label for=${`${id}-mode`}>${t("band.mode")}</label>
              <select id=${`${id}-mode`} aria-invalid=${has("mode") ? "true" : "false"} aria-describedby=${describedby("mode") ?? nothing} @change=${this._onMode}>
                ${MODES.map((m) => html`<option value=${m} ?selected=${band.mode === m}>${t(`mode.${m}`)}</option>`)}
              </select>
              ${this._errorLines(t, id, "mode")}
            </div>
            <div class="cell span2">
              <label for=${`${id}-temp`}>${t("band.temperature")} (°C)</label>
              <div class="stepper">
                <button type="button" ?disabled=${off} aria-label=${t("band.temp_down")} title=${t("band.temp_down")} @click=${() => this._bump(-1)}>${iconMinus()}</button>
                <input class="num" id=${`${id}-temp`} type="number" inputmode="decimal" step=${this.step} .value=${live(off ? "" : tempValue)} placeholder=${off ? "—" : ""} ?disabled=${off} aria-invalid=${has("temperature") ? "true" : "false"} aria-describedby=${describedby("temperature") ?? nothing} @change=${this._onTemperature} />
                <button type="button" ?disabled=${off} aria-label=${t("band.temp_up")} title=${t("band.temp_up")} @click=${() => this._bump(1)}>${iconPlus()}</button>
              </div>
              ${this._errorLines(t, id, "temperature")}
            </div>
            <div class="cell span2">
              <label for=${`${id}-preset`}>${t("band.preset")}</label>
              <input id=${`${id}-preset`} type="text" autocomplete="off" list=${`${id}-presets`} .value=${live(off ? "" : (band.preset ?? ""))} placeholder=${off ? "—" : ""} ?disabled=${off} aria-invalid=${has("preset") ? "true" : "false"} aria-describedby=${describedby("preset") ?? nothing} @change=${this._onPreset} />
              <datalist id=${`${id}-presets`}>${this.presets.map((p) => html`<option value=${p}></option>`)}</datalist>
              ${this._errorLines(t, id, "preset")}
              ${unknownPreset ? html`<span class="fw">${iconWarn()}<span>${t("band.preset_unknown", { preset: String(band.preset) })}</span></span>` : nothing}
            </div>
          </div>
          <div class="notes">
            ${this._errorLines(t, id, null)}
            ${band.auto ? html`<span class="hint">${t("band.auto_hint")}</span>` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Read only: the values as text, no field and no button, so the row adds no tab stop
   * (the row itself is only focusable by script). The errors, if any, are listed as text.
   */
  _renderReadOnly(t, { band, off, modeClass, rowLabel, header, tempValue }) {
    const errors = this.errors ?? [];
    const temperature = off || tempValue === "" ? null : `${formatNumber(this.hass, band.temperature, { maximumFractionDigits: 2 })} °C`;
    const preset = off || !band.preset ? null : String(band.preset);
    return html`
      <div class="row ro ${modeClass} ${band.auto ? "is-auto" : ""} ${errors.length ? "has-err" : ""}" role="group" aria-label=${rowLabel} tabindex="-1">
        <span class="sw" aria-hidden="true"></span>
        <div class="body">
          ${header}
          <dl class="values">
            ${temperature ? html`<div><dt>${t("band.temperature")}</dt><dd>${temperature}</dd></div>` : nothing}
            ${preset ? html`<div><dt>${t("band.preset")}</dt><dd>${preset}</dd></div>` : nothing}
          </dl>
          <div class="notes">
            ${this._errorLines(t, this._id, "*")}
            ${band.auto ? html`<span class="hint">${t("band.auto_hint")}</span>` : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("crono-band-row")) customElements.define("crono-band-row", CronoBandRow);
