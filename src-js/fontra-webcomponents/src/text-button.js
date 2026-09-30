import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// button/text (Figma 414:31310): a word, optionally with an icon after it,
// on a raised key. The key is two boxes:
//
// - the outer key: 5px corners, a 1px rule on top and at the sides and a 2px
//   one under it, the light grey fill;
// - the inner face the label sits on.
//
// rest: grey key, grey label. hover: the key turns white and the face keeps
// the grey, so the face reads as lifted. press: the key sinks -- a 2px darker
// rule on top and at the sides, none under -- and the label turns lime.
//
// `size` is "M" (24px, label 10/12) or "S" (18px, label 8/10); `label`,
// `icon` (an SVG path), `size` and `disabled` are plain JS properties, the
// convention every UnlitElement component in this tree uses. A click on the
// host is the button's click.
const colors = {
  "text-button-background-color": ["#f7f7f7", "#3a3a3a"],
  "text-button-hover-background-color": ["#fff", "#2c2c2c"],
  "text-button-border-color": ["#e9e9e9", "#505050"],
  "text-button-press-border-color": ["#d9d9d9", "#5a5a5a"],
  "text-button-text-color": ["#8e8e8e", "#8e8e8e"],
  "text-button-press-text-color": ["#a9c915", "#a9c915"],
};

export class TextButton extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
      vertical-align: middle;
      cursor: pointer;
    }

    :host([disabled]) {
      cursor: default;
      pointer-events: none;
    }

    button {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      height: 24px;
      margin: 0;
      padding: 3px 3px 4px;
      border: 0 solid var(--text-button-border-color);
      border-width: 1px 1px 2px;
      border-radius: 5px;
      background-color: var(--text-button-background-color);
      color: var(--text-button-text-color);
      cursor: inherit;
      /* ui/button/M: label/S at the light weight */
      font: 320 condensed 10px / 12px var(--ui-font-mono);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      white-space: nowrap;
    }

    :host([data-size="S"]) button {
      height: 18px;
      font: 320 condensed 8px / 10px var(--ui-font-mono);
    }

    .face {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 100%;
      padding: 0 8px;
      border-radius: 2px;
    }

    :host([data-size="S"]) .face {
      padding: 0 3px;
    }

    .icon {
      display: block;
      width: 14px;
      height: 14px;
      flex: none;
    }

    :host([data-size="S"]) .icon {
      width: 12px;
      height: 12px;
    }

    :host(:hover) button {
      background-color: var(--text-button-hover-background-color);
    }

    :host(:hover) .face {
      background-color: var(--text-button-background-color);
    }

    :host(:active) button {
      padding: 4px 3px 2px;
      border-color: var(--text-button-press-border-color);
      border-width: 2px 2px 0;
      background-color: var(--text-button-background-color);
      color: var(--text-button-press-text-color);
    }

    :host(:active) .face {
      padding-bottom: 1px;
      background-color: transparent;
      border-radius: 2px 2px 4px 4px;
    }

    button:disabled {
      opacity: 0.4;
    }
  `;

  static properties = {
    label: { type: String },
    icon: { type: String },
    size: { type: String },
  };

  get disabled() {
    return this._disabled ?? false;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.toggleAttribute("disabled", this._disabled);
    if (this._button) {
      this._button.disabled = this._disabled;
    }
  }

  render() {
    // Markup may give the size as an attribute and the label as the
    // element's text.
    const size = this.size ?? this.getAttribute("size");
    this.setAttribute("data-size", size === "S" ? "S" : "M");
    const faceChildren = [this.label ?? this.textContent.trim()];
    if (this.hasAttribute("disabled")) {
      this._disabled = true;
    }
    if (this.icon) {
      faceChildren.push(
        html.createDomElement("inline-svg", { class: "icon", src: this.icon })
      );
    }
    this._button = html.button({ type: "button", disabled: this.disabled }, [
      html.span({ class: "face" }, faceChildren),
    ]);
    return this._button;
  }
}

customElements.define("text-button", TextButton);
