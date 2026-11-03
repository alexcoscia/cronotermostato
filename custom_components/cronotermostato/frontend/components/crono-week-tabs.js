// The days of the week as stacked 0-24 strips, each with a button that chooses
// the day (the strips are a picture of the same bands the table lists, so they
// are hidden from assistive technology; the button says how many bands the day
// has and whether it has errors). The editor passes `days`:
// [{id, label, full, rows, count, errorCount}], rows being mergeDay results.

import { LitElement, html, css, nothing, styleMap } from "../lit.js";
import { base, modeColors } from "../styles.js";
import { iconWarn, iconMode, iconFlag } from "../icons.js";
import { createT, tn, formatNumber } from "../lib/i18n.js";
import { stripSegments, segmentDetail, bandTints, presetSigla, DETAIL_LEVELS } from "../lib/day-editing.js";

const MODES = ["heat", "cool", "off"];
const HOURS = [0, 6, 12, 18, 24];

export class CronoWeekTabs extends LitElement {
  static properties = {
    hass: { attribute: false },
    days: { attribute: false },
    selected: { attribute: false },
    _stripPx: { state: true },
  };

  static styles = [
    base,
    modeColors,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      .wrap {
        --lw: 56px;
      }
      .axis {
        position: relative;
        height: 16px;
        margin-inline-start: calc(var(--lw, 56px) + 8px);
        margin-bottom: 2px;
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
      .rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .row {
        display: grid;
        grid-template-columns: var(--lw) minmax(0, 1fr);
        gap: 8px;
        align-items: center;
      }
      .lab {
        position: relative;
        min-height: 44px;
        padding: 0 6px;
        border: 1px solid var(--crono-line);
        border-radius: 10px;
        background: var(--crono-surface);
        cursor: pointer;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .lab .long {
        display: none;
      }
      .lab > .ic {
        width: 14px;
        height: 14px;
        flex: none;
      }
      .lab.holi > .ic {
        display: none;
      }
      .row.holi-row {
        margin-top: 4px;
      }
      .lab[aria-pressed="true"] {
        background: var(--crono-text);
        color: var(--crono-surface);
        border-color: var(--crono-text);
      }
      .bang {
        position: absolute;
        top: -7px;
        right: -5px;
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: var(--crono-error);
        color: var(--crono-error-bg);
      }
      .bang .ic {
        width: 13px;
        height: 13px;
      }
      .strip {
        position: relative;
        height: 36px;
        border-radius: 8px;
        background: var(--crono-surface2);
        border: 1px solid var(--crono-line);
        overflow: hidden;
      }
      .row.sel .strip {
        border-color: var(--crono-text);
        box-shadow: 0 0 0 1px var(--crono-text);
      }
      /* One band: the same fill, text and border colour as in the bar of the day (b-<mode> + v<n> of
         styles.js), a 1px gap on each side of every edge so the limits between bands are always seen. */
      .s {
        position: absolute;
        top: 2px;
        bottom: 2px;
        min-width: 3px;
        box-sizing: border-box;
        border: 1.5px solid;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        overflow: hidden;
        pointer-events: none;
        font-size: 11.5px;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .s .ic {
        width: 13px;
        height: 13px;
        flex: none;
      }
      .s .v {
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      /* Calculated: dashed border and stripes in a strip at the foot, never behind the text. */
      .s.is-auto {
        padding-bottom: 5px;
      }
      .s.is-auto::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 4px;
        background: repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px);
      }
      .s.err {
        outline: 2px solid var(--crono-error);
        outline-offset: -2px;
      }
      @container (min-width: 560px) {
        .wrap {
          --lw: 120px;
        }
        .lab .short {
          display: none;
        }
        .lab .long {
          display: inline;
        }
        .lab.holi > .ic {
          display: block;
        }
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.days = [];
    this.selected = 0;
    this._stripPx = 0;
    this._observer = null;
  }

  updated() {
    const strip = this.renderRoot.querySelector(".strip");
    if (strip && !this._observed && typeof ResizeObserver === "function") {
      this._observed = strip;
      this._observer = new ResizeObserver(() => {
        this._stripPx = strip.clientWidth;
      });
      this._observer.observe(strip);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = null;
    this._observed = null;
  }

  _segment(row, seg, tint) {
    const level = DETAIL_LEVELS.indexOf(segmentDetail((seg.width / 100) * this._stripPx));
    const mode = MODES.includes(row.mode) ? row.mode : "off";
    const cls = [`b-${mode}`, tint > 0 ? `v${tint}` : "", row.auto ? "is-auto" : "", "s"].filter(Boolean).join(" ");
    const hasTemp = row.temperature !== null && row.temperature !== undefined && row.temperature !== "" && Number.isFinite(Number(row.temperature));
    const temperature = hasTemp ? formatNumber(this.hass, row.temperature, { maximumFractionDigits: 2 }) : "";
    const preset = row.preset ? String(row.preset) : "";
    const value = temperature || preset;
    const sigla = temperature || presetSigla(preset);
    return html`<span class=${cls} style=${styleMap({ left: `calc(${seg.left}% + 1px)`, width: `calc(${seg.width}% - 2px)` })}>
      ${level === 1 ? (sigla ? html`<span class="v">${sigla}</span>` : iconMode(row.mode)) : nothing}
      ${level >= 2 ? iconMode(row.mode) : nothing}
      ${level >= 2 && value ? html`<span class="v">${value}</span>` : nothing}
    </span>`;
  }

  _choose(id) {
    this.dispatchEvent(new CustomEvent("crono-day-select", { detail: { day: id }, bubbles: true, composed: true }));
  }

  render() {
    const t = createT(this.hass);
    return html`
      <div class="wrap" role="group" aria-label=${t("week.strips")}>
        <div class="axis" aria-hidden="true">${HOURS.map((h) => html`<span style=${styleMap({ left: `${(h / 24) * 100}%` })}>${String(h).padStart(2, "0")}</span>`)}</div>
        <div class="rows">
          ${this.days.map((day) => {
            const isSel = day.id === this.selected;
            const summary = tn(this.hass, "week.day_summary", day.count, { day: day.full });
            const aria = day.errorCount > 0 ? `${summary}, ${t("week.day_errors")}` : summary;
            return html`<div class="row ${isSel ? "sel" : ""} ${day.holiday ? "holi-row" : ""}">
              <button class="lab ${day.holiday ? "holi" : ""}" type="button" aria-pressed=${isSel ? "true" : "false"} aria-label=${aria} title=${day.full} @click=${() => this._choose(day.id)}>
                ${day.holiday ? iconFlag() : nothing}<span class="short" aria-hidden="true">${day.label}</span><span class="long" aria-hidden="true">${day.full}</span>
                ${day.errorCount > 0 ? html`<span class="bang" aria-hidden="true">${iconWarn()}</span>` : nothing}
              </button>
              <div class="strip" aria-hidden="true">
                ${(() => {
                  const tints = bandTints(day.rows);
                  return stripSegments(day.rows).map((seg) => this._segment(day.rows[seg.index], seg, tints[seg.index]));
                })()}
              </div>
            </div>`;
          })}
        </div>
      </div>
    `;
  }
}

if (!customElements.get("crono-week-tabs")) customElements.define("crono-week-tabs", CronoWeekTabs);
