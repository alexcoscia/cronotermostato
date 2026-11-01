// One room: name and area, the switch "assigned to this program", the status in words,
// the current and the next band, the "manual" badge with its way back, and the
// actions pause / resume / force. It only shows and asks: the parent does the work
// (events `crono-room-toggle|force|pause|resume|auto`, detail `{row}`).
// Names, areas, presets and statuses are bound as text, never as markup.

import { LitElement, html, css, nothing } from "../lit.js";
import { base, modeColors } from "../styles.js";
import { iconCheck, iconWarn, iconX, iconInfo, iconPause, iconHand, iconAuto, iconMode } from "../icons.js";
import { createT } from "../lib/i18n.js";
import { statusInfo, statusText, untilText, manualText, nextText, settingText } from "../lib/rooms.js";

const ICONS = { check: iconCheck, warn: iconWarn, x: iconX, info: iconInfo, pause: iconPause };

export class CronoRoomCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    row: { attribute: false },
    canEdit: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
  };

  static styles = [
    base,
    modeColors,
    css`
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      .room {
        display: grid;
        gap: 8px;
        padding: 12px 0;
        min-width: 0;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        align-items: center;
        justify-content: space-between;
      }
      .id {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1 1 160px;
      }
      .name {
        font-size: 16px;
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .area,
      .other {
        font-size: 13px;
        color: var(--crono-muted);
        overflow-wrap: anywhere;
      }
      .sw {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 0 4px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        cursor: pointer;
        text-align: start;
      }
      .sw[aria-disabled="true"] {
        opacity: 0.6;
        cursor: progress;
      }
      .track {
        position: relative;
        flex: none;
        width: 46px;
        height: 26px;
        border-radius: 999px;
        border: 2px solid var(--crono-field-line);
        background: var(--crono-surface2);
      }
      .sw[aria-checked="true"] .track {
        background: var(--crono-accent);
        border-color: var(--crono-accent);
      }
      .thumb {
        position: absolute;
        top: 1px;
        inset-inline-start: 1px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--crono-surface);
        border: 1px solid var(--crono-field-line);
        color: var(--crono-accent);
        display: grid;
        place-items: center;
        transition: inset-inline-start 0.12s;
      }
      .sw[aria-checked="true"] .thumb {
        inset-inline-start: 21px;
      }
      .thumb .ic {
        width: 12px;
        height: 12px;
      }
      @media (prefers-reduced-motion: reduce) {
        .thumb {
          transition: none;
        }
      }
      .assigned-static {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        color: var(--crono-ok);
      }
      .states {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .st {
        display: inline-flex;
        align-items: flex-start;
        gap: 6px;
        padding: 3px 10px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      .st .ic {
        margin-top: 2px;
      }
      .st.sev-ok {
        background: var(--crono-ok-bg);
        color: var(--crono-ok);
      }
      .st.sev-warn {
        background: var(--crono-warn-bg);
        color: var(--crono-warn);
      }
      .st.sev-error {
        background: var(--crono-error-bg);
        color: var(--crono-error);
      }
      .st.sev-info,
      .st.sev-neutral {
        background: var(--crono-off-bg);
        color: var(--crono-off);
      }
      .st.manual {
        background: var(--crono-heat-bg);
        color: var(--crono-heat);
      }
      .bands {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      .bands .ic {
        vertical-align: -3px;
        margin-inline-end: 6px;
      }
      .acts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .acts .btn {
        white-space: normal;
        text-align: center;
      }
      .btn[aria-disabled="true"] {
        opacity: 0.6;
        cursor: progress;
      }
      @container (max-width: 340px) {
        .acts .btn {
          flex: 1 1 100%;
        }
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.row = null;
    this.canEdit = false;
    this.busy = false;
    this.error = null;
  }

  _emit(name) {
    this.dispatchEvent(new CustomEvent(name, { detail: { row: this.row }, bubbles: true, composed: true }));
  }

  render() {
    const row = this.row;
    if (!row) return nothing;
    const t = createT(this.hass);
    const zone = { now: new Date(), timeZone: this.hass?.config?.time_zone, hass: this.hass };
    const info = statusInfo(row.status);
    const StatusIcon = ICONS[info.icon] ?? iconInfo;
    const server = row.server;
    const name = row.name;
    const paused = server !== null && (server.paused === true || row.status === "paused");
    const manual = server !== null && server.manual === true;
    const slot = server?.slot ?? null;
    const until = slot ? untilText(t, slot.end, zone) : null;
    const next = server ? nextText(t, server.next_slot, zone) : null;
    const blocked = this.busy ? "true" : nothing;
    return html`
      <div class="room" role="group" aria-label=${name} aria-busy=${this.busy ? "true" : "false"}>
        <div class="head">
          <div class="id">
            <strong class="name">${name}</strong>
            ${row.area ? html`<span class="area">${row.area}</span>` : nothing}
          </div>
          ${this.canEdit
            ? html`<button
                class="sw"
                type="button"
                role="switch"
                aria-checked=${row.assignedHere ? "true" : "false"}
                aria-disabled=${blocked}
                aria-label=${`${name}: ${t("room.assigned")}`}
                @click=${() => this._emit("crono-room-toggle")}
              >
                <span class="track" aria-hidden="true"><span class="thumb">${row.assignedHere ? iconCheck() : nothing}</span></span>
                <span>${t("room.assigned")}</span>
              </button>`
            : row.assignedHere
              ? html`<span class="assigned-static">${iconCheck()}${t("room.assigned")}</span>`
              : nothing}
        </div>
        ${row.otherProgramName !== null && row.otherProgramName !== undefined ? html`<span class="other">${t("room.other_program", { name: row.otherProgramName })}</span>` : nothing}
        <div class="states">
          <span class="st sev-${info.severity}">${StatusIcon()}<span>${statusText(t, row.status)}</span></span>
          ${manual ? html`<span class="st manual">${iconHand()}<span>${manualText(t, server.override_until, zone)}</span></span>` : nothing}
        </div>
        ${slot
          ? html`<div class="bands">
              <span>${iconMode(slot.mode)}${t("room.now", { text: [settingText(t, slot, zone), until].filter(Boolean).join(" · ") })}</span>
              ${next ? html`<span class="muted">${next}</span>` : nothing}
            </div>`
          : nothing}
        ${this.error ? html`<p class="msg error" role="alert">${iconWarn()}<span>${this.error}</span></p>` : nothing}
        ${this.busy ? html`<span class="sr" role="status">${t("room.working")}</span>` : nothing}
        ${server !== null
          ? html`<div class="acts">
              ${manual
                ? html`<button class="btn primary" type="button" aria-disabled=${blocked} aria-label=${`${t("room.resume_auto")}: ${name}`} @click=${() => this._emit("crono-room-auto")}>${iconAuto()}${t("room.resume_auto")}</button>`
                : nothing}
              <button class="btn" type="button" aria-disabled=${blocked} aria-label=${`${t("room.force")}: ${name}`} @click=${() => this._emit("crono-room-force")}>${iconHand()}${t("room.force")}</button>
              ${paused
                ? html`<button class="btn" type="button" aria-disabled=${blocked} aria-label=${`${t("room.resume")}: ${name}`} @click=${() => this._emit("crono-room-resume")}>${t("room.resume")}</button>`
                : html`<button class="btn" type="button" aria-disabled=${blocked} aria-label=${`${t("room.pause")}: ${name}`} @click=${() => this._emit("crono-room-pause")}>${iconPause()}${t("room.pause")}</button>`}
            </div>`
          : nothing}
      </div>
    `;
  }
}

if (!customElements.get("crono-room-card")) customElements.define("crono-room-card", CronoRoomCard);
