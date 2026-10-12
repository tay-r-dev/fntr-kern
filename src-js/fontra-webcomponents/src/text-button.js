import * as html from "@fontra/core/html-utils.js";
import { iconPath } from "@fontra/core/icons.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// button/text (Figma 2004:29279): a word, optionally with an icon after it,
// on a key. The key is two boxes: the outer key and the inner face the label
// sits on.
//
// rest: grey key ruled under only, grey label. hover: the key turns white and
// ruled all round, and the face keeps the grey, so the face reads as lifted.
// press: the key sinks -- a 2px rule on top, 1px at the sides, none under --
// and the label turns lime. disabled: flat, ruled under only.
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
  "text-button-disabled-background-color": ["var(--bt-sgb-sr-disabled)", "#333"],
  "text-button-border-color": ["var(--bt-sgb-ln-rest)", "#505050"],
  "text-button-hover-border-color": ["var(--bt-sgb-ln-hover)", "#505050"],
  "text-button-press-border-color": ["var(--bt-sgb-ln-focus)", "#5a5a5a"],
  "text-button-disabled-border-color": ["var(--bt-sgb-ln-disabled)", "#444"],
  "text-button-text-color": ["var(--bt-sgc-tx-rest)", "#8e8e8e"],
  "text-button-hover-text-color": ["var(--bt-sgc-tx-hover)", "#c0c0c0"],
  "text-button-press-text-color": ["var(--text-color-lime-basic-4)", "#a9c915"],
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

    /* button/text M (Figma 2004:29279): the key is bt-sgb-height tall with
       bt-sgb-corner corners and bt-sgb-padding at the sides; the face inside
       it has the same padding at its sides, 4px between label and icon. */
    button {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      height: var(--bt-sgb-height);
      margin: 0;
      padding: 3px var(--bt-sgb-padding) 4px;
      border: 0 solid var(--text-button-border-color);
      border-bottom-width: 1px;
      border-radius: var(--bt-sgb-corner);
      background-color: var(--text-button-background-color);
      color: var(--text-button-text-color);
      cursor: inherit;
      /* ui/label/XS (Figma 2004:29282) */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      white-space: nowrap;
    }

    :host([data-size="S"]) button {
      height: 19px;
    }

    .face {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 100%;
      padding: 0 var(--bt-sgb-padding);
      border-radius: 2px;
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

    /* hover: white, ruled all round; the face keeps the grey. */
    :host(:hover) button {
      padding: 3px calc(var(--bt-sgb-padding) - 1px) 4px;
      border-color: var(--text-button-hover-border-color);
      border-width: 1px;
      background-color: var(--text-button-hover-background-color);
      color: var(--text-button-hover-text-color);
    }

    :host(:hover) .face {
      background-color: var(--text-button-hover-face-color);
    }

    /* press: sunk -- 2px on top, 1px at the sides, none under; the label
       turns lime. The padding gives back what the rules take, so the key
       keeps its size. */
    :host(:active) button {
      padding: 4px calc(var(--bt-sgb-padding) - 1px) 2px;
      border-color: var(--text-button-press-border-color);
      border-width: 2px 1px 0;
      background-color: var(--text-button-press-background-color);
      color: var(--text-button-press-text-color);
    }

    :host(:active) .face {
      padding-bottom: 1px;
      background-color: transparent;
      border-radius: 2px 2px 4px 4px;
    }

    /* disabled: flat, a rule under only. */
    button:disabled {
      padding: 4px var(--bt-sgb-padding);
      border-color: var(--text-button-disabled-border-color);
      border-width: 0 0 1px;
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
        html.createDomElement("inline-svg", { class: "icon", src: iconPath(this.icon) })
      );
    }
    this._button = html.button({ type: "button", disabled: this.disabled }, [
      html.span({ class: "face" }, faceChildren),
    ]);
    return this._button;
  }
}

customElements.define("text-button", TextButton);
