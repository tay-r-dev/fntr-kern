import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 42 (UI-REFACTOR.md §5.4, UI-NOMENCLATURE.md §14): the shared
// segmented control -- a row of text buttons, one on, a disabled state and a
// change event. Lifted from the skeleton panel's own hand-built serif sides
// row (Both/L/R, panel-skeleton-parameters.js's local `tab` helper), which is
// left as it is; later tickets (43, 44, 48, 50, 52) reuse this component
// instead. Placement-agnostic, the same way labeled-toggle.js is: a caller
// drops it into a form row, an accordion header, or anywhere else.
//
// `options`, `value` and `disabled` are plain JS properties, not HTML
// attributes -- set them after creating the element, the convention every
// UnlitElement-based component in this tree uses.
const colors = {
  "segmented-control-border-color": ["#8888", "#8888"],
  "segmented-control-on-background-color": ["#8884", "#8884"],
  "segmented-control-off-background-color": ["transparent", "transparent"],
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
    }

    button {
      flex: 1 1 0;
      min-width: 3em;
      margin: 0;
      padding: 0.25em 0.5em;
      border: 1px solid var(--segmented-control-border-color);
      border-left: none;
      border-radius: 0;
      background: var(--segmented-control-off-background-color);
      color: inherit;
      font: inherit;
      opacity: 0.6;
      cursor: pointer;
    }

    button:first-child {
      border-left: 1px solid var(--segmented-control-border-color);
      border-radius: 4px 0 0 4px;
    }

    button:last-child {
      border-radius: 0 4px 4px 0;
    }

    button.on {
      background: var(--segmented-control-on-background-color);
      font-weight: bold;
      opacity: 1;
    }

    button:disabled {
      cursor: default;
    }

    :host([disabled]) button {
      cursor: default;
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
          [option.label]
        )
      )
    );
  }
}

customElements.define("segmented-control", SegmentedControl);
