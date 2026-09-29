import * as html from "@fontra/core/html-utils.js";
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
// through otherwise. The icon is grey at rest, dark on hover, light lime
// while pressed and dark lime while its dropdown is open; a latched button
// keeps the grey icon and puts its indicator in the badge instead.
//
// With `dropdown` content a click opens the card (and the button takes the
// dropdown look while it is open); without it a click is the caller's -- it
// answers through `onclick` and reflects the model back through `on`.
// `on`, `mixed`, `disabled`, `badge` and `dropdown` are plain JS properties,
// not HTML attributes -- set them after creating the element, the convention
// every UnlitElement-based component in this tree uses.
const colors = {
  "latch-button-face-background-color": ["#f5f5f5", "#3a3a3a"],
  "latch-button-face-hover-background-color": ["#ffffff", "#4a4a4a"],
  "latch-button-face-press-background-color": ["#ffffff", "#4a4a4a"],
  "latch-button-face-on-background-color": ["#f0f0f0", "#505050"],
  "latch-button-container-background-color": ["#f5f5f5", "#3a3a3a"],
  "latch-button-container-hover-background-color": ["#f7f7f7", "#444"],
  "latch-button-border-color": ["#e0e0e0", "#555"],
  "latch-button-icon-color": ["#8e8e8e", "#8e8e8e"],
  "latch-button-icon-hover-color": ["#303030", "#e0e0e0"],
  "latch-button-icon-press-color": ["#d5ed57", "#d5ed57"],
  "latch-button-icon-open-color": ["#8eac10", "#8eac10"],
  "latch-button-icon-disabled-color": ["#565656", "#5a5a5a"],
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
      width: 24px;
      height: 24px;
      cursor: pointer;
      line-height: 0;
    }

    :host([disabled]) {
      cursor: default;
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
      border-radius: 6px;
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

    /* The design's 6px chevron. */
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
      padding: 2px 1px;
    }

    :host(:hover) button:not(:disabled):not(.on) .container {
      background: var(--latch-button-container-hover-background-color);
      border-radius: 4px;
      padding: 4px;
      color: var(--latch-button-icon-hover-color);
    }

    /* Press: the white face loses its bottom edge, the container keeps its
       own fill, and the icon goes light lime. */
    :host(:active) button:not(:disabled) {
      background: var(--latch-button-face-press-background-color);
      border-width: 1px 1px 0;
      padding: 2px 2px 0;
    }

    :host(:active) button:not(:disabled) .container {
      background: var(--latch-button-container-hover-background-color);
      border-radius: 4px;
      padding: 2px;
      color: var(--latch-button-icon-press-color);
    }

    /* On, and open while its dropdown shows: the darker face with the
       weight at the top. Open also turns the icon dark lime. */
    button.on,
    button.open {
      background: var(--latch-button-face-on-background-color);
      border-width: 1px 1px 0;
      padding: 2px 1px 0;
    }

    button.on .container,
    button.open .container {
      background: transparent;
      border-radius: 5px 5px 4px 4px;
      padding: 2px;
    }

    button.open .container {
      color: var(--latch-button-icon-open-color);
    }

    /* A mixed selection: a dashed edge instead of the on fill, the same mark
       icon-button.js's toggles use. */
    button.mixed .container {
      outline: 1px dashed var(--latch-button-icon-color);
      outline-offset: -1px;
      border-radius: 4px;
    }

    /* Disabled: the rest face with a hairline bottom, the container faded. */
    button:disabled {
      border-bottom-width: 1px;
    }

    button:disabled .container {
      background: transparent;
      border-radius: 4px;
      padding: 4px;
      opacity: 0.3;
      color: var(--latch-button-icon-disabled-color);
    }

    /* The design's 6px indication-badge at the button's top-right corner. */
    indication-badge {
      position: absolute;
      top: 3px;
      right: 2px;
      display: none;
      pointer-events: none;
    }

    /* Shown while latched on (render sets .shown), and through the press. */
    indication-badge.shown,
    :host(:active:not([disabled])) indication-badge {
      display: inline-block;
    }

    /* The chevron flips while the card is open. */
    button.open .latch-button-chevron {
      transform: none;
    }

    /* The dropdown card: a native popover under the button's right edge, as
       icon-button.js draws it. */
    .card {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 1em;
      border: none;
      border-radius: 0.8em;
      background: var(--latch-button-card-background-color);
      color: inherit;
      /* ui/label/S's size in the old UI font, for the checks and toggles a
         card holds. */
      font: var(--ui-text-label-m);
      letter-spacing: var(--ui-tracking-label-m);
      font-family: var(--ui-font-old);
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
    if (value && this._card?.matches(":popover-open")) {
      this._card.hidePopover();
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
      this._card = html.div({ class: "card", popover: "auto" }, []);
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

  _openDropdown() {
    if (this._card && !this._card.matches(":popover-open")) {
      this._card.showPopover();
    }
  }

  click() {
    this._button.click();
  }

  render() {
    const children = this.src
      ? [html.createDomElement("inline-svg", { src: this.src })]
      : [];
    if (this.dropdown) {
      children.push(
        html.createDomElement("inline-svg", {
          src: "/tabler-icons/chevron-up.svg",
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
    // The badge is always there: a press shows it too.
    const badge = html.createDomElement("indication-badge", {
      // Latched shows it too. Read here, at render: the element base defines
      // `on` per instance, over this class's setter, so no attribute follows it.
      class: this.badge || this.on ? "shown" : "",
    });
    badge.size = "M";
    return this.dropdown ? [this._button, this._card, badge] : [this._button, badge];
  }
}

customElements.define("latch-button", LatchButton);
