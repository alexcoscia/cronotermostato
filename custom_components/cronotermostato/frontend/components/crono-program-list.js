// The list of the programs and the actions on them: new, rename, duplicate, delete.
// `renderProgramList` is a plain function from a view object to a Lit template, so
// the node tests can look at exactly what is bound; the element below adds the
// dialogs and calls the API through lib/program-list.js. Names are only ever
// bound as text (never markup).

import { LitElement, html, css, nothing } from "../lit.js";
import { base } from "../styles.js";
import { iconPlus, iconEdit, iconCopy, iconTrash, iconWarn, iconCheck } from "../icons.js";
import { createT, tn } from "../lib/i18n.js";
import {
  summarizePrograms,
  listStatus,
  canEdit,
  cleanName,
  uniqueName,
  sameNameExists,
  blockAfterUnassign,
  deleteBlock,
  createNewProgram,
  duplicateProgram,
  renameProgram,
  removeProgram,
  unassignRooms,
  errorMessage,
} from "../lib/program-list.js";
import { climateRooms } from "../lib/climate.js";
import "./crono-dialog.js";

const programKey = (program) => program.program_id ?? program.id;

/** The template of the list column. `view` is described in the tests. */
export function renderProgramList(view) {
  const { t, tn: plural, status, error, summaries, selectedId, canEdit: editable, on } = view;
  const hasSelection = summaries.some((s) => s.id === selectedId);
  const actionsOff = !editable || !hasSelection;
  return html`
    <div class="head">
      <h2 id="list-title">${t("program.list")}</h2>
      <button class="btn primary" type="button" ?disabled=${!editable} @click=${on.create}>${iconPlus()}<span>${t("common.new")}</span></button>
    </div>
    ${status === "loading" ? html`<p class="msg" role="status">${t("state.loading")}</p>` : nothing}
    ${status === "not_loaded" ? html`<p class="msg warn" role="status">${iconWarn()}<span>${t("state.not_loaded")}</span></p>` : nothing}
    ${status === "error"
      ? html`<div class="msg error" role="alert">
          ${iconWarn()}<span>${t("state.error", { message: String(error?.message ?? "") })}</span>
          <button class="btn" type="button" @click=${on.retry}>${t("common.retry")}</button>
        </div>`
      : nothing}
    ${status === "empty" ? html`<p class="msg">${t("program.empty")}</p>` : nothing}
    ${status === "ready" && error
      ? html`<p class="msg error" role="alert">${iconWarn()}<span>${t("state.error", { message: String(error.message ?? "") })}</span></p>`
      : nothing}
    ${status === "ready"
      ? html`<ul aria-labelledby="list-title">
          ${summaries.map((s) => {
            const selected = s.id === selectedId;
            const rooms = plural("program.rooms", s.roomCount);
            const warnings = s.warnings > 0 ? plural("program.warnings", s.warnings) : "";
            return html`<li>
              <button
                class="row ${selected ? "selected" : ""}"
                type="button"
                aria-current=${selected ? "true" : "false"}
                aria-label=${[s.name, rooms, warnings, selected ? t("program.selected") : ""].filter(Boolean).join(", ")}
                title=${s.name}
                @click=${() => on.select(s.id)}
              >
                <span class="mark" aria-hidden="true">${selected ? iconCheck() : nothing}</span>
                <span class="text">
                  <span class="name">${s.name}</span>
                  <span class="meta">${rooms}</span>
                </span>
                ${s.warnings > 0 ? html`<span class="badge warn">${iconWarn()}${warnings}</span>` : nothing}
              </button>
            </li>`;
          })}
        </ul>`
      : nothing}
    ${status === "ready" || status === "empty"
      ? html`<div class="tools" role="group" aria-label=${t("program.actions")}>
          <button class="btn" type="button" ?disabled=${actionsOff} aria-label=${t("common.rename")} title=${t("common.rename")} @click=${on.rename}>${iconEdit()}<span class="lbl">${t("common.rename")}</span></button>
          <button class="btn" type="button" ?disabled=${actionsOff} aria-label=${t("common.duplicate")} title=${t("common.duplicate")} @click=${on.duplicate}>${iconCopy()}<span class="lbl">${t("common.duplicate")}</span></button>
          <button class="btn danger" type="button" ?disabled=${actionsOff} aria-label=${t("common.delete")} title=${t("common.delete")} @click=${on.remove}>${iconTrash()}<span class="lbl">${t("common.delete")}</span></button>
        </div>`
      : nothing}
    ${!editable ? html`<p class="msg">${t("editor.admin_only")}</p>` : nothing}
  `;
}

export class CronoProgramList extends LitElement {
  static properties = {
    hass: { attribute: false },
    state: { attribute: false }, // state of the store
    selectedId: { attribute: false },
    _dialog: { state: true },
  };

  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
        container-type: inline-size;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        align-items: center;
        justify-content: space-between;
      }
      h2 {
        font-size: 15px;
        font-weight: 650;
      }
      ul {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .row {
        width: 100%;
        min-height: 52px;
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        text-align: start;
        padding: 6px 10px;
        border: 1px solid var(--crono-line);
        border-radius: 10px;
        background: var(--crono-surface);
        cursor: pointer;
      }
      .row:hover {
        background: var(--crono-surface2);
      }
      .row.selected {
        border-color: var(--crono-accent);
        box-shadow: inset 4px 0 0 var(--crono-accent), 0 0 0 1px var(--crono-accent);
        font-weight: 600;
      }
      .mark {
        color: var(--crono-accent);
        display: grid;
      }
      .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta {
        font-size: 12.5px;
        font-weight: 400;
        color: var(--crono-muted);
      }
      .tools {
        display: grid;
        grid-template-columns: repeat(3, minmax(44px, 1fr));
        gap: 6px;
      }
      .tools .btn {
        padding: 0 4px;
        gap: 5px;
        min-width: 0;
        font-size: 13px;
      }
      /* very narrow list (small phone): icons only; the text stays as aria-label and title */
      @container (max-width: 250px) {
        .tools .lbl {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
      }
      .msg button {
        margin-inline-start: auto;
      }
      form {
        display: contents;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--crono-muted);
      }
      input[type="text"] {
        min-height: 44px;
        width: 100%;
        padding: 0 10px;
        border: 1px solid var(--crono-line);
        border-radius: 8px;
        background: var(--crono-surface);
        color: var(--crono-text);
      }
      .fw {
        color: var(--crono-warn);
        font-weight: 600;
        font-size: 12.5px;
      }
      .fe {
        color: var(--crono-error);
        font-weight: 600;
        font-size: 12.5px;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.state = { programs: [], rooms: [], loading: true, error: null, notLoaded: false, options: {} };
    this.selectedId = null;
    this._dialog = null; // {kind, program?, error?, busy?, nameError?}
  }

  get _t() {
    return createT(this.hass);
  }

  _program(id = this.selectedId) {
    return this.state.programs.find((p) => programKey(p) === id) ?? null;
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  _close = () => {
    if (this._dialog?.busy) return;
    this._dialog = null;
  };

  _open(kind, extra = {}) {
    const warning = extra.value !== undefined ? this._nameWarning(extra.value, kind === "rename" ? extra.program : null) : null;
    this._dialog = { kind, ...extra, warning };
  }

  _names() {
    return this.state.programs.map((p) => String(p.name));
  }

  _onNew = () => this._open("new", { value: uniqueName(this._t("program.untitled"), this._names()) });

  _onRename = () => {
    const program = this._program();
    if (program) this._open("rename", { program, value: String(program.name) });
  };

  _onDuplicate = () => {
    const program = this._program();
    if (program) this._open("duplicate", { program, value: uniqueName(this._t("program.copy_name", { name: program.name }), this._names()) });
  };

  _onDelete = () => {
    const program = this._program();
    if (!program) return;
    const block = deleteBlock(programKey(program), this.state.rooms);
    this._open(block ? "in_use" : "delete", { program, block });
  };

  async _run(work) {
    this._dialog = { ...this._dialog, busy: true, error: null, nameError: null };
    try {
      await work();
      this._dialog = null;
      this._emit("crono-refresh");
    } catch (err) {
      this._dialog = { ...this._dialog, busy: false, error: err?.blocked ? tn(this.hass, "program.in_use", err.blocked.count) : errorMessage(this._t, err) };
      if (err?.code === "not_found") this._emit("crono-refresh");
    }
  }

  /** Warn (not an error) when another program already has this name. */
  _nameWarning(value, program) {
    const programId = program ? programKey(program) : null;
    return sameNameExists(value, this.state.programs, programId) ? this._t("program.name_duplicate", { name: cleanName(value) }) : null;
  }

  _onNameInput = (event) => {
    const d = this._dialog;
    if (!d || d.busy) return;
    const value = event.target.value;
    this._dialog = { ...d, value, warning: d.kind === "rename" || d.kind === "new" || d.kind === "duplicate" ? this._nameWarning(value, d.kind === "rename" ? d.program : null) : null };
  };

  _submitName = (event) => {
    event.preventDefault();
    const dialog = this._dialog;
    if (!dialog || dialog.busy) return;
    const name = cleanName(new FormData(event.currentTarget).get("name"));
    if (name === null) {
      this._dialog = { ...dialog, nameError: this._t("program.name_empty") };
      return;
    }
    const { kind, program } = dialog;
    this._run(async () => {
      if (kind === "new") this._emit("crono-select", { id: await createNewProgram(this.hass, name), pending: true });
      else if (kind === "duplicate") this._emit("crono-select", { id: await duplicateProgram(this.hass, program, name), pending: true });
      else await renameProgram(this.hass, program, name);
    });
  };

  _confirmDelete = () => {
    const { program } = this._dialog;
    this._run(async () => {
      await removeProgram(this.hass, program, this.state.rooms);
      this._emit("crono-deleted", { id: programKey(program) });
    });
  };

  _removeFromRooms = () => {
    const { block } = this._dialog;
    this._run(async () => {
      const result = await unassignRooms(this.hass, block.roomIds);
      const { failed } = result;
      this._emit("crono-refresh");
      if (failed.length > 0) {
        // the retry must only concern the rooms still on the program
        this._dialog = { ...this._dialog, block: blockAfterUnassign(programKey(this._dialog.program), this.state.rooms, result) ?? { count: failed.length, roomIds: failed.map((f) => f.id) } };
        const err = new Error(this._t(failed.length === 1 ? "program.unassign_failed_one" : "program.unassign_failed_other", { count: failed.length }));
        err.code = "unassign_failed";
        throw err;
      }
    });
  };

  render() {
    const t = this._t;
    const plural = (key, count, params) => tn(this.hass, key, count, params);
    const { status, error } = listStatus(this.state);
    const summaries = summarizePrograms(this.state.programs, this.state.rooms, climateRooms(this.hass));
    return html`
      ${renderProgramList({
        t,
        tn: plural,
        status,
        error,
        summaries,
        selectedId: this.selectedId,
        canEdit: canEdit(this.state, this.hass),
        on: {
          select: (id) => this._emit("crono-select", { id, pending: false }),
          create: this._onNew,
          rename: this._onRename,
          duplicate: this._onDuplicate,
          remove: this._onDelete,
          retry: () => this._emit("crono-refresh"),
        },
      })}
      ${this._renderDialog(t)}
    `;
  }

  // ONE <crono-dialog> template, always rendered: only `open`, the heading and the
  // content change. Another template for each state would destroy the element while
  // the modal <dialog> is open and the browser could not return the focus.
  _renderDialog(t) {
    const d = this._dialog;
    const heading = !d
      ? ""
      : d.kind === "in_use"
        ? t("program.in_use_title")
        : d.kind === "delete"
          ? t("program.delete_title")
          : t(`program.${d.kind}_title`);
    return html`<crono-dialog ?open=${d !== null} ?alert=${d?.kind === "in_use" || d?.kind === "delete"} .heading=${heading} @crono-close=${this._close}>
      ${d ? this._dialogContent(t, d) : nothing}
    </crono-dialog>`;
  }

  _dialogContent(t, d) {
    const name = d.program ? String(d.program.name) : "";
    const error = d.error ? html`<p class="msg error" role="alert">${iconWarn()}<span>${d.error}</span></p>` : nothing;
    if (d.kind === "new" || d.kind === "rename" || d.kind === "duplicate") {
      const describedBy = [d.nameError ? "name-err" : "", d.warning ? "name-warn" : ""].filter(Boolean).join(" ");
      return html`
        <form id="name-form" @submit=${this._submitName}>
          <label>
            ${t("common.name")}
            <input type="text" name="name" .value=${d.value} required autocomplete="off" autofocus aria-invalid=${d.nameError ? "true" : "false"} aria-describedby=${describedBy || nothing} @input=${this._onNameInput} />
          </label>
          ${d.nameError ? html`<p class="fe" id="name-err" role="alert">${d.nameError}</p>` : nothing}
          ${d.warning ? html`<p class="fw" id="name-warn" role="status">${d.warning}</p>` : nothing}
        </form>
        ${error}
        <button slot="actions" class="btn" type="button" ?disabled=${d.busy} @click=${this._close}>${t("common.cancel")}</button>
        <button slot="actions" class="btn primary" type="submit" form="name-form" ?disabled=${d.busy}>${t("common.save")}</button>
      `;
    }
    if (d.kind === "in_use") {
      return html`
        <p>${tn(this.hass, "program.in_use", d.block.count)}</p>
        ${error}
        <button slot="actions" class="btn" type="button" ?disabled=${d.busy} @click=${this._close}>${t("common.close")}</button>
        <button slot="actions" class="btn primary" type="button" ?disabled=${d.busy || d.block.roomIds.length === 0} @click=${this._removeFromRooms}>${t("program.remove_from_rooms")}</button>
      `;
    }
    return html`
      <p>${t("program.delete_confirm", { name })}</p>
      ${error}
      <button slot="actions" class="btn" type="button" ?disabled=${d.busy} @click=${this._close}>${t("common.cancel")}</button>
      <button slot="actions" class="btn danger" type="button" ?disabled=${d.busy} @click=${this._confirmDelete}>${t("common.delete")}</button>
    `;
  }
}

if (!customElements.get("crono-program-list")) customElements.define("crono-program-list", CronoProgramList);
