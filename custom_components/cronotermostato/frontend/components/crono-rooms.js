// The rooms of the selected program: every `climate` room of Home Assistant with the switch
// "assigned to this program", its status, pause and forcing. It owns the confirmations
// (moving a room from another program, taking a room off, compatibility warnings before
// assigning) and the calls; each action runs once per room at a time and the state is read
// again afterwards (`refresh` returns a promise). Errors of the server are shown on the room.

import { LitElement, html, css, nothing } from "../lit.js";
import { base } from "../styles.js";
import { iconWarn } from "../icons.js";
import { createT, languageOf } from "../lib/i18n.js";
import { pauseRoom, resumeRoom, resumeAuto } from "../lib/api.js";
import { dayLabel, HOLIDAY } from "../lib/day-editing.js";
import { roomRows, assignRoom, unassignRoom, forceRoom, createGuard, runAction, actionErrorMessage } from "../lib/rooms.js";
import "./crono-room-card.js";
import "./crono-manual-dialog.js";
import "./crono-dialog.js";

export class CronoRooms extends LitElement {
  static properties = {
    hass: { attribute: false },
    state: { attribute: false }, // state of the store: {rooms, programs, loading}
    program: { attribute: false }, // the selected program, as the server sent it
    canEdit: { type: Boolean },
    refresh: { attribute: false }, // () => Promise: read the state again
    _busy: { state: true },
    _errors: { state: true },
    _ask: { state: true },
    _manual: { state: true },
  };

  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        container-type: inline-size;
      }
      h3 {
        font-size: 15px;
        font-weight: 650;
      }
      ul.rooms {
        display: flex;
        flex-direction: column;
      }
      ul.rooms > li + li {
        border-top: 1px solid var(--crono-line);
      }
      ul.issues {
        display: flex;
        flex-direction: column;
        gap: 4px;
        list-style: disc;
        padding-inline-start: 20px;
        overflow-wrap: anywhere;
      }
      .warnbox {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .warnbox b {
        display: flex;
        gap: 6px;
        align-items: center;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.state = { rooms: [], programs: [], loading: false };
    this.program = null;
    this.canEdit = false;
    this.refresh = async () => {};
    this._guard = createGuard();
    this._busy = {};
    this._errors = {};
    this._ask = null; // {kind: "assign" | "unassign", row, plan, resolve}
    this._manual = null; // {id, busy, error}
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._answer(false); // a pending question is answered "no": nothing is sent
  }

  get _t() {
    return createT(this.hass);
  }

  get _programId() {
    return this.program?.program_id ?? this.program?.id ?? null;
  }

  _rows() {
    return roomRows({ hass: this.hass, rooms: this.state?.rooms, programs: this.state?.programs, programId: this._programId });
  }

  _setBusy(id, on) {
    const { [id]: _gone, ...rest } = this._busy;
    this._busy = on ? { ...rest, [id]: true } : rest;
  }

  _setError(id, message) {
    const { [id]: _gone, ...rest } = this._errors;
    this._errors = message ? { ...rest, [id]: message } : rest;
  }

  /** Run an action on a room: once at a time, with the room marked busy, the state read again, the error shown. */
  async _act(row, action) {
    if (this._guard.has(row.id)) return { status: "busy" };
    this._setBusy(row.id, true);
    this._setError(row.id, null);
    const result = await runAction(this._guard, row.id, action, { refresh: this.refresh });
    this._setBusy(row.id, false);
    if (result.status === "error") this._setError(row.id, actionErrorMessage(this._t, result.error));
    return result;
  }

  // ---- Questions (assign / move / remove) ----------------------------------------------------------

  _askUser(question) {
    return new Promise((resolve) => {
      this._ask = { ...question, resolve };
    });
  }

  _answer(yes) {
    const ask = this._ask;
    if (!ask) return;
    this._ask = null;
    ask.resolve(yes);
  }

  _onToggle = (event) => {
    const { row } = event.detail;
    if (!this.canEdit || !this.program) return;
    if (row.assignedHere) {
      this._act(row, () => unassignRoom(this.hass, { row, confirm: () => this._askUser({ kind: "unassign", row, plan: null }) }));
    } else {
      this._act(row, () => assignRoom(this.hass, { row, program: this.program, confirm: (plan) => this._askUser({ kind: "assign", row, plan }) }));
    }
  };

  // ---- Pause, resume, back to automatic ---------------------------------------------------------------

  _onPause = (event) => {
    const { row } = event.detail;
    this._act(row, () => pauseRoom(this.hass, row.id));
  };

  _onResume = (event) => {
    const { row } = event.detail;
    this._act(row, () => resumeRoom(this.hass, row.id));
  };

  _onAuto = (event) => {
    const { row } = event.detail;
    this._act(row, () => resumeAuto(this.hass, row.id));
  };

  // ---- Forcing ----------------------------------------------------------------------------------------------

  _onForce = (event) => {
    this._manual = { id: event.detail.row.id, busy: false, error: null };
  };

  _closeManual = () => {
    if (this._manual?.busy) return;
    this._manual = null;
  };

  _applyManual = async (event) => {
    const manual = this._manual;
    const row = this._rows().find((r) => r.id === manual?.id);
    if (!manual || !row || this._guard.has(row.id)) return;
    this._manual = { ...manual, busy: true, error: null };
    this._setBusy(row.id, true);
    const result = await runAction(this._guard, row.id, () => forceRoom(this.hass, row, event.detail.form), { refresh: this.refresh });
    this._setBusy(row.id, false);
    if (result.status === "error") this._manual = { ...this._manual, busy: false, error: actionErrorMessage(this._t, result.error) };
    else if (result.status === "done" && result.value?.invalid) this._manual = { ...this._manual, busy: false };
    else this._manual = null;
  };

  // ---- Rendering --------------------------------------------------------------------------------------------

  render() {
    const t = this._t;
    const rows = this._rows();
    const loading = this.state?.loading === true && rows.length === 0;
    const manualRow = this._manual ? (rows.find((r) => r.id === this._manual.id) ?? null) : null;
    return html`
      <h3 id="rooms-title">${t("room.title")}</h3>
      <p class="muted">${this.canEdit ? t("room.hint") : t("room.read_only")}</p>
      ${loading
        ? html`<p class="msg" role="status">${t("common.loading")}</p>`
        : rows.length === 0
          ? html`<p class="msg">${t("room.none")}</p>`
          : html`<ul class="rooms" aria-labelledby="rooms-title">
              ${rows.map(
                (row) => html`<li>
                  <crono-room-card
                    .hass=${this.hass}
                    .row=${row}
                    .canEdit=${this.canEdit}
                    .busy=${this._busy[row.id] === true}
                    .error=${this._errors[row.id] ?? null}
                    @crono-room-toggle=${this._onToggle}
                    @crono-room-force=${this._onForce}
                    @crono-room-pause=${this._onPause}
                    @crono-room-resume=${this._onResume}
                    @crono-room-auto=${this._onAuto}
                  ></crono-room-card>
                </li>`,
              )}
            </ul>`}
      ${this._renderAsk(t)}
      <crono-manual-dialog
        .hass=${this.hass}
        .room=${manualRow}
        ?open=${manualRow !== null}
        .busy=${this._manual?.busy === true}
        .error=${this._manual?.error ?? null}
        @crono-close=${this._closeManual}
        @crono-manual-apply=${this._applyManual}
      ></crono-manual-dialog>
    `;
  }

  // ONE <crono-dialog>, always rendered: only `open`, the heading and the content change.
  _renderAsk(t) {
    const ask = this._ask;
    const name = ask ? ask.row.name : "";
    const heading = !ask ? "" : ask.kind === "unassign" ? t("room.unassign_title", { name }) : ask.plan.moves ? t("room.move_title", { name }) : t("room.assign_title", { name });
    return html`<crono-dialog ?open=${ask !== null} ?alert=${ask?.kind === "unassign"} .heading=${heading} @crono-close=${() => this._answer(false)}>
      ${ask ? this._askContent(t, ask) : nothing}
      <button slot="actions" class="btn" type="button" @click=${() => this._answer(false)}>${t("common.cancel")}</button>
      ${ask?.kind === "unassign"
        ? html`<button slot="actions" class="btn danger" type="button" @click=${() => this._answer(true)}>${t("room.unassign")}</button>`
        : html`<button slot="actions" class="btn primary" type="button" @click=${() => this._answer(true)}>${t("room.assign")}</button>`}
    </crono-dialog>`;
  }

  _askContent(t, ask) {
    if (ask.kind === "unassign") return html`<p>${t("room.unassign_confirm", { name: ask.row.name })}</p>`;
    const language = languageOf(this.hass);
    const climate = ask.row.climate;
    const dayName = (day) => (day === HOLIDAY ? t("band.holiday") : dayLabel(day, language, "short"));
    return html`
      ${ask.plan.moves ? html`<p>${t("room.moves_from", { name: ask.plan.fromName })}</p>` : nothing}
      ${ask.plan.issues.length > 0
        ? html`<div class="msg warn warnbox" role="note">
            <span>
              <b>${iconWarn()}${t("room.issues_title")}</b>
              <span>${t("room.issues_note")}</span>
              <ul class="issues">
                ${ask.plan.issues.map((issue) => {
                  const params = {
                    mode: ["heat", "cool", "off"].includes(issue.mode) ? t(`mode.${issue.mode}`) : String(issue.mode),
                    preset: String(issue.preset),
                    temperature: String(issue.temperature),
                    min: String(climate?.minTemp ?? ""),
                    max: String(climate?.maxTemp ?? ""),
                  };
                  return html`<li>${t("editor.room_warning_days", { text: t(`issue.${issue.code}`, params), days: issue.days.map(dayName).join(", ") })}</li>`;
                })}
              </ul>
            </span>
          </div>`
        : nothing}
    `;
  }
}

if (!customElements.get("crono-rooms")) customElements.define("crono-rooms", CronoRooms);
