import * as html from "@fontra/core/html-utils.js";
import { iconPath } from "@fontra/core/icons.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 42 (UI-REFACTOR.md §5.4, UI-NOMENCLATURE.md §14): the shared
// segmented control -- a row of text buttons, one on, a disabled state and a
// change event. Lifted from the skeleton panel's own hand-built serif sides
// row (Both/L/R, panel-skeleton-parameters.js's local `tab` helper), which is
// left as it is; later tickets (43, 44, 48, 50, 52) reuse this component
// instead. Placement-agnostic, the same way labeled-toggle.js is: a caller
// drops it into a form row, an accordion header, or anywhere else.
//
// It draws as the design's chip selector: a tray with the lit chip on a white
// face. The `small` attribute is the pill form a heading carries (Gizmo and
// Handles).
//
// `options`, `value` and `disabled` are plain JS properties, not HTML
// attributes -- set them after creating the element, the convention every
// UnlitElement-based component in this tree uses.
// select/segmented (Figma 2004:29330). Light colours are the design
// system's tokens (core.css); dark ones stay hand-picked until the design has
// a dark mode.
const colors = {
  "segmented-control-tray-color": ["var(--surface-base-basic-2)", "#3a3a3e"],
  "segmented-control-border-color": ["var(--line-base-basic-2)", "#6a6a74"],
  "segmented-control-disabled-border-color": ["var(--line-base-basic-1)", "#4a4a50"],
  "segmented-control-tray-hover-color": ["var(--surface-color-lime-basic-3)", "#d5ed57"],
  "segmented-control-tray-hover-border-color": ["var(--line-color-lime-basic-3)", "#b7d817"],
  "segmented-control-on-hover-shadow-color": [
    "var(--shadow-color-lime-2)",
    "#9cbb12",
  ],
  "segmented-control-on-shadow-color": ["var(--shadow-base-2)", "#000000a0"],
  "segmented-control-on-background-color": ["var(--surface-base-basic-0)", "#5a5a60"],
  "segmented-control-off-text-color": ["var(--text-base-basic-3)", "#ffffff80"],
  "segmented-control-off-container-hover-text-color": [
    "var(--text-color-lime-basic-3)",
    "#d0eb49",
  ],
  "segmented-control-on-hover-background-color": [
    "var(--surface-base-basic-0)",
    "#5a5a60",
  ],
  "segmented-control-on-hover-text-color": ["var(--text-base-basic-2)", "#e9e9ed"],
  // The lit chip's label: text/base/basic/3 at rest (the chip's own binding,
  // Figma 2004:29364 and 2004:29368), text 2 while the tray is hovered.
  "segmented-control-on-text-color": ["var(--text-base-basic-3)", "#e9e9ed"],
  "segmented-control-disabled-text-color": ["var(--text-base-basic-5)", "#ffffff40"],
  "segmented-control-hover-background-color": ["var(--surface-color-lime-inverted-1)", "#9cbb12"],
  "segmented-control-hover-text-color": ["var(--text-base-inverted-1)", "#fff"],
};

export class SegmentedControl extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-flex;
    }

    .row {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      box-sizing: border-box;
      /* select/segmented's tray at 24px; a view whose design sets the
         base numbers smaller (20px, 5px corners) sets these. */
      height: var(--segmented-control-height, var(--height-l));
      padding: var(--segmented-control-tray-padding, var(--padding-l));
      gap: 0;
      background: var(--segmented-control-tray-color);
      /* The design draws the tray's line inside, so it takes no room: a
         rule on top at rest, on top and at the sides on hover, all round when
         disabled. */
      box-shadow: inset 0 1px 0 var(--segmented-control-border-color);
      border-radius: var(--segmented-control-radius, var(--corner-outer-l));
    }

    button {
      flex: 1 1 auto;
      margin: 0;
      padding: 3px 5px;
      border: none;
      border-radius: var(--corner-inner-l);
      background: transparent;
      color: var(--segmented-control-off-text-color);
      /* ui/label/XS */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      white-space: nowrap;
      cursor: pointer;
      box-sizing: border-box;
      height: var(--segmented-control-button-height, 100%);
    }

    /* Hover: the tray turns lime and its border a dark lime. The padding
       stays, so nothing inside moves. */
    .row:hover:not(:has(button:disabled)) {
      background: var(--segmented-control-tray-hover-color);
      box-shadow:
        inset 0 1px 0 var(--segmented-control-tray-hover-border-color),
        inset 1px 0 0 var(--segmented-control-tray-hover-border-color),
        inset -1px 0 0 var(--segmented-control-tray-hover-border-color);
    }

    .row:hover button.on:not(:disabled) {
      background: var(--segmented-control-on-hover-background-color);
      box-shadow: 0 1px 1px var(--segmented-control-on-hover-shadow-color);
      color: var(--segmented-control-on-hover-text-color);
    }

    /* select/segmented/chip "contaner-hover, inactive": with the pointer on
       the tray, the other chips' labels turn lime. */
    .row:hover:not(:has(button:disabled)) button:not(.on):not(:hover) {
      color: var(--segmented-control-off-container-hover-text-color);
    }

    button.on {
      background: var(--segmented-control-on-background-color);
      box-shadow: 0 1px 1.5px var(--segmented-control-on-shadow-color);
      color: var(--segmented-control-on-text-color);
    }

    button:hover:not(.on):not(:disabled) {
      background: var(--segmented-control-hover-background-color);
      color: var(--segmented-control-hover-text-color);
    }

    button:disabled {
      cursor: default;
      color: var(--segmented-control-disabled-text-color);
    }

    /* Disabled: a pale border, every label pale, the chosen chip's face and
       shadow gone. */
    :host([disabled]) .row {
      box-shadow: inset 0 0 0 1px var(--segmented-control-disabled-border-color);
    }

    :host([disabled]) button {
      cursor: default;
      color: var(--segmented-control-disabled-text-color);
    }

    :host([disabled]) button.on {
      background: transparent;
      box-shadow: none;
    }

    button .icon {
      display: block;
      width: 12px;
      height: 12px;
    }

    :host([small]) .row {
      height: 22px;
      border-radius: 999px;
    }

    :host([small]) button {
      padding: 3px 6px;
      border-radius: 999px;
      /* ui/label/XS */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      height: var(--segmented-control-button-height, 100%);
    }

    /* A heading's selector that has wrapped to a line of its own under the
       heading fills that line. It only grows, so it wraps no sooner than it
       would without it. */
    :host([small][own-line]) {
      flex-grow: 1;
    }

    /* The heading's lit pill casts a paler shadow (Figma 2004:29331). */
    :host([small]:not([disabled])) .row:not(:hover) button.on {
      box-shadow: 0 1px 1px var(--shadow-base-1);
    }
  `;

  constructor() {
    super();
    this._options = [];
    this._value = undefined;
    this._disabled = false;
  }

  // The small form sits on a heading: it watches whether it has wrapped.
  connectedCallback() {
    super.connectedCallback();
    if (this.hasAttribute("small")) {
      this._ownLineObserver?.disconnect();
      this._ownLineObserver = html.watchOwnLine(this);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._ownLineObserver?.disconnect();
    this._ownLineObserver = null;
  }

  // { value, label, disabled }[]. `disabled` on an individual option freezes
  // just that segment (the serif sides row's own "both" segment, once the two
  // sides differ); `disabled` on the control freezes all of them.
  get options() {
    return this._options;
  }

  set options(value) {
    this._options = value || [];
    this.requestUpdate();
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.toggleAttribute("disabled", this._disabled);
    this.requestUpdate();
  }

  render() {
    return html.div(
      { class: "row" },
      this._options.map((option) =>
        html.button(
          {
            class: option.value === this._value ? "on" : "",
            disabled: this._disabled || !!option.disabled,
            onclick: () => {
              if (option.value === this._value) {
                return;
              }
              this._value = option.value;
              this.requestUpdate();
              this.dispatchEvent(
                new CustomEvent("change", { detail: { value: option.value } })
              );
            },
          },
          // An option with an icon shows it, and its label as the tooltip.
          [
            option.icon
              ? html.createDomElement("inline-svg", {
                  "class": "icon",
                  "src": iconPath(option.icon),
                  "data-tooltip": option.label,
                  "data-tooltipposition": "top",
                })
              : option.label,
          ]
        )
      )
    );
  }
}

customElements.define("segmented-control", SegmentedControl);
