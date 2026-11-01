// The day being edited: the big 0-24 bar (a segment per band, a button each) and
// the list of the bands of the day. The rows shown are given by the editor
// (`mergeDay`: bands of the user plus the calculated ones). The bar is a
// shortcut: everything it does (choose a band) is also reachable in the list, and
// nothing needs dragging.

import { LitElement, html, css, nothing, repeat, styleMap } from "../lit.js";
import { base, modeColors } from "../styles.js";
import { iconPlus, iconCopy, iconAuto, iconMode, iconWarn } from "../icons.js";
import { createT } from "../lib/i18n.js";
import { stripSegments, segmentDetail } from "../lib/day-editing.js";
import "./crono-band-row.js";

const MODES = ["heat", "cool", "off"];
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const fmtTemp = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}°` : "");

export class CronoDay extends LitElement {
  static properties = {
    hass: { attribute: false },
    label: { type: String }, // full name of the day
    rows: { attribute: false },
    errors: { attribute: false }, // Map band key -> errors
    step: { type: Number },
    presets: { attribute: false },
    hasRooms: { type: Boolean },
    readOnly: { type: Boolean },
    canAdd: { type: Boolean },
    _selected: { state: true },
    _barPx: { state: true },
  };

  static styles = [
    base,
    modeColors,
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
      h3 {
        font-size: 16px;
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      .tools {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .axis {
        position: relative;
        height: 16px;
      }
      .axis span {
        position: absolute;
        transform: translateX(-50%);
        font-size: 11px;
        color: var(--crono-muted);
        font-variant-numeric: tabular-nums;
      }
      .axis span:first-child {
        transform: none;
      }
      .axis span:last-child {
        transform: translateX(-100%);
      }
      @container (max-width: 480px) {
        .axis span.minor {
          display: none;
        }
      }
      .bar {
        position: relative;
        height: 76px;
        border-radius: 10px;
        background: var(--crono-surface2);
        border: 1px solid var(--crono-line);
      }
      .tick {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--crono-line);
        pointer-events: none;
      }
      .seg {
        position: absolute;
        top: 2px;
        bottom: 2px;
        min-width: 6px;
        padding: 0 2px;
        margin: 0;
        border: 1.5px solid;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
        overflow: hidden;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
      }
      .seg[aria-current="true"] {
        box-shadow: 0 0 0 3px var(--crono-focus);
        z-index: 2;
      }
      .seg.err {
        outline: 2px solid var(--crono-error);
        outline-offset: -3px;
      }
      .seg .t {
        font-variant-numeric: tabular-nums;
      }
      .seg .p {
        font-weight: 500;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .seg .calc {
        font-size: 11px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      ul.list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .info {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        color: var(--crono-muted);
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.label = "";
    this.rows = [];
    this.errors = new Map();
    this.step = 0.5;
    this.presets = [];
    this.hasRooms = false;
    this.readOnly = false;
    this.canAdd = true;
    this._selected = null;
    this._barPx = 0;
    this._observer = null;
  }

  firstUpdated() {
    const bar = this.renderRoot.querySelector(".bar");
    if (bar && typeof ResizeObserver === "function") {
      this._observer = new ResizeObserver(() => {
        this._barPx = bar.clientWidth;
      });
      this._observer.observe(bar);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = null;
  }

  /** Focus the first field of a band (after adding one). */
  async focusBand(key) {
    this._selected = key;
    await this.updateComplete;
    for (const row of this.renderRoot.querySelectorAll("crono-band-row")) {
      if (row.band?.key === key) {
        await row.updateComplete;
        row.focusFirst();
        row.scrollIntoView?.({ block: "nearest" });
        return;
      }
    }
  }

  _fire(name) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  _segmentLabel(t, row) {
    const mode = MODES.includes(row.mode) ? t(`mode.${row.mode}`) : "";
    const temp = fmtTemp(row.temperature);
    return [`${row.start}–${row.end}`, mode, temp ? `${temp}C` : "", row.preset ? String(row.preset) : "", row.auto ? t("band.calculated") : ""].filter(Boolean).join(", ");
  }

  _segment(t, row, seg, errored) {
    const px = (seg.width / 100) * this._barPx;
    const detail = segmentDetail(px);
    const selected = this._selected === row.key;
    const cls = [`b-${MODES.includes(row.mode) ? row.mode : "off"}`, row.auto ? "is-auto" : "", errored ? "err" : "", "seg"].filter(Boolean).join(" ");
    const level = ["none", "icon", "temperature", "preset", "full"].indexOf(detail);
    return html`<button
      type="button"
      class=${cls}
      style=${styleMap({ left: `${seg.left}%`, width: `${seg.width}%` })}
      aria-current=${selected ? "true" : "false"}
      aria-label=${this._segmentLabel(t, row)}
      title=${this._segmentLabel(t, row)}
      @click=${() => this._pick(row)}
    >
      ${level >= 1 ? iconMode(row.mode) : nothing}
      ${level >= 2 && fmtTemp(row.temperature) ? html`<span class="t">${fmtTemp(row.temperature)}</span>` : nothing}
      ${level >= 3 && row.preset ? html`<span class="p">${String(row.preset)}</span>` : nothing}
      ${level >= 4 && row.auto ? html`<span class="calc">${iconAuto()}${t("band.calculated")}</span>` : nothing}
    </button>`;
  }

  _pick(row) {
    this._selected = row.key;
    this.focusBand(row.key);
  }

  render() {
    const t = createT(this.hass);
    const rows = this.rows ?? [];
    const segments = stripSegments(rows);
    const hasUser = rows.some((r) => !r.auto);
    return html`
      <div class="head">
        <h3>${t("day.title", { day: this.label })}</h3>
        ${this.readOnly
          ? nothing
          : html`<div class="tools">
              <button class="btn" type="button" ?disabled=${!this.canAdd} @click=${() => this._fire("crono-add")}>${iconPlus()}<span>${t("band.add")}</span></button>
              <button class="btn" type="button" ?disabled=${!hasUser} @click=${() => this._fire("crono-copy")}>${iconCopy()}<span>${t("band.copy_to")}…</span></button>
            </div>`}
      </div>
      <div role="group" aria-label=${t("day.bar", { day: this.label })}>
        <div class="axis" aria-hidden="true">${HOURS.map((h) => html`<span class=${h % 6 === 0 ? "" : "minor"} style=${styleMap({ left: `${(h / 24) * 100}%` })}>${String(h).padStart(2, "0")}</span>`)}</div>
        <div class="bar">
          ${HOURS.slice(1, -1).map((h) => html`<i class="tick" style=${styleMap({ left: `${(h / 24) * 100}%` })}></i>`)}
          ${segments.map((seg) => this._segment(t, rows[seg.index], seg, (this.errors?.get(rows[seg.index].key) ?? []).length > 0))}
        </div>
      </div>
      ${!hasUser ? html`<p class="info">${t("day.empty")}</p>` : nothing}
      ${!this.canAdd && !this.readOnly ? html`<p class="info">${iconWarn()}<span>${t("day.full")}</span></p>` : nothing}
      <ul class="list" aria-label=${t("day.bands")}>
        ${repeat(
          rows,
          (row) => row.key,
          (row) => html`<li>
            <crono-band-row
              .hass=${this.hass}
              .band=${row}
              .errors=${this.errors?.get(row.key) ?? []}
              .step=${this.step}
              .presets=${this.presets}
              .hasRooms=${this.hasRooms}
              .readOnly=${this.readOnly}
              ?selected=${this._selected === row.key}
            ></crono-band-row>
          </li>`,
        )}
      </ul>
    `;
  }
}

if (!customElements.get("crono-day")) customElements.define("crono-day", CronoDay);
