import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";

// checkmark (Figma 2004:29411): a 12px check with its name, ui/label/XS, 4px
// after it. The look is shared.css's label.checkmark-row holding an
// input.checkmark (the shadow root links shared.css).
//
// `checked`, `disabled` and `label` are plain JS properties, set after
// creating the element; a click fires "change".
export class UICheckmark extends UnlitElement {
  static styles = `
    :host {
      display: inline-flex;
      min-width: 0;
    }

    .checkmark-row {
      min-width: 0;
      user-select: none;
    }

    .checkmark-row span {
      overflow: hidden;
      text-overflow: ellipsis;
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
      this._labelText.hidden = !this._label;
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
    this._checkbox = html.input({
      type: "checkbox",
      class: "checkmark",
      checked: this._checked,
      disabled: this._disabled,
      onchange: () => {
        this._checked = this._checkbox.checked;
        this.dispatchEvent(new Event("change"));
      },
    });
    this._labelText = html.span({}, [this._label]);
    this._labelText.hidden = !this._label;
    return html.label({ class: "checkmark-row" }, [this._checkbox, this._labelText]);
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
