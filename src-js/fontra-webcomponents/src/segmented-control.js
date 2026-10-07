import * as html from "@fontra/core/html-utils.js";
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
  "segmented-control-tray-color": ["var(--sl-sgb-sr-rest)", "#3a3a3e"],
  "segmented-control-border-color": ["var(--sl-sgb-ln-rest)", "#6a6a74"],
  "segmented-control-disabled-border-color": ["var(--sl-sgb-ln-disabled)", "#4a4a50"],
  "segmented-control-tray-hover-color": ["var(--sl-sgb-sr-hover)", "#d5ed57"],
  "segmented-control-tray-hover-border-color": ["var(--sl-sgb-ln-hover)", "#b7d817"],
  "segmented-control-on-hover-shadow-color": [
    "var(--sl-sgc-sh-active-rest)",
    "#9cbb12",
  ],
  "segmented-control-on-shadow-color": ["var(--shadow-base-2)", "#000000a0"],
  "segmented-control-on-background-color": ["var(--sl-sgc-sr-active)", "#5a5a60"],
  "segmented-control-off-text-color": ["var(--sl-sgc-lb-rest)", "#ffffff80"],
  "segmented-control-off-container-hover-text-color": [
    "var(--sl-sgc-lb-hover-container)",
    "#d0eb49",
  ],
  "segmented-control-on-hover-background-color": [
    "var(--sl-sgc-sr-active-hover)",
    "#5a5a60",
  ],
  "segmented-control-on-hover-text-color": ["var(--sl-sgc-lb-active-hover)", "#e9e9ed"],
  "segmented-control-on-text-color": ["var(--sl-sgc-lb-active-rest)", "#e9e9ed"],
  "segmented-control-disabled-text-color": ["var(--sl-sgc-lb-disabled)", "#ffffff40"],
  "segmented-control-hover-background-color": ["var(--sl-sgc-sr-hover)", "#9cbb12"],
  "segmented-control-hover-text-color": ["var(--sl-sgc-lb-hover)", "#fff"],
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
      height: 24px;
      padding: var(--segmented-control-tray-padding, 3px);
      gap: 0;
      background: var(--segmented-control-tray-color);
      /* The design draws the tray's line inside, so it takes no room: a
         rule on top at rest, on top and at the sides on hover, all round when
         disabled. */
      box-shadow: inset 0 1px 0 var(--segmented-control-border-color);
      border-radius: 6px;
    }

    button {
      flex: 1 1 auto;
      margin: 0;
      padding: 3px 5px;
      border: none;
      border-radius: var(--sl-sgc-radius);
      background: transparent;
      color: var(--segmented-control-off-text-color);
      /* ui/label/M */
      font: var(--ui-text-label-m);
      letter-spacing: var(--ui-tracking-label-m);
      font-feature-settings: "case" 1;
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

    .row:hover button.on {
      background: var(--segmented-control-on-hover-background-color);
      box-shadow: 0 1px 2px var(--segmented-control-on-hover-shadow-color);
      color: var(--segmented-control-on-hover-text-color);
    }

    /* select/segmented/chip "contaner-hover, inactive": with the pointer on
       the tray, the other chips' labels turn lime. */
    .row:hover:not(:has(button:disabled)) button:not(.on):not(:hover) {
      color: var(--segmented-control-off-container-hover-text-color);
    }

    button.on {
      background: var(--segmented-control-on-background-color);
      box-shadow: 0 1px 3px var(--segmented-control-on-shadow-color);
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
  `;

  constructor() {
    super();
    this._options = [];
    this._value = undefined;
    this._disabled = false;
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
                  "src": option.icon,
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
