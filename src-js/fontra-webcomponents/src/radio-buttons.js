import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// A one-of-several choice drawn as the checks are: the same 14px box, line on
// top and at the sides, colours and label, only round, and a dot where the
// check would be (fontra-core/assets/images/radio-*.svg, made from the
// checkbox-*.svg the checks use). For a few options shown at once, where a
// dropdown would hide them.
//
// `options` ([{value, label}]), `value` and `disabled` are plain JS
// properties, the convention every UnlitElement component in this tree uses.
// Picking an option fires "change" with event.detail.value.
const colors = {
  "radio-buttons-off-color": ["#e9e9e9", "#444"],
  "radio-buttons-off-hover-color": ["#d9d9d9", "#555"],
  "radio-buttons-line-color": ["rgba(21, 21, 21, 0.05)", "rgba(255, 255, 255, 0.05)"],
  "radio-buttons-text-color": ["#303030", "#e0e0e0"],
};

export class RadioButtons extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 12px;
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      /* ui/label/XS */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      color: var(--radio-buttons-text-color);
      white-space: nowrap;
    }

    input {
      appearance: none;
      box-sizing: border-box;
      flex: none;
      margin: 0;
      width: 14px;
      height: 14px;
      border: 1px solid var(--radio-buttons-line-color);
      border-bottom: none;
      border-radius: 50%;
      background: var(--radio-buttons-off-color) center / contain no-repeat;
      cursor: pointer;
    }

    label:hover input {
      background-color: var(--radio-buttons-off-hover-color);
    }

    input:checked,
    label:hover input:checked {
      border: none;
      background-color: transparent;
      background-image: url("/images/radio-on-rest.svg");
    }

    label:hover input:checked {
      background-image: url("/images/radio-on-hover.svg");
    }

    input:disabled,
    label:hover input:disabled {
      border: none;
      background: url("/images/radio-disabled.svg") center / contain no-repeat;
      cursor: default;
    }

    label:has(input:disabled) {
      cursor: default;
    }
  `;

  constructor() {
    super();
    this._options = [];
    this._value = undefined;
    this._disabled = false;
    this._name = `radio-buttons-${RadioButtons._count++}`;
  }

  get options() {
    return this._options;
  }

  set options(options) {
    this._options = options || [];
    this.requestUpdate();
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
    for (const input of this._inputs || []) {
      input.checked = input.value === String(value);
    }
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    for (const input of this._inputs || []) {
      input.disabled = this._disabled;
    }
  }

  render() {
    this._inputs = [];
    return this._options.map((option) => {
      const input = html.createDomElement("input", {
        type: "radio",
        name: this._name,
        value: String(option.value),
        checked: option.value === this._value,
        disabled: this._disabled,
        onchange: () => {
          this._value = option.value;
          this.dispatchEvent(
            new CustomEvent("change", { detail: { value: option.value } })
          );
        },
      });
      this._inputs.push(input);
      return html.createDomElement("label", {}, [
        input,
        option.label ?? String(option.value),
      ]);
    });
  }
}

RadioButtons._count = 0;

customElements.define("radio-buttons", RadioButtons);
