import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";
import "./ui-handle.js";

// input/text (Figma 379:22475): a grey tray (ruled on top, 3px inset) holding
// the box the text sits in. Four states, one or several lines:
//
// - rest: the box is invisible, the text (or the hint) grey;
// - hover: the box fills light grey with a hairline border, the text darkens;
// - manual input (focus): the box turns white with the lime border, the text
//   near-black;
// - disabled: the rest look with the box at 70%.
//
// `multiline` makes it the 60px several-line field with the small handle
// (Figma 379:22492, size S) on its bottom edge; dragging the handle sets the
// height.
//
// `value`, `placeholder`, `multiline` and `disabled` are plain JS properties,
// the convention every UnlitElement component in this tree uses. "input"
// passes through from the inner field; "change" is sent again from the host,
// since a native change event stops at the shadow root.
const colors = {
  "ui-text-input-tray-color": ["#f5f5f5", "#3a3a3a"],
  "ui-text-input-tray-border-color": ["#e0e0e0", "#555"],
  "ui-text-input-hover-color": ["#f7f7f7", "#464646"],
  "ui-text-input-hover-border-color": [
    "rgba(0, 0, 0, 0.08)",
    "rgba(255, 255, 255, 0.1)",
  ],
  "ui-text-input-focus-color": ["#fff", "#2c2c2c"],
  "ui-text-input-focus-border-color": ["#def280", "#8fae4a"],
  "ui-text-input-text-color": ["#8e8e8e", "#8e8e8e"],
  "ui-text-input-hover-text-color": ["#303030", "#e0e0e0"],
  "ui-text-input-focus-text-color": ["#151515", "#fff"],
};

const MIN_MULTILINE_HEIGHT = 36;

export class UITextInput extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
      box-sizing: border-box;
      position: relative;
      height: 24px;
      padding: 3px;
      background-color: var(--ui-text-input-tray-color);
      border-top: 1px solid var(--ui-text-input-tray-border-color);
      border-radius: 6px;
    }

    :host([multiline]) {
      height: var(--ui-text-input-height, 60px);
    }

    /* The box: 3px corners, and a border that is always there, so the text
       stays put when hover and focus draw it. */
    .container {
      box-sizing: border-box;
      display: flex;
      height: 100%;
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 0 5px;
      transition:
        background-color 120ms,
        border-color 120ms;
    }

    :host([multiline]) .container {
      padding: 7px 0 0 5px;
    }

    :host(:hover:not([disabled])) .container {
      background-color: var(--ui-text-input-hover-color);
      border-color: var(--ui-text-input-hover-border-color);
    }

    :host(:focus-within:not([disabled])) .container {
      background-color: var(--ui-text-input-focus-color);
      border-color: var(--ui-text-input-focus-border-color);
    }

    :host([disabled]) .container {
      opacity: 0.7;
    }

    .field {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: none;
      outline: none;
      background: transparent;
      color: var(--ui-text-input-text-color);
      /* ui/label/S */
      font: var(--ui-text-label-s);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      text-overflow: ellipsis;
    }

    .field::placeholder {
      color: inherit;
      opacity: 1;
    }

    textarea.field {
      height: 100%;
      resize: none;
      white-space: pre-wrap;
      overflow: auto;
    }

    :host(:hover:not([disabled])) .field {
      color: var(--ui-text-input-hover-text-color);
    }

    :host(:focus-within:not([disabled])) .field {
      color: var(--ui-text-input-focus-text-color);
    }

    ui-handle {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
    }

    :host([disabled]) ui-handle {
      display: none;
    }
  `;

  constructor() {
    super();
    this._value = "";
    this._placeholder = "";
    this._multiline = false;
    this._disabled = false;
  }

  get value() {
    return this._field ? this._field.value : this._value;
  }

  set value(value) {
    this._value = value ?? "";
    if (this._field) {
      this._field.value = this._value;
    }
  }

  get placeholder() {
    return this._placeholder;
  }

  set placeholder(value) {
    this._placeholder = value || "";
    if (this._field) {
      this._field.placeholder = this._placeholder;
    }
  }

  get multiline() {
    return this._multiline;
  }

  set multiline(value) {
    this._multiline = !!value;
    this.toggleAttribute("multiline", this._multiline);
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.toggleAttribute("disabled", this._disabled);
    if (this._field) {
      this._field.disabled = this._disabled;
    }
  }

  focus(options) {
    this._field?.focus(options);
  }

  select() {
    this._field?.select();
  }

  // Markup may set placeholder, multiline and disabled as attributes; they
  // are read once, on the first render.
  _readAttributes() {
    if (this._attributesRead) {
      return;
    }
    this._attributesRead = true;
    if (!this._placeholder && this.hasAttribute("placeholder")) {
      this._placeholder = this.getAttribute("placeholder");
    }
    if (this.hasAttribute("multiline")) {
      this._multiline = true;
    }
    if (this.hasAttribute("disabled")) {
      this._disabled = true;
    }
  }

  render() {
    this._readAttributes();
    const hadFocus = this.shadowRoot.activeElement === this._field;
    if (this._field) {
      this._value = this._field.value;
    }
    this._field = html.createDomElement(this._multiline ? "textarea" : "input", {
      class: "field",
      placeholder: this._placeholder,
      disabled: this._disabled,
      spellcheck: false,
      onchange: () => this.dispatchEvent(new Event("change", { bubbles: true })),
    });
    this._field.value = this._value;
    const children = [html.div({ class: "container" }, [this._field])];
    if (this._multiline) {
      const handle = html.createDomElement("ui-handle");
      handle.size = "S";
      let startHeight;
      handle.addEventListener("handle-drag-start", () => {
        startHeight = this.getBoundingClientRect().height;
      });
      handle.addEventListener("handle-drag", (event) => {
        const height = Math.max(MIN_MULTILINE_HEIGHT, startHeight + event.detail.dy);
        this.style.setProperty("--ui-text-input-height", `${height}px`);
      });
      children.push(handle);
    }
    if (hadFocus) {
      queueMicrotask(() => this._field.focus());
    }
    return children;
  }
}

customElements.define("ui-text-input", UITextInput);
