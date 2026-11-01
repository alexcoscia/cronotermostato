// Root element of the editor. It owns the store (data from the server), the
// selected program and the layout; the pieces come in later steps.
// Used by the sidebar panel today and by the Lovelace card later: it only needs `hass`.

import { LitElement, html, css, nothing } from "../lit.js";
import { tokens, base } from "../styles.js";
import { iconWarn } from "../icons.js";
import { createStore } from "../lib/store.js";
import { createT, tn } from "../lib/i18n.js";
import { sortPrograms, reconcileSelection, reconcileAfterDelete, neighbourId, selectionOf, pendingSelection, loadStoredSelection, storeSelection } from "../lib/program-list.js";
import "./crono-program-list.js";

const PENDING_MS = 10000; // a just-created program that never shows up stops being waited for

const idOf = (program) => program.program_id ?? program.id;

export class CronoEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    _state: { state: true },
    _selection: { state: true },
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
  }

  _select(id, pending = false) {
    this._selection = pending ? pendingSelection(id) : selectionOf(id);
    if (!pending) storeSelection(id);
    this._onState(this._store.getState());
  }

  _onSelect = (event) => {
    const { id, pending } = event.detail;
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
  };

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
      ${this._placeholder(t, "editor.soon_week")}
      ${this._placeholder(t, "editor.soon_holiday")}
      ${this._placeholder(t, "editor.soon_rooms")}
    `;
  }

  // PLACEHOLDERS: marked, they simulate nothing (no buttons, no fake data).
  // Task 8 replaces the first with the week, Task 9 adds the holiday part, Task 10 the rooms.
  _placeholder(t, textKey) {
    return html`<section class="card section">
      <div class="soon"><b>${t("editor.soon")}</b><span>${t(textKey)}</span></div>
    </section>`;
  }
}

if (!customElements.get("crono-editor")) customElements.define("crono-editor", CronoEditor);
