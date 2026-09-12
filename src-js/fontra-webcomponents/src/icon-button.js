import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { FocusKeeper } from "@fontra/core/utils.ts";
import { InlineSVG } from "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 11: the "on" state's background -- same light/dark shade
// ui-list.js's own row-selected-background-color already uses for a
// selected state, via the same themeColorCSS idiom (component-local
// theme colors, independent of whichever view's CSS happens to be
// loaded).
const colors = {
  "icon-button-on-background-color": ["#ddd", "#555"],
};

export class IconButton extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      line-height: 0;
    }

    button {
      display: flex;
      background-color: transparent;
      border: none;
      padding: 0;
      margin: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
      contain: content;
    }

    button > inline-svg {
      width: 100%;
      height: 100%;
    }

    button svg {
      will-change: transform;
      transition: 150ms;
    }

    button:hover svg {
      transform: scale(1.1, 1.1);
    }

    button:active svg {
      transform: scale(1.2, 1.2);
    }

    button:disabled {
      opacity: 35%;
    }

    button:disabled svg {
      transform: none;
    }

    /* Ticket 11: the on state, off by default -- every existing
       icon-button never sets this class, so this rule never applies to
       them. */
    button.icon-button-on {
      background-color: var(--icon-button-on-background-color);
      border-radius: 0.25em;
    }
  `;

  constructor(src) {
    super();
    if (src) {
      this.setAttribute("src", src);
    }
  }

  static properties = {
    src: { type: String },
  };

  get disabled() {
    return this._buttonDisabled;
  }

  set disabled(value) {
    this._buttonDisabled = value;
    if (this._button) {
      this._button.disabled = value;
    }
  }

  set onclick(callback) {
    // Don't assign this.onclick, we only need button.onclick
    this._buttonOnClick = callback;
  }

  // Ticket 11: a boolean property and attribute for the "on" state, off by
  // default -- same get/set-plus-reflect shape as `disabled` above. Every
  // existing icon-button never sets this, so it stays off and looks
  // unchanged for them.
  get on() {
    return this._buttonOn ?? false;
  }

  set on(value) {
    value = !!value;
    this._buttonOn = value;
    this.toggleAttribute("on", value);
    if (this._button) {
      this._button.classList.toggle("icon-button-on", value);
    }
  }

  click() {
    this._button.click();
  }

  render() {
    const focus = new FocusKeeper();
    this._button = html.button(
      {
        onmousedown: focus.save,
        onclick: (event) => {
          this._buttonOnClick?.(event);
          event.stopImmediatePropagation();
          focus.restore();
        },
        disabled: this._buttonDisabled,
        class: this.on ? "icon-button-on" : "",
        style: `color: undefined var(--foreground-color);`, // TODO: huh.
      },
      [html.createDomElement("inline-svg", { src: this.src })]
    );
    return this._button;
  }
}

customElements.define("icon-button", IconButton);
