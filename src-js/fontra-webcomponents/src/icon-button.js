import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { FocusKeeper } from "@fontra/core/utils.ts";
import { InlineSVG } from "./inline-svg.js";
import "./indication-badge.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 11: the "on" state's background -- same light/dark shade
// ui-list.js's own row-selected-background-color already uses for a
// selected state, via the same themeColorCSS idiom (component-local
// theme colors, independent of whichever view's CSS happens to be
// loaded).
const colors = {
  "icon-button-on-background-color": ["#ddd", "#555"],
  // button/icon (Figma 306:1426): the default button's states -- a grey
  // icon at rest, a light-grey fill with a darker icon on hover, a
  // near-white fill with a faint border and the lime accent icon while
  // pressed, and a light-grey icon when disabled. The design's "alert"
  // state is `badge`: an indication-badge (Figma 287:15770) pinned to the
  // button's top-right corner, on top of the base or hover look.
  "icon-button-icon-color": ["#8e8e8e", "#8e8e8e"],
  "icon-button-icon-hover-color": ["#303030", "#e0e0e0"],
  "icon-button-icon-press-color": ["#a9c915", "#a9c915"],
  "icon-button-icon-disabled-color": ["#d9d9d9", "#5a5a5a"],
  "icon-button-hover-background-color": ["#f7f7f7", "#464646"],
  "icon-button-hover-border-color": [
    "rgba(0, 0, 0, 0.02)",
    "rgba(255, 255, 255, 0.06)",
  ],
  "icon-button-press-background-color": ["#fafafa", "#3c3c3c"],
  // button/table icon (Figma 411:28023): the same states in a table row,
  // but hover lifts the face to white (the row under it may be the light
  // grey), and the alert state's hover keeps the light grey.
  "icon-button-table-hover-background-color": ["#fff", "#2c2c2c"],
  "icon-button-press-border-color": [
    "rgba(224, 224, 224, 0.31)",
    "rgba(255, 255, 255, 0.14)",
  ],
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

    /* The host is the button: the whole box it draws, padding included,
       takes the pointer. The inner button only draws the face, and takes the
       keyboard focus. */
    :host {
      line-height: 0;
      /* For the badge dot at the button's top-right corner. */
      position: relative;
      display: inline-block;
      cursor: pointer;
    }

    :host([disabled]) {
      cursor: default;
    }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      /* The --icon-button-inner-* hooks let a container draw this face as
         part of a larger component (the tray's segment/button). */
      background-color: var(--icon-button-inner-fill, transparent);
      border: 1px solid var(--icon-button-inner-border, transparent);
      border-radius: var(--icon-button-inner-radius, 4px);
      box-sizing: border-box;
      padding: var(--icon-button-inner-padding, 0);
      opacity: var(--icon-button-inner-opacity, 1);
      margin: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      contain: content;
      color: var(--icon-button-icon-color);
      transition:
        background-color 150ms,
        color 150ms;
      /* ui/label/S, for a text segment. */
      font: var(--ui-text-label-m);
      letter-spacing: var(--ui-tracking-label-m);
    }

    /* The design's icon is 16px in a 20px button; the icon scales with the
       host and keeps its proportions, the button's width does not stretch
       it. */
    button > inline-svg:not(.icon-button-chevron) {
      display: block;
      height: var(--icon-button-icon-size, 80%);
      width: auto;
      aspect-ratio: 1;
    }

    /* Hover: a light-grey fill and a darker icon. */
    :host(:hover) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(
        --icon-button-inner-hover-fill,
        var(--icon-button-hover-background-color)
      );
      border-color: var(
        --icon-button-inner-hover-border,
        var(--icon-button-hover-border-color)
      );
      color: var(--icon-button-icon-hover-color);
    }

    /* Press: a near-white fill with a faint border, and the lime accent
       icon. */
    :host(:active) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(
        --icon-button-inner-press-fill,
        var(--icon-button-press-background-color)
      );
      border-color: var(
        --icon-button-inner-press-border,
        var(--icon-button-press-border-color)
      );
      color: var(--icon-button-icon-press-color);
    }

    button:disabled {
      color: var(--icon-button-icon-disabled-color);
    }

    /* button/table icon (Figma 411:28023): 16px, 18px in a table cell, the
       icon inset 3px. */
    :host([table]) button {
      padding: 3px;
      --icon-button-icon-size: 100%;
    }

    :host([table]:hover) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(--icon-button-table-hover-background-color);
      border-color: transparent;
    }

    :host([table][badge]:hover) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(--icon-button-hover-background-color);
    }

    :host([table]:active) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(--icon-button-press-background-color);
      border-color: var(--icon-button-press-border-color);
    }

    /* The "alert" state's badge: the design's 6px indication-badge at the
       top-right corner. */
    indication-badge {
      position: absolute;
      top: -1px;
      right: -1px;
      pointer-events: none;
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
      /* segment/button (Figma 287:15640): a 1px line under it at rest,
         above and below on hover, and above and at the sides, none under,
         while pressed or on. */
      border: 0 solid var(--icon-button-latch-border-color);
      border-bottom-width: 1px;
      border-radius: 6px;
      padding: 4px;
    }

    :host(:hover) button.icon-button-latch {
      background: var(--icon-button-latch-hover-background-color);
      border-width: 1px 0;
    }

    :host(:active) button.icon-button-latch {
      background: var(--icon-button-latch-press-background-color);
      border-width: 1px 1px 0;
    }

    button.icon-button-latch.icon-button-on {
      background: var(--icon-button-latch-active-background-color);
      border-width: 1px 1px 0;
      border-radius: 6px;
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
      /* ui/label/S's size in the old UI font, for the checks and toggles
         a card holds. */
      font: var(--ui-text-label-m);
      letter-spacing: var(--ui-tracking-label-m);
      font-family: var(--ui-font-old);
      box-shadow: 0 0.2em 1em var(--overflow-popover-shadow-color);
    }
  `;

  constructor(src) {
    super();
    this._focusKeeper = new FocusKeeper();
    // Every pointer event is the host's. A press in the dropdown card is the
    // card's own and passes through.
    const own = (event) =>
      !this._buttonDisabled && !event.composedPath().includes(this._card);
    this.addEventListener("mousedown", (event) => {
      if (own(event)) {
        this._focusKeeper.save();
      }
    });
    this.addEventListener("pointerdown", (event) => {
      if (own(event)) {
        this._wasOpen = this._card?.matches(":popover-open") ?? false;
      }
    });
    // The right button opens the dropdown at once.
    this.addEventListener("contextmenu", (event) => {
      if (own(event) && this.dropdown) {
        event.preventDefault();
        event.stopPropagation();
        this._openDropdown();
      }
    });
    // A keyboard press on the focused inner button bubbles here as a click too.
    this.addEventListener("click", (event) => {
      if (!own(event)) {
        return;
      }
      if (this._buttonOnClick) {
        this._buttonOnClick(event);
      } else if (this.dropdown && !this._wasOpen) {
        this._openDropdown();
      }
      event.stopImmediatePropagation();
      this._focusKeeper.restore();
    });
    if (src) {
      this.setAttribute("src", src);
      this.src = src;
    }
  }

  static properties = {
    src: { type: String },
    label: { type: String },
    latch: { type: Boolean },
    badge: { type: Boolean },
    table: { type: Boolean },
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
        disabled: this._buttonDisabled,
        class: [
          this.latch ? "icon-button-latch" : "",
          this.on ? "icon-button-on" : "",
          this.mixed ? "icon-button-mixed" : "",
        ]
          .join(" ")
          .trim(),
      },
      children
    );
    this.toggleAttribute("table", !!this.table);
    this.toggleAttribute("badge", !!this.badge);
    const result = this.dropdown ? [this._button, this._card] : [this._button];
    if (this.badge) {
      const badge = html.createDomElement("indication-badge", {});
      // The table icon's alert dot is the small one.
      badge.size = this.table ? "S" : "M";
      result.push(badge);
    }
    return result.length > 1 ? result : this._button;
  }
}

customElements.define("icon-button", IconButton);
