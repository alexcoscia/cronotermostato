// Dialog "force a setting": mode, temperature within the limits of the room, preset of the
// room. The setting lasts until the end of the current band. The form is checked here
// against the room (same rules as the server); an invalid form cannot be sent. The parent
// owns `open`, `busy` and `error` and does the call (event `crono-manual-apply`,
// detail `{form}`; `crono-close` to leave). `off` carries neither temperature nor preset.

import { LitElement, html, css, nothing } from "../lit.js";
import { base, fields } from "../styles.js";
import { iconWarn } from "../icons.js";
import { createT, formatNumber } from "../lib/i18n.js";
import { manualModes, manualDefaults, validateManual, untilText, stepNotice } from "../lib/rooms.js";
import "./crono-dialog.js";

const FORM_ID = "manual-form";

export class CronoManualDialog extends LitElement {
  static properties = {
    hass: { attribute: false },
    room: { attribute: false }, // a row of `roomRows`
    open: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    _form: { state: true },
    _touched: { state: true },
  };

  static styles = [
    base,
    fields,
    css`
      :host {
        display: contents;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .hint {
        font-size: 13px;
        color: var(--crono-muted);
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.room = null;
    this.open = false;
    this.busy = false;
    this.error = null;
    this._form = null;
    this._touched = false;
  }

  // The form starts when the dialog opens and is not reset by later refreshes of the room.
  willUpdate() {
    if (this.open && this.room && this._form === null) {
      this._form = manualDefaults(this.room);
      this._touched = false;
    } else if (!this.open && this._form !== null) {
      this._form = null;
    }
  }

  _set(patch) {
    this._form = { ...this._form, ...patch };
    this._touched = true;
  }

  _close = (event) => {
    // crono-close of the inner dialog would bubble to the parent as well: one event leaves, ours
    if (event?.type === "crono-close") event.stopPropagation();
    this.dispatchEvent(new CustomEvent("crono-close", { bubbles: true, composed: true }));
  };

  _numberFormat = (value) => formatNumber(this.hass, value, { maximumFractionDigits: 2 });

  _errorText(t, error) {
    if (error.code === "out_of_range") return t("issue.out_of_range", error.params);
    if (error.code === "unsupported_preset") return t("issue.unsupported_preset", error.params);
    if (error.code === "unsupported_mode") return t("issue.unsupported_mode", { mode: t(`mode.${error.params.mode}`) });
    return t(`validation.${error.code}`);
  }

  _submit = (event) => {
    event.preventDefault();
    this._touched = true;
    if (this.busy || !this._form) return;
    if (!validateManual(this._form, this.room?.climate, this._numberFormat).ok) return;
    this.dispatchEvent(new CustomEvent("crono-manual-apply", { detail: { form: { ...this._form } }, bubbles: true, composed: true }));
  };

  render() {
    const t = createT(this.hass);
    const row = this.room;
    const form = this._form;
    const climate = row?.climate ?? null;
    const heading = row ? `${t("room.force")}: ${row.name}` : "";
    let body = nothing;
    let valid = false;
    if (row && form) {
      const checked = validateManual(form, climate, this._numberFormat);
      valid = checked.ok;
      const off = form.mode === "off";
      // "missing" is only said once the user has touched the form: an empty form is not a mistake yet
      const shown = (field) => {
        const error = checked.errors[field];
        return error && (this._touched || error.code !== "missing_setting") ? error : null;
      };
      const temperatureError = shown("temperature");
      const presetError = shown("preset");
      const modeError = shown("mode");
      const until = untilText(t, row.server?.slot?.end, { now: new Date(), timeZone: this.hass?.config?.time_zone });
      const presets = climate?.presetModes ?? [];
      const step = stepNotice(form, climate);
      body = html`
        <form id=${FORM_ID} novalidate @submit=${this._submit}>
          <label>
            ${t("band.mode")}
            <select
              name="mode"
              aria-invalid=${modeError ? "true" : "false"}
              aria-describedby=${modeError ? "mode-err" : nothing}
              @change=${(e) => this._set({ mode: e.target.value })}
            >
              ${manualModes(climate).map((m) => html`<option value=${m} ?selected=${form.mode === m}>${t(`mode.${m}`)}</option>`)}
            </select>
          </label>
          ${modeError ? html`<p class="fe" id="mode-err" role="alert">${iconWarn()}<span>${this._errorText(t, modeError)}</span></p>` : nothing}
          ${off
            ? nothing
            : html`
                <label>
                  ${t("band.temperature")} (${this.hass?.config?.unit_system?.temperature ?? "°C"})
                  <input
                    type="text"
                    name="temperature"
                    inputmode="decimal"
                    autocomplete="off"
                    .value=${form.temperature}
                    aria-invalid=${temperatureError ? "true" : "false"}
                    aria-describedby=${temperatureError ? "temp-limits temp-err" : "temp-limits"}
                    @input=${(e) => this._set({ temperature: e.target.value })}
                  />
                </label>
                ${climate ? html`<p class="hint" id="temp-limits">${t("room.temperature_limits", { min: this._numberFormat(climate.minTemp), max: this._numberFormat(climate.maxTemp) })}</p>` : html`<span id="temp-limits"></span>`}
                ${temperatureError ? html`<p class="fe" id="temp-err" role="alert">${iconWarn()}<span>${this._errorText(t, temperatureError)}</span></p>` : nothing}
                ${step
                  ? html`<p class="msg warn" role="note">${iconWarn()}<span>${t("room.step_note", { step: `${this._numberFormat(step.step)} ${this.hass?.config?.unit_system?.temperature ?? "°C"}` })}</span></p>`
                  : nothing}
                ${presets.length > 0
                  ? html`<label>
                      ${t("band.preset")}
                      <select
                        name="preset"
                        aria-invalid=${presetError ? "true" : "false"}
                        aria-describedby=${presetError ? "preset-err" : nothing}
                        @change=${(e) => this._set({ preset: e.target.value })}
                      >
                        <option value="" ?selected=${form.preset === ""}>${t("room.preset_none")}</option>
                        ${presets.map((p) => html`<option value=${p} ?selected=${form.preset === p}>${p}</option>`)}
                      </select>
                    </label>`
                  : nothing}
                ${presetError ? html`<p class="fe" id="preset-err" role="alert">${iconWarn()}<span>${this._errorText(t, presetError)}</span></p>` : nothing}
              `}
          <p class="hint">${t("room.force_note")}${until ? html` (${until})` : nothing}</p>
          ${this.error ? html`<p class="msg error" role="alert">${iconWarn()}<span>${this.error}</span></p>` : nothing}
        </form>
      `;
    }
    return html`
      <crono-dialog ?open=${this.open} .heading=${heading} @crono-close=${this._close}>
        ${body}
        <button slot="actions" class="btn" type="button" @click=${this._close}>${t("common.cancel")}</button>
        <button slot="actions" class="btn primary" type="submit" form=${FORM_ID} ?disabled=${!valid || this.busy}>${t("common.confirm")}</button>
      </crono-dialog>
    `;
  }
}

if (!customElements.get("crono-manual-dialog")) customElements.define("crono-manual-dialog", CronoManualDialog);
