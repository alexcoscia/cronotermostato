// The day being edited: the big 0-24 bar (a segment per band, a button each) and
// the list of the bands of the day. The rows shown are given by the editor
// (`mergeDay`: bands of the user plus the calculated ones). The bar is a
// shortcut for mouse and touch: its segments are not tab stops (tabindex -1), because
// everything they do (choose a band) is reachable in the list; they keep a full label.
// Nothing needs dragging.

import { LitElement, html, css, nothing, repeat, styleMap } from "../lit.js";
import { base, modeColors } from "../styles.js";
import { iconPlus, iconCopy, iconAuto, iconMode, iconWarn } from "../icons.js";
import { createT, formatNumber } from "../lib/i18n.js";
import { stripSegments, segmentDetail } from "../lib/day-editing.js";
import "./crono-band-row.js";

const MODES = ["heat", "cool", "off"];
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const NOTICE_MS = 6000; // how long the announcement of an added band stays in the live region
const FLASH_MS = 2500; // how long the highlight of an added band lasts
const fmtTemp = (hass, value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? `${formatNumber(hass, value, { maximumFractionDigits: 2 })}°` : "");

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
    _flash: { state: true },
    _notice: { state: true },
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
      /* Calculated: dashed border plus stripes in a strip at the foot, never behind the text. */
      .seg.is-auto {
        padding-bottom: 9px;
      }
      .seg.is-auto::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 7px;
        background: repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px);
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
    this._flash = null; // key of the band just added (highlighted for a moment)
    this._notice = ""; // text for the live region
    this._timers = [];
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
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }

  _later(fn, ms) {
    this._timers.push(setTimeout(fn, ms));
  }

  /**
   * Select a band and move the focus to it. `added`: it was just added, so the first field gets
   * the focus (to type the times), the row is highlighted and "band added" is announced.
   * Otherwise (a bar segment was chosen) the row itself gets the focus: no keyboard on a phone.
   */
  async focusBand(key, { added = false } = {}) {
    this._selected = key;
    if (added) this._announceAdded(key);
    await this.updateComplete;
    for (const row of this.renderRoot.querySelectorAll("crono-band-row")) {
      if (row.band?.key === key) {
        await row.updateComplete;
        if (added) row.focusFirst();
        else row.focusRow();
        row.scrollIntoView?.({ block: "nearest" });
        return;
      }
    }
  }

  _announceAdded(key) {
    const t = createT(this.hass);
    const row = (this.rows ?? []).find((r) => r.key === key);
    this._flash = key;
    this._notice = "";
    // the text is set one frame after it is emptied, so the same text is announced again
    this._later(() => {
      this._notice = row ? t("band.added_named", { start: String(row.start), end: String(row.end) }) : t("band.added");
    }, 50);
    this._later(() => (this._flash = null), FLASH_MS);
    this._later(() => (this._notice = ""), NOTICE_MS);
  }

  _fire(name) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  _segmentLabel(t, row) {
    const mode = MODES.includes(row.mode) ? t(`mode.${row.mode}`) : "";
    const temp = fmtTemp(this.hass, row.temperature);
    return [`${row.start}–${row.end}`, mode, temp ? `${temp}C` : "", row.preset ? String(row.preset) : "", row.auto ? t("band.calculated") : ""].filter(Boolean).join(", ");
  }

  _segment(t, row, seg, errored) {
    const px = (seg.width / 100) * this._barPx;
    const detail = segmentDetail(px);
    const selected = this._selected === row.key;
    const cls = [`b-${MODES.includes(row.mode) ? row.mode : "off"}`, row.auto ? "is-auto" : "", errored ? "err" : "", "seg"].filter(Boolean).join(" ");
    const temperature = fmtTemp(this.hass, row.temperature);
    const level = ["none", "icon", "temperature", "preset", "full"].indexOf(detail);
    return html`<button
      type="button"
      tabindex="-1"
      class=${cls}
      style=${styleMap({ left: `${seg.left}%`, width: `${seg.width}%` })}
      aria-current=${selected ? "true" : "false"}
      aria-label=${this._segmentLabel(t, row)}
      title=${this._segmentLabel(t, row)}
      @click=${() => this._pick(row)}
    >
      ${level >= 1 ? iconMode(row.mode) : nothing}
      ${level >= 2 && temperature ? html`<span class="t">${temperature}</span>` : nothing}
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
      <span class="sr" role="status" aria-live="polite">${this._notice}</span>
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
              ?highlight=${this._flash === row.key}
            ></crono-band-row>
          </li>`,
        )}
      </ul>
    `;
  }
}

if (!customElements.get("crono-day")) customElements.define("crono-day", CronoDay);
