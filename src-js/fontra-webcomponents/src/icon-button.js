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
  // button/latch (Figma 287:15701): rest/hover/press/active backgrounds and
  // the shared border color, plus the dropdown card's own colors (moved in
  // from overflow-popover.js, which is now a thin subclass of this button).
  "icon-button-latch-background-color": ["#f5f5f5", "#3a3a3a"],
  "icon-button-latch-hover-background-color": ["#f7f7f7", "#444"],
  "icon-button-latch-press-background-color": ["#fcfcfc", "#4a4a4a"],
  "icon-button-latch-active-background-color": ["#f0f0f0", "#505050"],
  "icon-button-latch-border-color": ["#e0e0e0", "#555"],
  "overflow-popover-background-color": ["#fff", "#2a2a2a"],
  "overflow-popover-shadow-color": ["#0003", "#0008"],
};

export class IconButton extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      line-height: 0;
    }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      background-color: transparent;
      border: none;
      padding: 0;
      margin: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
      contain: content;
      font: inherit;
    }

    /* The icon fills the button's height and keeps its proportions; the
       button's width does not stretch it. */
    button > inline-svg:not(.icon-button-chevron) {
      display: block;
      height: 100%;
      width: auto;
      aspect-ratio: 1;
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

    /* Ticket 47: the mixed state, for a toggle whose selection disagrees --
       a dashed edge instead of the on fill. Off by default, like "on". */
    button.icon-button-mixed {
      outline: 1px dashed var(--icon-button-on-background-color);
      outline-offset: -1px;
      border-radius: 0.25em;
    }

    /* button/latch (Figma 287:15701): rest/hover/press/active/disabled, off
       by default like "on" -- callers opt in with the latch attribute. */
    button.icon-button-latch {
      box-sizing: border-box;
      width: 24px;
      height: 24px;
      background: var(--icon-button-latch-background-color);
      border: 1px solid var(--icon-button-latch-border-color);
      border-bottom-width: 2px;
      border-radius: 6px;
      padding: 4px;
    }

    button.icon-button-latch:hover {
      background: var(--icon-button-latch-hover-background-color);
      border-bottom-width: 1px;
    }

    button.icon-button-latch:active {
      background: var(--icon-button-latch-press-background-color);
      border-top-width: 2px;
      border-bottom-width: 1px;
    }

    button.icon-button-latch.icon-button-on {
      background: var(--icon-button-latch-active-background-color);
      border-top-width: 2px;
      border-bottom-width: 1px;
      border-radius: 6px;
    }

    button.icon-button-latch:hover svg,
    button.icon-button-latch:active svg {
      transform: none;
    }

    /* segment/button's 6px chevron (Figma 287:15640's "dropdown" state). */
    inline-svg.icon-button-chevron {
      width: 6px;
      height: 6px;
      flex: none;
      transform: rotate(180deg);
    }

    /* The dropdown card: a native popover placed under the button, same as
       overflow-popover.js drew it before this became a shared implementation. */
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

  constructor(src) {
    super();
    if (src) {
      this.setAttribute("src", src);
      this.src = src;
    }
  }

  static properties = {
    src: { type: String },
    label: { type: String },
    latch: { type: Boolean },
  };

  get disabled() {
    return this._buttonDisabled;
  }

  set disabled(value) {
    this._buttonDisabled = value;
    this.toggleAttribute("disabled", !!value);
    if (this._button) {
      this._button.disabled = value;
    }
    if (value && this._card?.matches(":popover-open")) {
      this._card.hidePopover();
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

  // Ticket 47: a boolean property for the mixed state, off by default and
  // the same shape as `on`. A caller sets it where the selection disagrees,
  // and leaves `on` false then.
  get mixed() {
    return this._buttonMixed ?? false;
  }

  set mixed(value) {
    value = !!value;
    this._buttonMixed = value;
    this.toggleAttribute("mixed", value);
    if (this._button) {
      this._button.classList.toggle("icon-button-mixed", value);
    }
  }

  // The card's content (an HTMLElement built by the caller, e.g. a
  // segmented control or a form). Building the card once and keeping it
  // around (rather than rebuilding it on every render) means an open
  // popover survives an unrelated property change.
  get dropdown() {
    return this._dropdownContent;
  }

  set dropdown(element) {
    this._dropdownContent = element;
    if (!this._card) {
      this._card = html.div({ class: "card", popover: "auto" }, []);
      // Placed under the button's right edge, and kept on screen -- same
      // placement overflow-popover.js used.
      this._card.addEventListener("beforetoggle", (event) => {
        if (event.newState !== "open") {
          return;
        }
        const rect = this._button.getBoundingClientRect();
        this._card.style.top = `${rect.bottom + 4}px`;
        this._card.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
      });
    }
    if (element) {
      this._card.replaceChildren(element);
    }
    this.requestUpdate();
  }

  _openDropdown() {
    if (this._card && !this._card.matches(":popover-open")) {
      this._card.showPopover();
    }
  }

  click() {
    this._button.click();
  }

  render() {
    const focus = new FocusKeeper();
    const children =
      this.label && !this.src
        ? [this.label]
        : [html.createDomElement("inline-svg", { src: this.src })];
    if (this.dropdown) {
      children.push(
        html.createDomElement("inline-svg", {
          src: "/tabler-icons/chevron-up.svg",
          class: "icon-button-chevron",
        })
      );
    }
    this._button = html.button(
      {
        onmousedown: focus.save,
        onpointerdown: () => {
          this._wasOpen = this._card?.matches(":popover-open") ?? false;
        },
        // The right button opens the dropdown at once.
        oncontextmenu: (event) => {
          if (this.dropdown) {
            event.preventDefault();
            event.stopPropagation();
            this._openDropdown();
          }
        },
        onclick: (event) => {
          if (this._buttonOnClick) {
            this._buttonOnClick(event);
          } else if (this.dropdown && !this._wasOpen) {
            this._openDropdown();
          }
          event.stopImmediatePropagation();
          focus.restore();
        },
        disabled: this._buttonDisabled,
        class: [
          this.latch ? "icon-button-latch" : "",
          this.on ? "icon-button-on" : "",
          this.mixed ? "icon-button-mixed" : "",
        ]
          .join(" ")
          .trim(),
        style: `color: undefined var(--foreground-color);`, // TODO: huh.
      },
      children
    );
    return this.dropdown ? [this._button, this._card] : this._button;
  }
}

customElements.define("icon-button", IconButton);
