import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// button/text (Figma 414:31310): a word, optionally with an icon after it,
// on a raised key. The key is two boxes:
//
// - the outer key: 6px corners, a 1px rule on top and at the sides and a 2px
//   one under it, the light grey fill;
// - the inner face the label sits on.
//
// rest: grey key, grey label. hover: the key turns white and the face keeps
// the grey, so the face reads as lifted. press: the key sinks -- a 2px darker
// rule on top and at the sides, none under -- and the label turns lime.
//
// `size` is "M" (24px, label 10/12) or "S" (19px, label 10/10); `label`,
// `icon` (an SVG path), `size` and `disabled` are plain JS properties, the
// convention every UnlitElement component in this tree uses. A click on the
// host is the button's click.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "text-button-background-color": ["var(--bt-sgb-sr-rest)", "#3a3a3a"],
  "text-button-hover-background-color": ["var(--bt-sgb-sr-hover)", "#2c2c2c"],
  "text-button-hover-face-color": ["var(--bt-sgc-sr-hover)", "#3a3a3a"],
  "text-button-press-background-color": ["var(--bt-sgx-sr-focus)", "#3a3a3a"],
  "text-button-disabled-background-color": ["var(--bt-sgc-sr-disabled)", "#333"],
  "text-button-border-color": ["var(--bt-sgb-ln-rest)", "#505050"],
  "text-button-hover-border-color": ["var(--bt-sgb-ln-hover)", "#505050"],
  "text-button-press-border-color": ["var(--bt-sgb-ln-focus)", "#5a5a5a"],
  "text-button-disabled-border-color": ["var(--bt-sgb-ln-disabled)", "#444"],
  "text-button-text-color": ["var(--bt-sgc-tx-rest)", "#8e8e8e"],
  "text-button-hover-text-color": ["var(--bt-sgc-tx-hover)", "#c0c0c0"],
  "text-button-press-text-color": ["var(--bt-sgc-tx-focus)", "#a9c915"],
  "text-button-disabled-text-color": ["var(--bt-sgc-tx-disabled)", "#5a5a5a"],
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
      border-radius: 6px;
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
      height: 19px;
      font: 320 condensed 10px / 10px var(--ui-font-mono);
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
      border-color: var(--text-button-hover-border-color);
      background-color: var(--text-button-hover-background-color);
      color: var(--text-button-hover-text-color);
    }

    :host(:hover) .face {
      background-color: var(--text-button-hover-face-color);
    }

    /* The sides' rule grows 1px; the padding gives it back, so the key keeps
       its width. */
    :host(:active) button {
      padding: 4px 2px 2px;
      border-color: var(--text-button-press-border-color);
      border-width: 2px 2px 0;
      background-color: var(--text-button-press-background-color);
      color: var(--text-button-press-text-color);
    }

    :host(:active) .face {
      padding-bottom: 1px;
      background-color: transparent;
      border-radius: 2px 2px 4px 4px;
    }

    /* disabled: flat -- no top rule, 1px at the sides and under. */
    button:disabled {
      padding: 4px 3px;
      border-color: var(--text-button-disabled-border-color);
      border-width: 0 1px 1px;
      background-color: var(--text-button-disabled-background-color);
      color: var(--text-button-disabled-text-color);
    }

    button:disabled .face {
      padding-bottom: 1px;
      border-radius: 2px 2px 4px 4px;
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
