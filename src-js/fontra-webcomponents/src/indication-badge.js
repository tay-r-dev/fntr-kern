import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// indication/badge (Figma 287:15770): a small lime dot that flags an "alert"
// condition on its owner -- icon-button.js pins one to its top-right corner
// for the alert state. The badge draws nothing but the dot; positioning is
// the caller's job.
//
// `size` is "M" (6px, the default) or "S" (4px). `state` is "inside" (the
// default: a dark-lime rim, for a badge drawn inside its owner, as on a latch
// button) or "outside" (a white ring, for a badge straddling its owner's
// corner, as on an icon button) -- Figma 2004:29970. Both are plain JS
// properties, the convention every UnlitElement component in this tree uses.
const colors = {
  "indication-badge-color": ["var(--ind-bdg-sr-active)", "#d0eb49"],
  "indication-badge-inside-color": ["var(--ind-bdg-ln-inside)", "#9cbb12"],
  "indication-badge-outside-color": ["var(--ind-bdg-ln-outside)", "#333"],
};

export class IndicationBadge extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--indication-badge-color);
      border: 0.5px solid var(--indication-badge-inside-color);
      box-sizing: border-box;
    }

    :host([data-state="outside"]) {
      border: none;
      box-shadow: 0 0 0 2px var(--indication-badge-outside-color);
    }

    :host([data-size="S"]) {
      width: 4px;
      height: 4px;
    }
  `;

  static properties = {
    size: { type: String },
    state: { type: String },
  };

  render() {
    this.setAttribute("data-size", this.size === "S" ? "S" : "M");
    this.setAttribute("data-state", this.state === "outside" ? "outside" : "inside");
  }
}

customElements.define("indication-badge", IndicationBadge);
