import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// indication/badge (Figma 287:15770): a small lime dot that flags an "alert"
// condition on its owner -- icon-button.js pins one to its top-right corner
// for the alert state. The badge draws nothing but the dot; positioning is
// the caller's job.
//
// `size` is "M" (6px, the default) or "S" (4px), the design's two sizes, and
// is a plain JS property, the convention every UnlitElement component in
// this tree uses.
const colors = {
  "indication-badge-color": ["#c4e61a", "#c4e61a"],
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
      border: 0.5px solid #fff;
      box-sizing: border-box;
    }

    :host([data-size="S"]) {
      width: 4px;
      height: 4px;
    }
  `;

  static properties = {
    size: { type: String },
  };

  render() {
    this.setAttribute("data-size", this.size === "S" ? "S" : "M");
  }
}

customElements.define("indication-badge", IndicationBadge);
