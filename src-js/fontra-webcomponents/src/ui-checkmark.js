import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";

// checkmark (Figma 2004:29411): a 12px check with its name, ui/label/XS, 4px
// after it. The look is shared.css's label.checkmark-row holding an
// input.checkmark (the shadow root links shared.css).
//
// `label`, `checked` and `disabled` are attributes, also set as properties;
// `indeterminate` is a property only, as on a native checkbox. A click fires
// "change". focus() reaches the box inside.
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
      class: "checkmark",
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
