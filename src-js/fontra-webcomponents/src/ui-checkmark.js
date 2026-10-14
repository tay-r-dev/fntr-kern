import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// checkmark (Figma 2004:29411): a 12px check with its name, ui/label/XS, 4px
// after it. At rest a checked box is the grey check and an empty one the
// light box, both with grey names; hover lights the check lime or darkens the
// box, and darkens the name. The look is all here: the component does not
// lean on shared.css.
//
// `label`, `checked` and `disabled` are attributes, also set as properties;
// `indeterminate` is a property only, as on a native checkbox. A click fires
// "change". focus() reaches the box inside.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "ui-checkmark-box-color": ["var(--surface-base-basic-2)", "#444444"],
  "ui-checkmark-box-hover-color": ["var(--surface-base-basic-4)", "#555555"],
  "ui-checkmark-line-color": ["var(--line-base-basic-2)", "rgba(255, 255, 255, 0.05)"],
  "ui-checkmark-line-hover-color": [
    "var(--line-base-basic-4)",
    "rgba(255, 255, 255, 0.1)",
  ],
  "ui-checkmark-text-color": ["var(--text-base-basic-3)", "#9a9a9a"],
  "ui-checkmark-hover-text-color": ["var(--text-base-basic-2)", "#e0e0e0"],
  "ui-checkmark-disabled-text-color": ["var(--text-base-basic-4)", "#6a6a6a"],
};

export class UICheckmark extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-flex;
      min-width: 0;
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      /* ui/label/XS */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      color: var(--ui-checkmark-text-color);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }

    label:hover {
      color: var(--ui-checkmark-hover-text-color);
    }

    label:has(:disabled) {
      color: var(--ui-checkmark-disabled-text-color);
      cursor: default;
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    span[hidden] {
      display: none;
    }

    input {
      appearance: none;
      flex: none;
      margin: 0;
      width: 12px;
      height: 12px;
      border: 1px solid var(--ui-checkmark-line-color);
      border-bottom: none;
      border-radius: var(--corner-outer-xs);
      background: var(--ui-checkmark-box-color) center / contain no-repeat;
      cursor: pointer;
    }

    label:hover input {
      background-color: var(--ui-checkmark-box-hover-color);
      border-color: var(--ui-checkmark-line-hover-color);
    }

    input:checked,
    label:hover input:checked {
      border: none;
      background-color: transparent;
      background-image: url("/images/checkbox-on-rest.svg");
    }

    label:hover input:checked {
      background-image: url("/images/checkbox-on-hover.svg");
    }

    input:disabled,
    label:hover input:disabled {
      border: none;
      background: url("/images/checkbox-disabled.svg") center / contain no-repeat;
      cursor: default;
    }
  `;

  static observedAttributes = ["label", "checked", "disabled"];

  constructor() {
    super();
    this._indeterminate = false;
  }

  // The name, the state and disabled live on the element as attributes, so
  // markup can set them (<ui-checkmark label="kern" checked>) and the page
  // shows them.
  attributeChangedCallback(name) {
    if (!this._checkbox) {
      return;
    }
    if (name === "label") {
      this._labelText.textContent = this.label;
      this._labelText.hidden = !this.label;
    } else {
      this._checkbox[name] = this[name];
    }
  }

  get label() {
    return this.getAttribute("label") || "";
  }

  set label(value) {
    this.setAttribute("label", value || "");
  }

  get checked() {
    return this.hasAttribute("checked");
  }

  set checked(value) {
    this.toggleAttribute("checked", !!value);
  }

  get indeterminate() {
    return this._indeterminate;
  }

  set indeterminate(value) {
    this._indeterminate = !!value;
    if (this._checkbox) {
      this._checkbox.indeterminate = this._indeterminate;
    }
  }

  get disabled() {
    return this.hasAttribute("disabled");
  }

  set disabled(value) {
    this.toggleAttribute("disabled", !!value);
  }

  focus(options) {
    this._checkbox?.focus(options);
  }

  render() {
    this._checkbox = html.input({
      type: "checkbox",
      checked: this.checked,
      disabled: this.disabled,
      onchange: () => {
        this.checked = this._checkbox.checked;
        this._indeterminate = false;
        this.dispatchEvent(new Event("change"));
      },
    });
    this._checkbox.indeterminate = this._indeterminate;
    this._labelText = html.span({}, [this.label]);
    this._labelText.hidden = !this.label;
    return html.label({}, [this._checkbox, this._labelText]);
  }
}

customElements.define("ui-checkmark", UICheckmark);

// A ui-checkmark set up in one call; `onchange(checked)` runs on a click.
export function makeCheckmark(checked, label, onchange, { disabled, tooltip } = {}) {
  const element = new UICheckmark();
  element.checked = checked;
  element.label = label;
  element.disabled = disabled;
  element.addEventListener("change", () => onchange(element.checked));
  if (tooltip) {
    element.dataset.tooltip = tooltip;
  }
  return element;
}
