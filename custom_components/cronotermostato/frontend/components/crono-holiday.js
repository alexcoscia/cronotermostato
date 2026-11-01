// The holiday part: which country and subdivision decide what a holiday is, the
// rule that a holiday always uses the holiday part, and a link to the options of
// the integration, where the country is changed (not here). The bands themselves
// are edited with the same `crono-day` as the days. `compact` is the one-line
// reminder shown under the days.

import { LitElement, html, css } from "../lit.js";
import { base } from "../styles.js";
import { iconFlag, iconWarn } from "../icons.js";
import { createT, languageOf } from "../lib/i18n.js";
import { locationLabel, integrationPath, shouldHandleClick } from "../lib/holiday.js";

export class CronoHoliday extends LitElement {
  static properties = {
    hass: { attribute: false },
    country: { attribute: false },
    subdiv: { attribute: false },
    compact: { type: Boolean, reflect: true },
    dirty: { type: Boolean }, // unsaved edits: the link then opens in a new tab so nothing is lost
  };

  static styles = [
    base,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .holi {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 12px;
        align-items: center;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--crono-surface2);
        border: 1px solid var(--crono-line);
      }
      :host([compact]) .holi {
        padding: 0;
        background: none;
        border: 0;
      }
      :host([compact]) a.lnk {
        font-size: 12.5px;
      }
      .country {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-weight: 700;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .country.none {
        color: var(--crono-warn);
      }
      .note {
        flex-basis: 100%;
        color: var(--crono-muted);
        font-size: 13px;
      }
      a.lnk {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        color: var(--crono-text);
        text-decoration: underline;
        font-size: 13px;
      }
      a.lnk:focus-visible {
        outline: 3px solid var(--crono-focus, currentColor);
        outline-offset: 2px;
        border-radius: 4px;
      }
    `,
  ];

  constructor() {
    super();
    this.hass = undefined;
    this.country = null;
    this.subdiv = null;
    this.compact = false;
    this.dirty = false;
  }

  _go = (event) => {
    if (!shouldHandleClick(event, this.dirty)) return;
    event.preventDefault();
    // The navigation of the HA frontend: it listens to `location-changed`; it works in the panel and in a card.
    history.pushState(null, "", integrationPath);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  };

  render() {
    const t = createT(this.hass);
    const place = locationLabel(this.country, this.subdiv, languageOf(this.hass));
    const link = html`<a class="lnk" href=${integrationPath} target=${this.dirty ? "_blank" : "_self"} rel="noopener" @click=${this._go}>${t("band.country_options")}</a>`;
    return html`<div class="holi">
      ${place
        ? html`<span class="country">${iconFlag()}<span>${t("band.country", { country: place.text })}</span></span>`
        : html`<span class="country none">${iconWarn()}<span>${t("band.country_none")}</span></span>`}
      ${link}
      ${this.compact ? "" : html`<p class="note">${t("band.holiday_note")}</p>`}
    </div>`;
  }
}

if (!customElements.get("crono-holiday")) customElements.define("crono-holiday", CronoHoliday);
