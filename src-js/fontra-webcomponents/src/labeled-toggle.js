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
//
// select/toggle (Figma 2004:29380): a 22x12 pill, the label 4px after it.
// Off it is pale grey, darker on hover; on it is mid grey, lime on hover.
// Each track has a line at the top and sides, drawn inside; the thumb carries
// the shade.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "labeled-toggle-track-off-color": ["var(--sl-bsb-sr-rest)", "#555"],
  "labeled-toggle-line-off-color": ["var(--sl-bsb-ln-rest)", "#666"],
  "labeled-toggle-shade-off-color": ["var(--sl-bsb-sh-rest)", "#222"],
  "labeled-toggle-track-off-hover-color": ["var(--sl-bsb-sr-hover)", "#666"],
  "labeled-toggle-line-off-hover-color": ["var(--sl-bsb-ln-hover)", "#777"],
  "labeled-toggle-shade-off-hover-color": ["var(--sl-bsb-sh-hover)", "#222"],
  "labeled-toggle-track-on-color": ["var(--sl-bsb-sr-active)", "#8a8a8a"],
  "labeled-toggle-line-on-color": ["var(--sl-bsb-ln-active)", "#9a9a9a"],
  "labeled-toggle-shade-on-color": ["var(--sl-bsb-sh-active-rest)", "#222"],
  "labeled-toggle-track-on-hover-color": ["var(--sl-bsb-sr-active-hover)", "#a9c915"],
  "labeled-toggle-line-on-hover-color": ["var(--sl-bsb-ln-active-hover)", "#b7d817"],
  "labeled-toggle-shade-on-hover-color": ["var(--sl-bsb-sh-active-hover)", "#71900a"],
  "labeled-toggle-track-disabled-color": ["var(--surface-base-basic-1)", "#444"],
  "labeled-toggle-line-disabled-color": ["var(--line-base-basic-1)", "#4a4a4a"],
  "labeled-toggle-shade-disabled-color": ["var(--sl-bsb-sh-disabled)", "#333"],
  "labeled-toggle-thumb-color": ["#fff", "#fff"],
  "labeled-toggle-text-color": ["var(--sl-bsb-lb-rest)", "#b0b0b0"],
  "labeled-toggle-hover-text-color": ["var(--sl-bsb-lb-hover)", "#e0e0e0"],
  "labeled-toggle-disabled-text-color": ["var(--sl-bsb-lb-disabled)", "#666"],
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
      gap: 4px;
      /* ui/label/S */
      font: var(--ui-text-label-s);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      color: var(--labeled-toggle-text-color);
      cursor: pointer;
      user-select: none;
    }

    label:hover:not(:has(:disabled)) {
      color: var(--labeled-toggle-hover-text-color);
    }

    label:has(:disabled) {
      color: var(--labeled-toggle-disabled-text-color);
      cursor: default;
    }

    input[type="checkbox"] {
      --track: var(--labeled-toggle-track-off-color);
      --line: var(--labeled-toggle-line-off-color);
      --shade: var(--labeled-toggle-shade-off-color);
      --thumb-shadow: 0 0 3px var(--shade);
      appearance: none;
      -webkit-appearance: none;
      position: relative;
      box-sizing: border-box;
      flex: none;
      width: 22px;
      height: 12px;
      margin: 0;
      border: none;
      border-radius: 6px;
      background-color: var(--track);
      /* The line is inside, at the top and sides. */
      box-shadow:
        inset 0 1px 0 var(--line),
        inset 1px 0 0 var(--line),
        inset -1px 0 0 var(--line);
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    input[type="checkbox"]::before {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--labeled-toggle-thumb-color);
      box-shadow: var(--thumb-shadow);
      transition: transform 120ms ease;
    }

    label:hover input[type="checkbox"]:not(:disabled) {
      --track: var(--labeled-toggle-track-off-hover-color);
      --line: var(--labeled-toggle-line-off-hover-color);
      --shade: var(--labeled-toggle-shade-off-hover-color);
      --thumb-shadow: 0 1px 1px var(--shade);
    }

    input[type="checkbox"]:checked {
      --track: var(--labeled-toggle-track-on-color);
      --line: var(--labeled-toggle-line-on-color);
      --shade: var(--labeled-toggle-shade-on-color);
      --thumb-shadow: 0 1px 1px var(--shade);
    }

    label:hover input[type="checkbox"]:checked:not(:disabled) {
      --track: var(--labeled-toggle-track-on-hover-color);
      --line: var(--labeled-toggle-line-on-hover-color);
      --shade: var(--labeled-toggle-shade-on-hover-color);
      --thumb-shadow: 0 1px 2px var(--shade);
    }

    input[type="checkbox"]:checked::before {
      transform: translateX(10px);
    }

    input[type="checkbox"]:disabled {
      --track: var(--labeled-toggle-track-disabled-color);
      --line: var(--labeled-toggle-line-disabled-color);
      --shade: var(--labeled-toggle-shade-disabled-color);
      --thumb-shadow: 0 0 3px var(--shade);
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
