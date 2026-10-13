import * as html from "@fontra/core/html-utils.js";
import { iconPath } from "@fontra/core/icons.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { FocusKeeper } from "@fontra/core/utils.ts";
import { InlineSVG } from "./inline-svg.js";
import "./indication-badge.js";
import { themeColorCSS } from "./theme-support.js";

// button/latch (Figma 287:15701): the design's standalone toggle button.
// Where a segmented control is one plate with one choice among several, a
// latch button is one toggle of its own, and the row of three in the Rib
// group (Figma 309:1617) is three of these, not segments of one plate.
//
// The button is two layers, and the states change both: the face draws the
// borders -- 1px at the bottom at rest, a hairline all around on hover, and
// the weight moved to the top while pressed or latched -- and the inner
// container draws its own grey fill over it on hover, or lets the face
// through otherwise. The icon is grey at rest and dark on hover, pressed,
// latched and while its dropdown is open (Figma 2004:29187).
//
// With `dropdown` content a click opens the card (and the button takes the
// dropdown look while it is open); without it a click is the caller's -- it
// answers through `onclick` and reflects the model back through `on`.
// `on`, `mixed`, `disabled`, `badge` and `dropdown` are plain JS properties,
// not HTML attributes -- set them after creating the element, the convention
// every UnlitElement-based component in this tree uses.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "latch-button-face-background-color": ["var(--surface-base-basic-2)", "#3a3a3a"],
  "latch-button-face-hover-background-color": ["var(--surface-base-basic-0)", "#4a4a4a"],
  "latch-button-face-press-background-color": ["var(--surface-base-basic-0)", "#4a4a4a"],
  "latch-button-face-on-background-color": ["var(--surface-base-basic-2)", "#505050"],
  "latch-button-face-disabled-background-color": ["var(--surface-base-basic-1)", "#333"],
  "latch-button-container-background-color": ["var(--surface-base-basic-2)", "#3a3a3a"],
  "latch-button-container-hover-background-color": ["var(--surface-base-basic-2)", "#444"],
  "latch-button-container-press-background-color": ["var(--surface-base-basic-2)", "#444"],
  "latch-button-container-disabled-background-color": [
    "var(--surface-base-basic-1)",
    "#333",
  ],
  "latch-button-border-color": ["var(--line-base-basic-2)", "#555"],
  "latch-button-disabled-border-color": ["var(--line-base-basic-1)", "#444"],
  "latch-button-icon-color": ["var(--icon-base-basic-3)", "#8e8e8e"],
  "latch-button-icon-hover-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "latch-button-icon-press-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "latch-button-icon-open-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "latch-button-icon-disabled-color": ["var(--icon-base-basic-4)", "#5a5a5a"],
  "latch-button-card-background-color": ["#fff", "#2a2a2a"],
  "latch-button-card-shadow-color": ["#0003", "#0008"],
};

export class LatchButton extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    /* The host is the button: the whole box it draws takes the pointer. The
       inner button only draws the face, and takes the keyboard focus. */
    :host {
      display: inline-block;
      position: relative;
      width: var(--height-l);
      height: var(--height-l);
      cursor: pointer;
      line-height: 0;
    }

    :host([disabled]) {
      cursor: default;
    }

    /* With a dropdown it is 40px wide: the icon and the chevron (Figma
       2004:29187). */
    :host([has-dropdown]) {
      width: 40px;
    }

    /* The face: at rest, the grey face with the 1px bottom edge. */
    button {
      display: flex;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 2px;
      background: var(--latch-button-face-background-color);
      border: 0 solid var(--latch-button-border-color);
      border-bottom-width: 1px;
      border-radius: var(--corner-outer-l);
      overflow: hidden;
      cursor: pointer;
      pointer-events: none;
      transition:
        background-color 150ms,
        border-width 100ms;
    }

    /* The container: the design's icon is 16px, the chevron 6px, 4px apart. */
    .container {
      flex: 1 1 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 0;
      padding: 3px 4px;
      border-radius: var(--corner-inner-l);
      background: var(--latch-button-container-background-color);
      color: var(--latch-button-icon-color);
      transition:
        background-color 150ms,
        color 150ms;
    }

    .container > inline-svg:not(.latch-button-chevron) {
      display: block;
      height: 16px;
      width: auto;
      aspect-ratio: 1;
    }

    /* The design's chevron: a 6px box. */
    inline-svg.latch-button-chevron {
      width: 6px;
      height: 6px;
      flex: none;
      transform: rotate(180deg);
    }

    /* Hover: a white face with a hairline top and bottom, the container's
       own fill over it, and a darker icon. */
    :host(:hover) button:not(:disabled):not(.on) {
      background: var(--latch-button-face-hover-background-color);
      border-top-width: 1px;
      border-bottom-width: 1px;
      padding: 3px 2px;
    }

    :host(:hover) button:not(:disabled):not(.on) .container {
      background: var(--latch-button-container-hover-background-color);
      padding: 4px;
      color: var(--latch-button-icon-hover-color);
    }

    /* Press: the white face loses its bottom edge, the container keeps its
       own fill, and the icon goes light lime. */
    :host(:active) button:not(:disabled) {
      background: var(--latch-button-face-press-background-color);
      border-width: 1px 1px 0;
      padding: 3px 2px 0;
    }

    :host(:active) button:not(:disabled) .container {
      background: var(--latch-button-container-press-background-color);
      padding: 2px;
      color: var(--latch-button-icon-press-color);
    }

    /* On, and open while its dropdown shows: the grey face with the
       weight at the top, and the dark icon. */
    button.on,
    button.open {
      background: var(--latch-button-face-on-background-color);
      border-width: 1px 1px 0;
      padding: 2px 1px 0;
    }

    button.on .container,
    button.open .container {
      background: transparent;
      padding: 2px;
    }

    button.on .container,
    button.open .container {
      color: var(--latch-button-icon-open-color);
    }

    /* A mixed selection: a dashed edge instead of the on fill, the same mark
       icon-button.js's toggles use. */
    button.mixed .container {
      outline: 1px dashed var(--latch-button-icon-color);
      outline-offset: -1px;
    }

    /* Disabled: the rest shape in the pale disabled colours. */
    button:disabled {
      background: var(--latch-button-face-disabled-background-color);
      border-color: var(--latch-button-disabled-border-color);
      border-bottom-width: 1px;
    }

    button:disabled .container {
      background: var(--latch-button-container-disabled-background-color);
      padding: 4px;
      color: var(--latch-button-icon-disabled-color);
    }

    /* The design's 6px indication-badge at the button's top-right corner,
       in every state (Figma 2004:29187): grey (rest status) at rest, on
       hover and disabled; lime while pressed, latched on or open. It sits
       4px down and 3px in at rest and disabled, 3px down on hover, and 3px
       down and 2px in while pressed, latched on or open. */
    indication-badge {
      position: absolute;
      top: 4px;
      right: 3px;
      pointer-events: none;
    }

    :host(:hover:not([disabled])) indication-badge {
      top: 3px;
    }

    indication-badge.shown,
    :host(:active:not([disabled])) indication-badge {
      top: 3px;
      right: 2px;
    }

    /* The lime look: the badge's own active colours, over the rest status
       render gives it. */
    indication-badge.shown,
    :host(:active:not([disabled])) indication-badge {
      --indication-badge-rest-fill: var(--surface-color-lime-basic-3);
      --indication-badge-rest-rim: var(--line-color-lime-basic-4);
    }

    /* The chevron flips while the card is open. */
    button.open .latch-button-chevron {
      transform: none;
    }

    /* The dropdown card: a native popover under the button's right edge, as
       icon-button.js draws it. */
    .popover-card {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 1em;
      border: none;
      border-radius: 0.8em;
      background: var(--latch-button-card-background-color);
      color: inherit;
      /* ui/label/XS, for the checks and toggles a card holds. */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      box-shadow: 0 0.2em 1em var(--latch-button-card-shadow-color);
    }
  `;

  constructor() {
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
    // The right button opens the dropdown at once, and a second right press
    // closes it.
    this.addEventListener("contextmenu", (event) => {
      if (own(event) && this.dropdown) {
        event.preventDefault();
        event.stopPropagation();
        this._cardPopover.toggle();
      }
    });
    // A keyboard press on the focused inner button bubbles here as a click too.
    this.addEventListener("click", (event) => {
      if (!own(event)) {
        return;
      }
      if (this._buttonOnClick) {
        this._buttonOnClick(event);
      } else if (this.dropdown) {
        this._cardPopover.toggle();
      }
      event.stopImmediatePropagation();
      this._focusKeeper.restore();
    });
  }

  static properties = {
    src: { type: String },
    on: { type: Boolean },
    mixed: { type: Boolean },
    badge: { type: Boolean },
  };

  get disabled() {
    return this._buttonDisabled;
  }

  set disabled(value) {
    this._buttonDisabled = !!value;
    this.toggleAttribute("disabled", this._buttonDisabled);
    if (this._button) {
      this._button.disabled = value;
    }
    if (value) {
      this._cardPopover?.close();
    }
  }

  set onclick(callback) {
    // Don't assign this.onclick, we only need button.onclick
    this._buttonOnClick = callback;
  }

  // The latched state: set by the caller from its model on every update, the
  // same get/set-plus-reflect shape icon-button.js's "on" uses.
  get on() {
    return this._buttonOn ?? false;
  }

  set on(value) {
    value = !!value;
    this._buttonOn = value;
    this.toggleAttribute("on", value);
    if (this._button) {
      this._button.classList.toggle("on", value);
    }
  }

  // A toggle whose selection disagrees: dashed, with "on" left off.
  get mixed() {
    return this._buttonMixed ?? false;
  }

  set mixed(value) {
    value = !!value;
    this._buttonMixed = value;
    this.toggleAttribute("mixed", value);
    if (this._button) {
      this._button.classList.toggle("mixed", value);
    }
  }

  // The card's content (an HTMLElement built by the caller). Building the
  // card once and keeping it around means an open popover survives an
  // unrelated property change.
  get dropdown() {
    return this._dropdownContent;
  }

  set dropdown(element) {
    this._dropdownContent = element;
    if (!this._card) {
      // Opened and closed by this button (html-utils.js's ButtonPopover).
      this._card = html.div({ class: "popover-card" }, []);
      this._cardPopover = new html.ButtonPopover(this._card, this);
      // Placed under the button's right edge, and kept on screen -- the
      // placement icon-button.js uses.
      this._card.addEventListener("beforetoggle", (event) => {
        if (event.newState !== "open") {
          return;
        }
        const rect = this._button.getBoundingClientRect();
        this._card.style.top = `${rect.bottom + 4}px`;
        this._card.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
      });
      // The button takes the design's dropdown look while the card is open.
      this._card.addEventListener("toggle", (event) => {
        if (this._button) {
          this._button.classList.toggle("open", event.newState === "open");
        }
      });
    }
    if (element) {
      this._card.replaceChildren(element);
    }
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._cardPopover?.close();
  }

  click() {
    this._button.click();
  }

  render() {
    const children = this.src
      ? [html.createDomElement("inline-svg", { src: iconPath(this.src) })]
      : [];
    if (this.dropdown) {
      children.push(
        html.createDomElement("inline-svg", {
          src: "chevron-up",
          class: "latch-button-chevron",
        })
      );
    }
    this._button = html.button(
      {
        disabled: this._buttonDisabled,
        class: [
          this.on ? "on" : "",
          this.mixed ? "mixed" : "",
          this._card?.matches(":popover-open") ? "open" : "",
        ]
          .join(" ")
          .trim(),
      },
      [html.div({ class: "container" }, children)]
    );
    // The badge is always there, grey; latched on, open or flagged it is
    // lime (a press turns it lime too, in CSS). Read here, at render: the
    // element base defines `on` per instance, over this class's setter, so
    // no attribute follows it.
    const lime = this.badge || this.on || this._card?.matches(":popover-open");
    const badge = html.createDomElement("indication-badge", {
      class: lime ? "shown" : "",
    });
    badge.size = "M";
    badge.status = "rest";
    this.toggleAttribute("has-dropdown", !!this.dropdown);
    return this.dropdown ? [this._button, this._card, badge] : [this._button, badge];
  }
}

customElements.define("latch-button", LatchButton);
