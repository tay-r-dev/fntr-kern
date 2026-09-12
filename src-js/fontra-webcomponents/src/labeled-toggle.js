import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 14 (UI-REFACTOR.md §2.4/§3.2, UI-NOMENCLATURE.md §14.1): the
// labeled toggle -- a pill that slides, with a label beside it, a checked
// state, a disabled state and a change event, following the theme tokens.
// Placement-agnostic: later tickets reuse it in a row of its own (this
// ticket) and in an accordion header (a second placement, not a second
// component).
//
// `checked`, `disabled` and `label` are plain JS properties, not HTML
// attributes -- set them after creating the element (this.checked = true),
// the same convention every other UnlitElement-based component in this
// tree uses (see UI-NOMENCLATURE.md's own note on icon-button.js).
const colors = {
  "labeled-toggle-track-off-color": ["#ccc", "#555"],
  "labeled-toggle-track-on-color": ["#3b82f6", "#2f6fd1"],
  "labeled-toggle-thumb-color": ["#fff", "#fff"],
  "labeled-toggle-text-color": ["#000", "#fff"],
};

export class LabeledToggle extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-flex;
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      color: var(--labeled-toggle-text-color);
      cursor: pointer;
      user-select: none;
    }

    input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      position: relative;
      width: 2em;
      height: 1.15em;
      margin: 0;
      border-radius: 1em;
      background-color: var(--labeled-toggle-track-off-color);
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    input[type="checkbox"]::before {
      content: "";
      position: absolute;
      top: 0.1em;
      left: 0.1em;
      width: 0.95em;
      height: 0.95em;
      border-radius: 50%;
      background-color: var(--labeled-toggle-thumb-color);
      transition: transform 120ms ease;
    }

    input[type="checkbox"]:checked {
      background-color: var(--labeled-toggle-track-on-color);
    }

    input[type="checkbox"]:checked::before {
      transform: translateX(0.85em);
    }

    input[type="checkbox"]:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  constructor() {
    super();
    this._label = "";
    this._checked = false;
    this._disabled = false;
  }

  get label() {
    return this._label;
  }

  set label(value) {
    this._label = value || "";
    if (this._labelText) {
      this._labelText.textContent = this._label;
    }
  }

  get checked() {
    return this._checked;
  }

  set checked(value) {
    this._checked = !!value;
    if (this._checkbox) {
      this._checkbox.checked = this._checked;
    }
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    if (this._checkbox) {
      this._checkbox.disabled = this._disabled;
    }
  }

  render() {
    this._checkbox = html.createDomElement("input", {
      type: "checkbox",
      checked: this._checked,
      disabled: this._disabled,
      onchange: () => {
        this._checked = this._checkbox.checked;
        this.dispatchEvent(new Event("change"));
      },
    });
    this._labelText = document.createTextNode(this._label);
    return html.createDomElement("label", {}, [this._checkbox, this._labelText]);
  }
}

customElements.define("labeled-toggle", LabeledToggle);
