// Accessible modal dialog on the native <dialog> element: showModal() gives the
// focus trap, Esc, the inert page behind and the return of the focus to the
// element that opened it. The parent owns the `open` state: Esc and the close
// button only fire `crono-close`. Content comes in through slots (the parent
// renders it with normal Lit bindings, so it is always text).

import { LitElement, html, css } from "../lit.js";
import { base } from "../styles.js";

export class CronoDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    alert: { type: Boolean }, // true: role alertdialog (errors, destructive confirmations)
  };

  static styles = [
    base,
    css`
      dialog {
        width: min(480px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        padding: 0;
        border: 1px solid var(--crono-line);
        border-radius: var(--crono-radius);
        background: var(--crono-surface);
        color: var(--crono-text);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        overflow: auto;
      }
      dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
      }
      .head {
        padding: 16px 16px 4px;
      }
      h2 {
        font-size: 18px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .body {
        padding: 8px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-wrap: anywhere;
      }
      .foot {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        padding: 12px 16px 16px;
      }
    `,
  ];

  constructor() {
    super();
    this.open = false;
    this.heading = "";
    this.alert = false;
  }

  get _dialog() {
    return this.renderRoot?.querySelector("dialog") ?? null;
  }

  updated(changed) {
    if (!changed.has("open")) return;
    const dialog = this._dialog;
    if (!dialog) return;
    if (this.open && !dialog.open) dialog.showModal();
    else if (!this.open && dialog.open) dialog.close();
  }

  _onCancel(event) {
    event.preventDefault(); // the parent decides: Esc is a request to close
    this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent("crono-close", { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <dialog role=${this.alert ? "alertdialog" : "dialog"} aria-labelledby="title" @cancel=${this._onCancel}>
        <div class="head"><h2 id="title">${this.heading}</h2></div>
        <div class="body"><slot></slot></div>
        <div class="foot">
          <slot name="actions"></slot>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get("crono-dialog")) customElements.define("crono-dialog", CronoDialog);
