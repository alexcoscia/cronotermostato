// One band of a day: start, end, mode, temperature and preset, each with its
// own label, and the errors of the band next to the field at fault. The row only
// reports changes (`crono-band-change` with {row, patch}); the editor owns the
// draft. Fields are committed on `change` (leaving the field or Enter), so a
// half-typed time never re-sorts the list under the cursor. Everything that
// comes from the user (preset) is bound as text.

import { LitElement, html, css, nothing } from "../lit.js";
import { base, modeColors, fields } from "../styles.js";
import { iconTrash, iconWarn, iconPlus, iconMinus, iconAuto, iconMode } from "../icons.js";
import { createT, formatNumber } from "../lib/i18n.js";
import { normalizeTime, stepTemperature } from "../lib/day-editing.js";
import { presetChoices } from "../lib/reference-room.js";
import { relativeIndex } from "../lib/focus.js";

let uid = 0;
const MODES = ["heat", "cool", "off"];

export class CronoBandRow extends LitElement {
  static properties = {
    hass: { attribute: false },
    tint: { type: Number }, // 0..3: variant of colour of the mode (bandTints of the day), 0 = the plain colour
    band: { attribute: false }, // a row of mergeDay: {key, start, end, mode, temperature, preset, auto}
    errors: { attribute: false }, // errors of this band
    step: { type: Number },
    presets: { attribute: false }, // string[]: presets of the reference room (or the union of the assigned rooms)
    hasRooms: { type: Boolean }, // there is a reference room (a preset can be checked)
    referenceName: { type: String }, // name of the single reference room; empty for "all assigned rooms"
    _otherOpen: { state: true }, // "Other…" chosen: the free text field is shown
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
        grid-template-columns: 30px minmax(0, 1fr);
        border: 1px solid;
        border-radius: 10px;
        overflow: hidden;
      }
      /* The fills of the modes are full colours now: the row keeps the card surface (so fields, hints and
         errors sit on it) and says the mode with its border and the chip beside it, same colours as its segment. */
      .row.b-heat,
      .row.b-cool,
      .row.b-off {
        background-color: var(--crono-surface);
        color: var(--crono-text);
      }
      .row.b-heat {
        border-color: var(--crono-heat-line);
      }
      .row.b-cool {
        border-color: var(--crono-cool-line);
      }
      .row.b-off {
        border-color: var(--crono-off-line);
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
      /* Side column with the chip of the band: the same fill, text and border colour as its segment in
         the bar of the day (class b-<mode> + v<n>), so row and segment are matched by colour. */
      .sw {
        display: flex;
        justify-content: center;
        padding-top: 12px;
      }
      .chip {
        box-sizing: border-box;
        width: 18px;
        height: 18px;
        border: 2px solid;
        border-radius: 5px;
      }
      /* A calculated band: dashed border and stripes inside the chip (it carries no text). */
      .chip.is-auto {
        background-image: repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px);
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
      label.sub {
        margin-top: 4px;
        font-size: 12.5px;
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
    this.referenceName = "";
    this._otherOpen = false;
    this._nav = null; // how the focus is leaving a field: {delta}
    this.readOnly = false;
    this.selected = false;
    this._id = `r${++uid}`;
  }

  // `source`: the field that changed. `focus` tells the editor where the focus has to be after the row is
  // recreated (a calculated band becomes the user's: new key, new row): {field, delta}, delta 0 = same field,
  // 1/-1 = the next/previous (Tab/Shift+Tab), null = unknown (a click: leave the focus alone).
  _emit(patch, source) {
    const prefix = `${this._id}-`;
    const id = typeof source?.id === "string" && source.id.startsWith(prefix) ? source.id.slice(prefix.length) : null;
    const delta = this._nav?.delta ?? (source?.tagName === "BUTTON" ? 0 : null);
    this._nav = null;
    const focus = id !== null && delta !== null ? { field: id, delta } : null;
    this.dispatchEvent(new CustomEvent("crono-band-change", { detail: { row: this.band, patch, focus }, bubbles: true, composed: true }));
  }

  _onKeydown = (event) => {
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) this._nav = { delta: event.shiftKey ? -1 : 1 };
    else if (event.key === "Enter") this._nav = { delta: 0 };
    else this._nav = null;
  };

  _onPointer = () => {
    this._nav = null;
  };

  _remove() {
    this.dispatchEvent(new CustomEvent("crono-band-remove", { detail: { row: this.band }, bubbles: true, composed: true }));
  }

  _onTime(field) {
    return (event) => {
      const value = normalizeTime(event.target.value);
      event.target.value = value;
      if (value !== this.band[field]) this._emit({ [field]: value }, event.target);
    };
  }

  _chipClass(band) {
    const mode = MODES.includes(band.mode) ? band.mode : "off";
    const tint = Number.isInteger(this.tint) && this.tint > 0 && this.tint < 4 ? ` v${this.tint}` : "";
    return `chip b-${mode}${tint}${band.auto ? " is-auto" : ""}`;
  }

  _onMode = (event) => this._emit({ mode: event.target.value }, event.target);

  _onTemperature = (event) => this._emit({ temperature: event.target.value }, event.target);

  _onPreset = (event) => {
    const value = event.target.value;
    this._emit({ preset: value.trim() === "" ? null : value }, event.target);
  };

  // The preset select: "" none, "@other" the free text field, "p:<name>" a preset (prefixed, so no
  // preset can be taken for one of the other two).
  _onPresetSelect = (event) => {
    const value = event.target.value;
    if (value === "@other") {
      this._otherOpen = true;
      this.updateComplete.then(() => this.renderRoot.querySelector("input.preset-other")?.focus());
      return;
    }
    this._otherOpen = false;
    this._emit({ preset: value.startsWith("p:") ? value.slice(2) : null }, event.target);
  };

  _bump(direction, event) {
    this._emit({ temperature: stepTemperature(this.band.temperature, this.step, direction) }, event?.currentTarget);
  }

  /** Focus the field `field` (its id after the row id) moved by `delta` among the fields of the row. */
  focusField(field, delta = 0) {
    const root = this.renderRoot;
    if (!root) return false;
    const list = [...root.querySelectorAll("input:not([disabled]), select:not([disabled]), button:not([disabled])")].filter((el) => !el.closest(".head"));
    const at = list.findIndex((el) => el.id === `${this._id}-${field}`);
    const target = list[relativeIndex(list.length, at, delta)];
    if (!target) return false;
    target.focus();
    return true;
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
    const choices = presetChoices({ rooms: this.hasRooms ? [{ presetModes: this.presets }] : [], current: off ? null : band.preset });
    const unknownPreset = !off && choices.unavailable;
    const presetNote = off ? null : !this.hasRooms ? "band.preset_need_room" : choices.noPresets ? "band.preset_room_empty" : null;
    const presetSelected = off ? "" : this._otherOpen ? "@other" : choices.current.trim() === "" ? "" : `p:${choices.current}`;
    const currentOption = !off && choices.current.trim() !== "" && !choices.presets.includes(choices.current);
    const unavailableLabel = choices.unavailable
      ? this.referenceName
        ? t("band.preset_unavailable_in", { preset: choices.current, room: this.referenceName })
        : t("band.preset_unavailable_all", { preset: choices.current })
      : choices.current;
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
      <div class="row ${modeClass} ${band.auto ? "is-auto" : ""} ${errors.length ? "has-err" : ""}" role="group" aria-label=${rowLabel} tabindex="-1" @keydown=${this._onKeydown} @pointerdown=${this._onPointer}>
        <span class="sw" aria-hidden="true"><span class=${this._chipClass(band)}></span></span>
        <div class="body">
          ${header}
          <span class="sr" id=${hintId}>${t("band.time_hint")}</span>
          <div class="grid">
            <div class="cell">
              <label for=${`${id}-start`}>${t("band.start")}</label>
              <input class="time" id=${`${id}-start`} type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" .value=${String(band.start)} aria-invalid=${has("start") ? "true" : "false"} aria-describedby=${describedby("start", hintId) ?? nothing} @change=${this._onTime("start")} />
              ${this._errorLines(t, id, "start")}
            </div>
            <div class="cell">
              <label for=${`${id}-end`}>${t("band.end")}</label>
              <input class="time" id=${`${id}-end`} type="text" inputmode="numeric" autocomplete="off" placeholder="HH:MM" .value=${String(band.end)} aria-invalid=${has("end") ? "true" : "false"} aria-describedby=${describedby("end", hintId) ?? nothing} @change=${this._onTime("end")} />
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
                <button type="button" id=${`${id}-down`} ?disabled=${off} aria-label=${t("band.temp_down")} title=${t("band.temp_down")} @click=${(e) => this._bump(-1, e)}>${iconMinus()}</button>
                <input class="num" id=${`${id}-temp`} type="number" inputmode="decimal" step=${this.step} .value=${off ? "" : tempValue} placeholder=${off ? "—" : ""} ?disabled=${off} aria-invalid=${has("temperature") ? "true" : "false"} aria-describedby=${describedby("temperature") ?? nothing} @change=${this._onTemperature} />
                <button type="button" id=${`${id}-up`} ?disabled=${off} aria-label=${t("band.temp_up")} title=${t("band.temp_up")} @click=${(e) => this._bump(1, e)}>${iconPlus()}</button>
              </div>
              ${this._errorLines(t, id, "temperature")}
            </div>
            <div class="cell span2">
              <label for=${`${id}-preset`}>${t("band.preset")}</label>
              <select id=${`${id}-preset`} ?disabled=${off} aria-invalid=${has("preset") ? "true" : "false"} aria-describedby=${describedby("preset", ...(presetNote ? [`${id}-presetnote`] : [])) ?? nothing} @change=${this._onPresetSelect}>
                <option value="" .selected=${presetSelected === ""}>${t("room.preset_none")}</option>
                ${choices.presets.map((p) => html`<option value=${`p:${p}`} .selected=${presetSelected === `p:${p}`}>${p}</option>`)}
                ${currentOption ? html`<option value=${`p:${choices.current}`} .selected=${presetSelected === `p:${choices.current}`}>${unavailableLabel}</option>` : nothing}
                <option value="@other" .selected=${presetSelected === "@other"}>${t("band.preset_free")}</option>
              </select>
              ${this._otherOpen && !off
                ? html`<label class="sub" for=${`${id}-preset-other`}>${t("band.preset_free_label")}</label>
                    <input class="preset-other" id=${`${id}-preset-other`} type="text" autocomplete="off" .value=${band.preset ?? ""} aria-invalid=${has("preset") ? "true" : "false"} aria-describedby=${describedby("preset") ?? nothing} @change=${this._onPreset} />`
                : nothing}
              ${presetNote ? html`<span class="hint" id=${`${id}-presetnote`}>${t(presetNote)}</span>` : nothing}
              ${this._errorLines(t, id, "preset")}
              ${unknownPreset ? html`<span class="fw">${iconWarn()}<span>${this.referenceName ? t("band.preset_unknown_room", { preset: String(band.preset), room: this.referenceName }) : t("band.preset_unknown", { preset: String(band.preset) })}</span></span>` : nothing}
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
        <span class="sw" aria-hidden="true"><span class=${this._chipClass(band)}></span></span>
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
