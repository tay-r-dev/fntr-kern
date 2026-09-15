import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// The overflow as a card: the same vertical three-dot as overflow-button.js,
// opening a panel of real controls (a segmented control, a check, icon groups)
// instead of a menu list. The caller builds the controls once and hands them
// over as `content`; this element only opens, places and closes the card.
// The card is a native popover, so a click outside and Escape close it.
const colors = {
  "overflow-popover-background-color": ["#fff", "#2a2a2a"],
  "overflow-popover-shadow-color": ["#0003", "#0008"],
};

export class OverflowPopover extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
    }

    button {
      display: flex;
      border: none;
      padding: 0;
      width: 1.5em;
      height: 1.5em;
      background: transparent;
      cursor: pointer;
    }

    button inline-svg {
      width: 100%;
      height: 100%;
    }

    button:disabled {
      cursor: default;
      opacity: 35%;
    }

    .card {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 1em;
      border: none;
      border-radius: 0.8em;
      background: var(--overflow-popover-background-color);
      color: inherit;
      box-shadow: 0 0.2em 1em var(--overflow-popover-shadow-color);
    }
  `;

  constructor() {
    super();
    this._disabled = false;
    // Built once. A render runs on every connect and on every update, and two
    // of them can overlap; handing back the same two nodes each time means an
    // overlap moves them rather than adding a second button and card.
    this._card = html.div({ class: "card", popover: "auto" }, []);
    // Placed under the button's right edge, and kept on screen.
    this._card.addEventListener("beforetoggle", (event) => {
      if (event.newState !== "open") {
        return;
      }
      const rect = this._button.getBoundingClientRect();
      this._card.style.top = `${rect.bottom + 4}px`;
      this._card.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
    });
    this._button = html.createDomElement(
      "button",
      {
        type: "button",
        // A press while open closes it: the popover's own light dismiss runs
        // first on pointerdown, so the click would reopen it without this.
        onpointerdown: () => (this._wasOpen = this._card.matches(":popover-open")),
        onclick: () => {
          if (!this._wasOpen) {
            this._card.showPopover();
          }
        },
      },
      [html.createDomElement("inline-svg", { src: "/tabler-icons/dots-vertical.svg" })]
    );
  }

  set content(element) {
    this._card.replaceChildren(element);
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this._button.disabled = this._disabled;
    if (this._disabled && this._card.matches(":popover-open")) {
      this._card.hidePopover();
    }
  }

  render() {
    return [this._button, this._card];
  }
}

customElements.define("overflow-popover", OverflowPopover);
