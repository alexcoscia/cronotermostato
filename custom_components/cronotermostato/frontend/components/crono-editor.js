// Root element of the editor. It owns the store (data from the server), the
// selected program and the layout; the pieces come in later steps.
// Used by the sidebar panel today and by the Lovelace card later: it only needs `hass`.

import { LitElement, html, css, nothing } from "../lit.js";
import { tokens, base } from "../styles.js";
import { iconWarn, iconCheck, iconDot } from "../icons.js";
import { createStore } from "../lib/store.js";
import { createT, tn, languageOf } from "../lib/i18n.js";
import { previewDay, saveProgram } from "../lib/api.js";
import { climateRooms } from "../lib/climate.js";
import { deserializeProgram } from "../lib/model.js";
import { canEdit, errorMessage } from "../lib/program-list.js";
import {
  HOLIDAY,
  draftFromServer,
  getDay,
  setDay,
  addBand,
  patchBand,
  removeBand,
  adoptAutoBand,
  copyDay,
  programErrors,
  isDirty,
  saveRequest,
  mergeDay,
  presetOptions,
  temperatureStep,
  createPreviewer,
  roomWarnings,
  dayLabel,
} from "../lib/day-editing.js";
import { sortPrograms, reconcileSelection, reconcileAfterDelete, neighbourId, selectionOf, pendingSelection, loadStoredSelection, storeSelection } from "../lib/program-list.js";
import "./crono-program-list.js";
import "./crono-week-tabs.js";
import "./crono-day.js";
import "./crono-dialog.js";

const PENDING_MS = 10000; // a just-created program that never shows up stops being waited for

const idOf = (program) => program.program_id ?? program.id;
const todayIndex = () => (new Date().getDay() + 6) % 7; // 0 = Monday
const WEEK = [0, 1, 2, 3, 4, 5, 6];

export class CronoEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    _state: { state: true },
    _selection: { state: true },
    _draft: { state: true },
    _previews: { state: true },
    _day: { state: true },
    _saving: { state: true },
    _saved: { state: true },
    _saveError: { state: true },
    _conflict: { state: true },
    _previewError: { state: true },
    _copy: { state: true },
    _switch: { state: true },
  };

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        color: var(--crono-text);
        container-type: inline-size; /* the layout follows the width of the panel, not of the window */
      }
      .layout {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
        max-width: 1100px;
        margin: 0 auto;
      }
      @container (min-width: 700px) {
        .layout {
          grid-template-columns: minmax(240px, 1fr) minmax(0, 2.2fr);
        }
      }
      .card {
        background: var(--crono-surface);
        border: 1px solid var(--crono-line);
        border-radius: var(--crono-radius);
        box-shadow: var(--crono-shadow);
        min-width: 0;
      }
      .listcard {
        padding: 12px;
      }
      .detail {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
      .detail-head {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .detail-head h2 {
        font-size: 20px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .section {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .section h3 {
        font-size: 15px;
        font-weight: 650;
      }
      .soon {
        border: 1px dashed var(--crono-off-line);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--crono-muted);
      }
      .soon b {
        color: var(--crono-off);
        font-size: 12.5px;
      }
      .msg button {
        margin-inline-start: auto;
      }
      .sec-head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: center;
        justify-content: space-between;
      }
      .state {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-weight: 600;
      }
      .state.dirty {
        color: var(--crono-warn);
      }
      .state.ok {
        color: var(--crono-ok);
      }
      .sep {
        border: 0;
        border-top: 1px solid var(--crono-line);
        margin: 4px 0;
      }
      .errlist,
      .notes {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-inline-start: 0;
      }
      .errlist li,
      .notes li {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        overflow-wrap: anywhere;
      }
      .msg b {
        display: block;
      }
      .msg .acts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .msg .acts button {
        margin-inline-start: 0;
      }
      .savebar {
        position: sticky;
        bottom: 0;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0 2px;
        background: var(--crono-surface);
        border-top: 1px solid var(--crono-line);
      }
      .savebar .btns {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .checks {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 4px 12px;
        border: 0;
        margin: 0;
        padding: 0;
      }
      .checks legend {
        font-weight: 600;
        padding: 0;
        margin-bottom: 6px;
      }
      .checks label {
        display: flex;
        gap: 10px;
        align-items: center;
        min-height: 44px;
      }
      .checks input {
        width: 22px;
        height: 22px;
        accent-color: var(--crono-accent);
      }
      .quick {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.narrow = false;
    this._store = createStore();
    this._state = this._store.getState();
    this._selection = selectionOf(loadStoredSelection());
    this._status = "none";
    this._deletedId = null; // deleted here, maybe still listed by a state read before the refresh
    this._orderedIds = []; // ids in list order at the last successful reconciliation
    this._off = null;
    this._pendingTimer = null;
    this._started = false;
    this._draft = null; // program being edited (client form, bands with keys)
    this._original = null; // the program as the server sent it when the draft was made
    this._previews = {}; // day -> normalized bands of the last preview (with calculated ones)
    this._day = todayIndex();
    this._saving = false;
    this._saved = false;
    this._saveError = null;
    this._conflict = false;
    this._previewError = null;
    this._copy = null; // {from, targets: number[]}
    this._copyDone = null;
    this._switch = null; // {id, pending}: a change of program waiting for the answer about unsaved changes
    this._ignoreRevision = null;
    this._previewer = createPreviewer({
      preview: (bands) => previewDay(this.hass, bands),
      onResult: (day, bands) => {
        this._previews = { ...this._previews, [day]: bands };
        this._previewError = null;
      },
      onError: (day, err) => {
        this._previewError = err;
      },
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this._off = this._store.subscribe((state) => this._onState(state));
    if (this.hass) this._start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._off?.();
    this._off = null;
    clearTimeout(this._pendingTimer);
    this._previewer.stop();
    this._store.stop();
    this._started = false;
  }

  willUpdate(changed) {
    if (!changed.has("hass") || !this.hass) return;
    this._store.setHass(this.hass);
    this.toggleAttribute("dark", this.hass.themes?.darkMode === true);
    if (this.isConnected && !this._started) this._start();
  }

  _start() {
    this._started = true;
    this._store.start(this.hass);
  }

  _onState(read) {
    if (this._deletedId !== null && !read.programs.some((p) => idOf(p) === this._deletedId)) this._deletedId = null;
    const state = this._deletedId === null ? read : { ...read, programs: read.programs.filter((p) => idOf(p) !== this._deletedId) };
    const { selection, status } = reconcileSelection(this._selection, state.programs);
    if (status === "ok") {
      this._orderedIds = sortPrograms(state.programs).map(idOf);
      if (selection.id !== this._selection.id) storeSelection(selection.id);
    }
    if (status !== "pending") {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }
    this._status = status;
    this._selection = selection;
    this._state = state;
    this._syncDraft(status === "ok" ? (state.programs.find((p) => idOf(p) === selection.id) ?? null) : null);
  }

  // ---- Draft ----------------------------------------------------------------------

  _loadDraft(server) {
    this._previewer.stop();
    this._original = deserializeProgram(server);
    this._draft = draftFromServer(server);
    const previews = {};
    (server.week_full ?? []).forEach((bands, day) => (previews[day] = bands));
    if (server.holiday_full) previews[HOLIDAY] = server.holiday_full;
    this._previews = previews;
    this._saved = false;
    this._saveError = null;
    this._conflict = false;
    this._previewError = null;
    this._ignoreRevision = null;
  }

  _clearDraft() {
    this._previewer.stop();
    this._draft = null;
    this._original = null;
    this._previews = {};
    this._conflict = false;
    this._saveError = null;
  }

  /** Follows the program of the state: a new draft for another program, a quiet reload when nothing is edited, a notice when it changed under unsaved edits. */
  _syncDraft(server) {
    if (!server) {
      if (this._draft) this._clearDraft();
      return;
    }
    if (!this._draft || this._draft.id !== idOf(server)) {
      this._loadDraft(server);
      return;
    }
    const revision = server.revision ?? null;
    if (revision === this._original.revision) {
      this._ignoreRevision = null;
      return;
    }
    if (revision === this._ignoreRevision) return; // a read made before our own save
    if (isDirty(this._draft, this._original)) this._conflict = true;
    else this._loadDraft(server);
  }

  get _dirty() {
    return this._draft !== null && isDirty(this._draft, this._original);
  }

  _edit(day, bands) {
    this._draft = setDay(this._draft, day, bands);
    this._saved = false;
    this._saveError = null;
    this._copyDone = null;
    this._afterEdit(day);
  }

  // After each edit: ask the server for the calculated bands of that day (debounced), unless the day has errors.
  _afterEdit(day) {
    if (programErrors(this._draft).summary.some((e) => e.day === day)) {
      this._previewer.cancel(day);
      const { [day]: _dropped, ...rest } = this._previews;
      this._previews = rest;
      return;
    }
    this._previewer.schedule(day, getDay(this._draft, day));
  }

  _onBandChange = (event) => {
    event.stopPropagation();
    const { row, patch } = event.detail;
    let bands = getDay(this._draft, this._day);
    let key = row.key;
    if (row.auto) ({ bands, key } = adoptAutoBand(bands, row));
    this._edit(this._day, patchBand(bands, key, patch));
  };

  _onBandRemove = (event) => {
    event.stopPropagation();
    this._edit(this._day, removeBand(getDay(this._draft, this._day), event.detail.row.key));
  };

  _onAdd = async () => {
    const added = addBand(getDay(this._draft, this._day));
    if (!added) return;
    this._edit(this._day, added.bands);
    await this.updateComplete;
    this.renderRoot.querySelector("crono-day")?.focusBand(added.key);
  };

  _onDaySelect = (event) => {
    this._day = event.detail.day;
  };

  _discard = () => {
    const server = this._state.programs.find((p) => idOf(p) === this._selection.id);
    if (server) this._loadDraft(server);
  };

  _reload = async () => {
    await this._store.refresh();
    this._discard();
  };

  _save = async (overwrite = false) => {
    if (!this._draft || this._saving) return;
    const server = this._state.programs.find((p) => idOf(p) === this._draft.id);
    const request = saveRequest(this._draft, { id: this._draft.id, name: server?.name ?? this._draft.name });
    if (overwrite) request.expectedRevision = undefined;
    this._saving = true;
    this._saveError = null;
    try {
      const result = await saveProgram(this.hass, request);
      this._ignoreRevision = this._original.revision;
      this._draft = { ...this._draft, revision: result.revision };
      this._original = { ...deserializeProgram({ program_id: this._draft.id, name: request.name, revision: result.revision, week: request.week, holiday: request.holiday }) };
      this._conflict = false;
      this._saved = true;
      this._store.refresh();
    } catch (err) {
      if (err?.code === "conflict") this._conflict = true;
      else this._saveError = err;
    } finally {
      this._saving = false;
    }
  };

  // ---- Copy a day onto other days ------------------------------------------------------

  _openCopy = () => {
    this._copy = { from: this._day, targets: [] };
  };

  _setTargets(targets) {
    this._copy = { ...this._copy, targets };
  }

  _toggleTarget(day, checked) {
    const set = new Set(this._copy.targets);
    if (checked) set.add(day);
    else set.delete(day);
    this._setTargets([...set].sort((a, b) => a - b));
  }

  _applyCopy = () => {
    const { from, targets } = this._copy;
    this._copy = null;
    if (targets.length === 0) return;
    this._draft = copyDay(this._draft, from, targets);
    this._saved = false;
    this._saveError = null;
    this._copyDone = targets.length;
    for (const day of targets) this._afterEdit(day);
  };

  _select(id, pending = false) {
    this._selection = pending ? pendingSelection(id) : selectionOf(id);
    if (!pending) storeSelection(id);
    this._onState(this._store.getState());
  }

  _onSelect = (event) => {
    const { id, pending } = event.detail;
    if (id !== this._selection.id && this._dirty) {
      this._switch = { id, pending }; // asks first: the unsaved changes would be lost
      return;
    }
    this._doSelect(id, pending);
  };

  _confirmSwitch = () => {
    const { id, pending } = this._switch;
    this._switch = null;
    this._clearDraft();
    this._doSelect(id, pending);
  };

  _doSelect(id, pending) {
    this._select(id, pending);
    if (pending) {
      this._store.refresh();
      // give up waiting after a while: a program that never arrives is not selected forever
      clearTimeout(this._pendingTimer);
      this._pendingTimer = setTimeout(() => {
        this._pendingTimer = null;
        if (this._selection.pending) this._select(null);
      }, PENDING_MS);
    }
  }

  _onDeleted = (event) => {
    const { id } = event.detail;
    this._deletedId = id;
    const { selection } = reconcileAfterDelete(this._orderedIds, this._store.getState().programs, id);
    this._select(selection.id);
    this._store.refresh();
  };

  _onRefresh = () => {
    this._store.refresh();
  };

  _pickAnother = () => {
    const state = this._store.getState();
    const remaining = sortPrograms(state.programs).map(idOf);
    this._select(neighbourId(this._orderedIds, this._selection.id, remaining));
  };

  render() {
    const t = createT(this.hass);
    const state = this._state;
    const selected = state.programs.find((p) => idOf(p) === this._selection.id) ?? null;
    return html`
      <div class="layout">
        <section class="card listcard" aria-label=${t("program.list")}>
          <crono-program-list
            .hass=${this.hass}
            .state=${state}
            .selectedId=${this._selection.id}
            @crono-select=${this._onSelect}
            @crono-deleted=${this._onDeleted}
            @crono-refresh=${this._onRefresh}
          ></crono-program-list>
        </section>
        <div class="detail">${this._renderDetail(t, selected)}</div>
      </div>
      ${this._renderDialogs(t)}
    `;
  }

  _renderDetail(t, selected) {
    const status = this._status;
    if (status === "removed") {
      return html`<div class="msg warn card" role="alert">
        ${iconWarn()}<span>${t("program.removed")}</span>
        <button class="btn" type="button" @click=${this._pickAnother}>${t("program.removed_pick")}</button>
      </div>`;
    }
    if (status === "pending") return html`<p class="msg" role="status">${t("program.pending")}</p>`;
    if (!selected) {
      return this._state.programs.length > 0 ? html`<p class="msg">${t("program.select")}</p>` : nothing;
    }
    const rooms = this._state.rooms.filter((room) => room.program_id === idOf(selected));
    const tName = String(selected.name);
    return html`
      <section class="card detail-head" aria-label=${t("program.detail", { name: tName })}>
        <h2 title=${tName}>${tName}</h2>
        <span class="muted">${tn(this.hass, "program.rooms", rooms.length)}</span>
      </section>
      ${this._renderWeek(t, selected, rooms)}
      ${this._placeholder(t, "editor.soon_holiday")}
      ${this._placeholder(t, "editor.soon_rooms")}
    `;
  }

  // ---- Week: strips, day, save bar ----------------------------------------------------

  _renderWeek(t, selected, rooms) {
    const draft = this._draft;
    if (!draft || draft.id !== idOf(selected)) return nothing;
    const language = languageOf(this.hass);
    const readOnly = !canEdit(this._state, this.hass);
    const { byKey, summary } = programErrors(draft);
    const assigned = new Set(rooms.map((r) => r.climate_entity_id));
    const climate = climateRooms(this.hass).filter((room) => assigned.has(room.id));
    const days = WEEK.map((i) => {
      const bands = getDay(draft, i);
      return {
        id: i,
        label: dayLabel(i, language, "short"),
        full: dayLabel(i, language, "long"),
        rows: mergeDay(bands, summary.some((e) => e.day === i) ? null : this._previews[i]),
        count: bands.length,
        errorCount: summary.filter((e) => e.day === i).length,
      };
    });
    const current = days.find((d) => d.id === this._day) ?? days[0];
    const dirty = this._dirty;
    const blocked = summary.length > 0;
    const stale = this._conflict;
    const canSave = dirty && !blocked && !this._saving && !readOnly && !stale;
    const full = addBand(getDay(draft, current.id)) === null;
    const presets = presetOptions(climate);
    return html`
      <section class="card section" aria-labelledby="week-title">
        <div class="sec-head">
          <h3 id="week-title">${t("editor.week")}</h3>
          ${readOnly ? html`<span class="state">${t("editor.read_only")}</span>` : nothing}
        </div>
        <p class="muted">${readOnly ? t("editor.admin_only") : t("editor.week_hint")}</p>
        ${stale
          ? html`<div class="msg warn" role="alert">
              ${iconWarn()}
              <span>
                <b>${t("editor.conflict_title")}</b>${t("editor.conflict")}
                <span class="acts">
                  <button class="btn" type="button" @click=${this._reload}>${t("common.reload")}</button>
                  <button class="btn danger" type="button" ?disabled=${this._saving || readOnly} @click=${() => this._save(true)}>${t("common.overwrite")}</button>
                </span>
              </span>
            </div>`
          : nothing}
        ${blocked ? this._renderErrors(t, draft, summary, language) : nothing}
        <crono-week-tabs .hass=${this.hass} .days=${days} .selected=${current.id} @crono-day-select=${this._onDaySelect}></crono-week-tabs>
        <hr class="sep" />
        <crono-day
          .hass=${this.hass}
          .label=${current.full}
          .rows=${current.rows}
          .errors=${byKey}
          .step=${temperatureStep(climate)}
          .presets=${presets}
          .hasRooms=${climate.length > 0}
          .readOnly=${readOnly}
          .canAdd=${!full}
          @crono-add=${this._onAdd}
          @crono-copy=${this._openCopy}
          @crono-band-change=${this._onBandChange}
          @crono-band-remove=${this._onBandRemove}
        ></crono-day>
        ${this._renderRoomWarnings(t, draft, climate, language)}
        ${this._previewError ? html`<p class="msg warn" role="status">${iconWarn()}<span>${t("editor.preview_failed", { message: errorMessage(t, this._previewError) })}</span></p>` : nothing}
        ${this._saveError ? html`<p class="msg error" role="alert">${iconWarn()}<span>${t("editor.save_failed", { message: errorMessage(t, this._saveError) })}</span></p>` : nothing}
        <div class="savebar">
          <span aria-live="polite">
            ${this._saving
              ? html`<span class="state">${t("editor.saving")}</span>`
              : dirty
                ? html`<span class="state dirty">${iconDot()}${t("editor.unsaved")}</span>`
                : this._saved
                  ? html`<span class="state ok">${iconCheck()}${t("editor.saved")}</span>`
                  : html`<span class="muted">${t("editor.no_changes")}</span>`}
            ${this._copyDone ? html` <span class="muted">${tn(this.hass, "copy.done", this._copyDone)}</span>` : nothing}
          </span>
          <span class="btns">
            <button class="btn" type="button" ?disabled=${!dirty || this._saving} @click=${this._discard}>${t("editor.discard")}</button>
            <button class="btn primary" type="button" ?disabled=${!canSave} aria-describedby=${blocked ? "week-errors" : nothing} @click=${() => this._save()}>${t("common.save")}</button>
          </span>
        </div>
      </section>
    `;
  }

  _renderErrors(t, draft, summary, language) {
    const lines = summary.map((e) => {
      const message = t(`validation.${e.code}`);
      if (e.day === null) return t("editor.error_line_name", { message });
      const day = e.day === HOLIDAY ? t("band.holiday") : dayLabel(e.day, language, "long");
      const band = e.key ? getDay(draft, e.day).find((b) => b.key === e.key) : null;
      return band ? t("editor.error_line", { day, start: String(band.start), end: String(band.end), message }) : t("editor.error_line_day", { day, message });
    });
    return html`<div class="msg error" id="week-errors" role="group" aria-label=${tn(this.hass, "editor.errors", summary.length)}>
      ${iconWarn()}
      <span>
        <b>${tn(this.hass, "editor.errors", summary.length)}</b>
        <ul class="errlist">${lines.map((line) => html`<li>${line}</li>`)}</ul>
      </span>
    </div>`;
  }

  _renderRoomWarnings(t, draft, climate, language) {
    const warnings = roomWarnings(draft, this._previews, climate);
    if (warnings.length === 0) return nothing;
    const dayName = (d) => (d === HOLIDAY ? t("band.holiday") : dayLabel(d, language, "short"));
    return html`<div class="msg warn" role="note">
      ${iconWarn()}
      <span>
        <b>${t("editor.room_warnings")}</b>
        <ul class="notes">
          ${warnings.map(({ room, items }) =>
            items.map((item) => {
              const params = { mode: item.mode && ["heat", "cool", "off"].includes(item.mode) ? t(`mode.${item.mode}`) : String(item.mode), preset: String(item.preset), temperature: String(item.temperature), min: String(room.minTemp), max: String(room.maxTemp) };
              const text = t("editor.room_warning_days", { text: t(`issue.${item.code}`, params), days: item.days.map(dayName).join(", ") });
              return html`<li><span><strong>${room.name}</strong>: ${text}</span></li>`;
            }),
          )}
        </ul>
      </span>
    </div>`;
  }

  _renderDialogs(t) {
    const language = languageOf(this.hass);
    const copy = this._copy;
    const from = copy ? dayLabel(copy.from, language, "long") : "";
    return html`
      <crono-dialog ?open=${copy !== null} heading=${t("copy.title", { day: from })} @crono-close=${() => (this._copy = null)}>
        ${copy
          ? html`<p>${t("copy.body", { day: from })}</p>
              <div class="quick">
                <button class="btn" type="button" @click=${() => this._setTargets(WEEK.slice(0, 5).filter((d) => d !== copy.from))}>${t("copy.weekdays")}</button>
                <button class="btn" type="button" @click=${() => this._setTargets([5, 6].filter((d) => d !== copy.from))}>${t("copy.weekend")}</button>
                <button class="btn" type="button" @click=${() => this._setTargets(WEEK.filter((d) => d !== copy.from))}>${t("copy.all")}</button>
                <button class="btn" type="button" @click=${() => this._setTargets([])}>${t("copy.none")}</button>
              </div>
              <fieldset class="checks">
                <legend>${t("copy.days")}</legend>
                ${WEEK.filter((d) => d !== copy.from).map(
                  (d) => html`<label><input type="checkbox" .checked=${copy.targets.includes(d)} @change=${(e) => this._toggleTarget(d, e.target.checked)} />${dayLabel(d, language, "long")}</label>`,
                )}
              </fieldset>`
          : nothing}
        <button slot="actions" class="btn" type="button" @click=${() => (this._copy = null)}>${t("common.cancel")}</button>
        <button slot="actions" class="btn primary" type="button" ?disabled=${!copy || copy.targets.length === 0} @click=${this._applyCopy}>${t("copy.apply")}</button>
      </crono-dialog>
      <crono-dialog ?open=${this._switch !== null} alert heading=${t("editor.switch_title")} @crono-close=${() => (this._switch = null)}>
        <p>${t("editor.switch_body")}</p>
        <button slot="actions" class="btn" type="button" @click=${() => (this._switch = null)}>${t("editor.switch_keep")}</button>
        <button slot="actions" class="btn danger" type="button" @click=${this._confirmSwitch}>${t("editor.switch_discard")}</button>
      </crono-dialog>
    `;
  }

  // PLACEHOLDERS: marked, they simulate nothing (no buttons, no fake data).
  // Task 8 put the week in place of the first; Task 9 adds the holiday part, Task 10 the rooms.
  _placeholder(t, textKey) {
    return html`<section class="card section">
      <div class="soon"><b>${t("editor.soon")}</b><span>${t(textKey)}</span></div>
    </section>`;
  }
}

if (!customElements.get("crono-editor")) customElements.define("crono-editor", CronoEditor);
