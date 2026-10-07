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
  // Light colours are the design system's tokens (core.css); dark ones stay
  // hand-picked until the design has a dark mode.
  "icon-button-icon-color": ["var(--bt-sgc-ic-rest)", "#8e8e8e"],
  "icon-button-icon-hover-color": ["var(--bt-sgc-ic-hover)", "#e0e0e0"],
  "icon-button-icon-press-color": ["var(--bt-sgc-ic-focus)", "#a9c915"],
  "icon-button-icon-disabled-color": ["var(--bt-sgc-ic-disabled)", "#5a5a5a"],
  "icon-button-icon-active-color": ["var(--bt-sgi-ic-active)", "#e0e0e0"],
  "icon-button-icon-active-hover-color": ["var(--bt-sgc-ic-active-hover)", "#a9c915"],
  "icon-button-hover-background-color": ["var(--bt-sgi-sr-hover)", "#464646"],
  "icon-button-hover-border-color": [
    "var(--bt-sgi-ln-hover)",
    "rgba(255, 255, 255, 0.06)",
  ],
  "icon-button-press-background-color": ["var(--bt-sgi-sr-focus)", "#3c3c3c"],
  "icon-button-press-border-color": [
    "var(--bt-sgi-ln-focus)",
    "rgba(255, 255, 255, 0.14)",
  ],
  // button/table (Figma 4054:1391): the same states in a table row, but a
  // paler icon at rest, and hover lifts the face to white with a pale border
  // (the row under it may be the light grey).
  "icon-button-table-icon-color": ["var(--bt-sgt-ic-rest)", "#6a6a6a"],
  "icon-button-table-hover-background-color": ["var(--bt-sgt-sr-hover)", "#2c2c2c"],
  "icon-button-table-hover-border-color": [
    "var(--bt-sgt-ln-hover)",
    "rgba(255, 255, 255, 0.1)",
  ],
  // button/latch (Figma 287:15701): rest/hover/press/active backgrounds and
  // the shared border color, plus the dropdown card's own colors (moved in
  // from overflow-popover.js, which is now a thin subclass of this button).
  "icon-button-latch-background-color": ["var(--bt-sgb-sr-rest)", "#3a3a3a"],
  "icon-button-latch-hover-background-color": ["var(--bt-sgb-sr-hover)", "#444"],
  "icon-button-latch-press-background-color": ["var(--bt-sgb-sr-focus)", "#4a4a4a"],
  "icon-button-latch-active-background-color": [
    "var(--bt-sgb-sr-active-rest)",
    "#505050",
  ],
  "icon-button-latch-border-color": ["var(--bt-sgb-ln-rest)", "#555"],
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
      border-radius: var(--icon-button-inner-radius, 6px);
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

    /* The design's icon is 15px whatever the button's size (button/icon,
       Figma 2004:29230; button/table, Figma 4054:1391): the button grows or
       shrinks around it, the icon does not scale with it. */
    button > inline-svg:not(.icon-button-chevron) {
      display: block;
      flex: none;
      height: var(--icon-button-icon-size, 15px);
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

    /* The on state is the design's "active" (button/icon and button/table
       state=active): a darker icon at rest, the lime one under the pointer,
       the press look while pressed. The badge is separate and optional on
       any state. */
    :host([on]) button:not(:disabled):not(.icon-button-latch) {
      color: var(--icon-button-icon-active-color);
    }

    :host([on]:hover) button:not(:disabled):not(.icon-button-latch) {
      color: var(--icon-button-icon-active-hover-color);
    }

    :host([on]:active) button:not(:disabled):not(.icon-button-latch) {
      color: var(--icon-button-icon-press-color);
    }

    button:disabled {
      color: var(--icon-button-icon-disabled-color);
    }

    :host([table]) {
      --icon-button-icon-color: var(--icon-button-table-icon-color);
    }

    :host([table]:hover) button:not(:disabled):not(.icon-button-latch) {
      background-color: var(--icon-button-table-hover-background-color);
      border-color: var(--icon-button-table-hover-border-color);
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

    /* segment's chevron (Figma 2004:29126): an 8px box. */
    inline-svg.icon-button-chevron {
      width: 8px;
      height: 8px;
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

    /* settings overflow (Figma 4108:3038): white, ruled, 6px corners, a soft
       shadow; the content brings its own padding. */
    :host([settings-card]) .card {
      padding: 0;
      border: 1px solid var(--line-base-basic-1);
      border-radius: 6px;
      background: var(--ui-element-background-color);
      box-shadow: 0 2px 4px var(--shadow-base-1);
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
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

  // The content is shown through a slot, not moved in: it stays in the
  // caller's tree, so the caller's styles reach it.
  set dropdown(element) {
    if (this._dropdownContent && this._dropdownContent !== element) {
      this._dropdownContent.remove();
    }
    this._dropdownContent = element;
    if (!this._card) {
      this._card = html.div({ class: "card", popover: "auto" }, [
        html.createDomElement("slot", { name: "dropdown" }),
      ]);
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
      element.slot = "dropdown";
      this.appendChild(element);
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
      // Figma 2004:29230 and 4054:1391: 6px in both, on the corner with
      // the white ring.
      badge.size = "M";
      badge.state = "outside";
      result.push(badge);
    }
    return result.length > 1 ? result : this._button;
  }
}

customElements.define("icon-button", IconButton);
