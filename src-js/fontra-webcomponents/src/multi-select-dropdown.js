import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./indication-badge.js";
import "./inline-svg.js";
import { MenuItemDivider, showMenu } from "./menu-panel.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 15 (UI-REFACTOR.md §3.3, UI-NOMENCLATURE.md §14): the multi-select
// dropdown -- a button that opens a list of checks and closes again. It
// knows nothing about kerning or any other caller; tickets 16-18, 48, 69 and
// 72 reuse it as-is.
//
// `label`, `items`, `singleChoice` and `note` are plain JS properties, not
// HTML attributes -- set them after creating the element
// (dropdown.items = [...]), the same convention every other UnlitElement
// component in this tree uses (labeled-toggle.js's own note on why).
//
// `items` is [{value, label, checked}, ...]. Checking an item mutates it in
// place and fires "change" with the checked values (or the one checked
// value, in singleChoice mode) in event.detail.checked. The caller owns
// persistence; this component only tracks what's checked and reopens the
// list after each pick so a designer can flip several checks in a row --
// singleChoice closes on pick instead, matching a plain <select>.
//
// An item may carry `group`: the items of one group are one choice among
// themselves, inside an otherwise multi-select list. `{divider: true}` draws a
// line. "change" also carries the picked item in event.detail.item.
// Figma input/dropdown design: a white box with a faint border, a slightly
// darker fill and border on hover, and a lime accent border while pressed --
// the same accent compact-scrub-field.js uses, so its dark-theme counterparts
// are reused here too.
const colors = {
  "multi-select-dropdown-background-color": ["#fff", "#2c2c2c"],
  "multi-select-dropdown-border-color": [
    "rgba(0, 0, 0, 0.1)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "multi-select-dropdown-hover-color": ["#f7f7f7", "#464646"],
  "multi-select-dropdown-hover-border-color": [
    "rgba(0, 0, 0, 0.12)",
    "rgba(255, 255, 255, 0.18)",
  ],
  "multi-select-dropdown-active-border-color": ["#def280", "#8fae4a"],
  "multi-select-dropdown-text-color": ["#303030", "#e0e0e0"],
  // A label with nothing chosen is the design's placeholder grey.
  "multi-select-dropdown-placeholder-color": ["#8e8e8e", "#8e8e8e"],
  // The open list: white, hairline border, soft shadow; the hovered item lime.
  "multi-select-dropdown-list-background-color": ["#fff", "#2a2a2a"],
  "multi-select-dropdown-list-border-color": [
    "rgba(0, 0, 0, 0.1)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "multi-select-dropdown-list-shadow-color": [
    "rgba(0, 0, 0, 0.12)",
    "rgba(0, 0, 0, 0.4)",
  ],
  // dropdown/menu_item (Figma 421:9846): grey text; a hovered item fills
  // light grey; the chosen item of a one-choice list fills lime with darker
  // text. A several-choice list marks its checked items with a check.
  "multi-select-dropdown-item-color": ["#565656", "#b0b0b0"],
  "multi-select-dropdown-item-hover-background-color": ["#f7f7f7", "#3a3a3a"],
  "multi-select-dropdown-item-active-background-color": ["#d5ed57", "#d5ed57"],
  "multi-select-dropdown-item-active-color": ["#303030", "#303030"],
};

const listStyles = `
  ${themeColorCSS(colors)}

  :host {
    box-sizing: border-box;
    padding: 4px;
    background-color: var(--multi-select-dropdown-list-background-color);
    border: 1px solid var(--multi-select-dropdown-list-border-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px var(--multi-select-dropdown-list-shadow-color);
    /* ui/label/S */
    font: var(--ui-text-label-s);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
  }

  .menu-container {
    margin: 0;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 2px;
    color: var(--multi-select-dropdown-item-color);
  }

  .context-menu-item:not(.enabled) {
    opacity: 0.4;
  }

  .context-menu-item.enabled.selected {
    background-color: var(--multi-select-dropdown-item-hover-background-color);
    color: var(--multi-select-dropdown-item-color);
  }

  .item-content {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The check: the design's 7x5.5 tick, only on a checked item. */
  .check-mark {
    display: none;
    flex: none;
    width: 7px;
    height: 5.5px;
    font-size: 0;
    background: url("/images/menu-check.svg") center / contain no-repeat;
  }

  .context-menu-item.checked .check-mark {
    display: block;
  }
`;

// A one-choice list shows no check: its chosen item is the lime one.
const singleChoiceListStyles = `
  .context-menu-item.checked .check-mark {
    display: none;
  }

  .context-menu-item.checked,
  .context-menu-item.enabled.selected.checked {
    background-color: var(--multi-select-dropdown-item-active-background-color);
    color: var(--multi-select-dropdown-item-active-color);
  }
`;

export class MultiSelectDropdown extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    /* The host is the button: the whole box it draws takes the pointer. The
       inner button only draws the face, and takes the keyboard focus. */
    :host {
      display: inline-block;
      cursor: pointer;
    }

    :host([disabled]) {
      cursor: default;
    }

    button {
      pointer-events: none;
      background-color: var(--multi-select-dropdown-background-color);
      color: var(--multi-select-dropdown-placeholder-color);
      border: 1px solid var(--multi-select-dropdown-border-color);
      border-radius: 6px;
      padding: 4px 6px;
      gap: 4px;
      /* ui/label/XS */
      font: var(--ui-text-label-s);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      box-sizing: border-box;
      height: var(--multi-select-dropdown-height, 24px);
      width: var(--multi-select-dropdown-width, auto);
      max-width: 100%;
      display: inline-flex;
      align-items: center;
    }

    /* The label is the placeholder grey until something is chosen, and on
       hover or while the list is open. */
    button.filled,
    button.open,
    button.icon-mode,
    :host(:hover) button {
      color: var(--multi-select-dropdown-text-color);
    }

    :host(:active) button:not(.filled):not(.icon-mode) {
      color: var(--multi-select-dropdown-placeholder-color);
    }

    :host(:hover) button {
      background-color: var(--multi-select-dropdown-hover-color);
      border-color: var(--multi-select-dropdown-hover-border-color);
    }

    /* Pressed: white with the lime accent border, the Figma design's "press"
       state. The "selecting" (open) state is white with the rest border. */
    :host(:active) button:not(.icon-mode),
    :host button.open:not(.icon-mode) {
      background-color: var(--multi-select-dropdown-background-color);
    }

    :host(:active) button {
      border-color: var(--multi-select-dropdown-active-border-color);
    }

    :host button.open:not(.icon-mode) {
      border-color: var(--multi-select-dropdown-border-color);
    }

    /* Filled (dropdown/multi-select, Figma 421:12049): the lime
       indication-badge before the label says something is chosen. */
    indication-badge {
      display: none;
      flex: none;
    }

    button.badged:not(.icon-mode) indication-badge {
      display: inline-block;
    }

    /* The chevron flips while the list is open or pressed, matching the
       design's "selecting" and "press" states. */
    button.open .chevron,
    :host(:active) button .chevron {
      transform: none;
    }

    /* A label longer than the button ends in an ellipsis; the triangle stays. */
    .label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      opacity: var(--multi-select-dropdown-label-opacity, 1);
    }

    /* The design's 12px chevron; the icon points up, so it turns to point down. */
    .chevron {
      display: block;
      flex: 0 0 auto;
      width: 12px;
      height: 12px;
      transform: rotate(180deg);
    }

    /* Ticket 48: the icon mode, which is how the overflow button draws. */
    button.icon-mode {
      display: flex;
      background-color: transparent;
      border: none;
      padding: 0;
      width: 1.5em;
      height: 1.5em;
    }

    button.icon-mode inline-svg {
      width: 100%;
      height: 100%;
    }

    button:disabled {
      opacity: 35%;
    }

    :host(:hover) button:disabled {
      background-color: transparent;
    }
  `;

  constructor() {
    super();
    // A press toggles, and it has to be mousedown: the menu closes itself on
    // any window mousedown (menu-panel.js's own listener), so by the time a
    // click event arrived the menu was already gone and the button only ever
    // reopened it. Stopping propagation keeps that window listener off our
    // own press.
    this.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMenu();
    });
    this._label = "";
    this._items = [];
    this._singleChoice = false;
    this._note = "";
    this._icon = "";
    this._disabled = false;
    this._menu = null;
  }

  // Ticket 48: an icon in place of the label and the triangle. The list it
  // opens is the same list.
  get icon() {
    return this._icon;
  }

  set icon(value) {
    this._icon = value || "";
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.toggleAttribute("disabled", this._disabled);
    if (this._button) {
      this._button.disabled = this._disabled;
    }
    if (this._disabled && this._menu) {
      this._menu.dismiss();
      this._menu = null;
    }
  }

  get label() {
    return this._label;
  }

  set label(value) {
    this._label = value || "";
    if (this._labelSpan) {
      this._labelSpan.textContent = this._label;
      this._labelSpan.title = this._label;
    }
  }

  get items() {
    return this._items;
  }

  set items(value) {
    this._items = value || [];
    this._updateButtonClass();
  }

  get singleChoice() {
    return this._singleChoice;
  }

  set singleChoice(value) {
    this._singleChoice = !!value;
    this._updateButtonClass();
  }

  get note() {
    return this._note;
  }

  set note(value) {
    this._note = value || "";
  }

  render() {
    this._labelSpan = html.span({ class: "label", title: this._label }, [this._label]);
    this._button = html.createDomElement(
      "button",
      {
        type: "button",
        class: this._buttonClass(),
        disabled: this._disabled,
        // mousedown skips the keyboard, so Enter and Space come back here.
        onkeydown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.toggleMenu();
          }
        },
      },
      this._icon
        ? [html.createDomElement("inline-svg", { src: this._icon })]
        : [
            html.createDomElement("indication-badge"),
            this._labelSpan,
            html.createDomElement("inline-svg", {
              class: "chevron",
              src: "/tabler-icons/chevron-up.svg",
            }),
          ]
    );
    return this._button;
  }

  _buttonClass() {
    return [
      this._icon ? "icon-mode" : "",
      this._items.some((item) => item.checked && !item.divider) ? "filled" : "",
      // A one-choice dropdown shows its pick as its label; only a
      // several-choice one flags a pick with the badge.
      !this._singleChoice && this._items.some((item) => item.checked && !item.divider)
        ? "badged"
        : "",
      this._menu ? "open" : "",
    ]
      .join(" ")
      .trim();
  }

  _updateButtonClass() {
    if (this._button) {
      this._button.className = this._buttonClass();
    }
  }

  toggleMenu() {
    if (this._disabled) {
      return;
    }
    if (this._menu) {
      this._menu.dismiss();
      this._menu = null;
      return;
    }
    this.openMenu();
  }

  openMenu() {
    const rect = this._button.getBoundingClientRect();
    // An item with `disabled` shows greyed and cannot be picked.
    const menuItems = this._items.map((item) =>
      item.divider
        ? MenuItemDivider
        : {
            title: item.label,
            checked: item.checked,
            enabled: () => !item.disabled,
            callback: () => this.pickItem(item),
          }
    );
    if (this._note) {
      menuItems.push(MenuItemDivider);
      menuItems.push({ title: this._note, enabled: () => false });
    }
    this._button.classList.add("open");
    this._menu = showMenu(
      menuItems,
      { x: rect.left, y: rect.bottom },
      {
        onClose: () => {
          this._menu = null;
          this._updateButtonClass();
        },
        onSelect: () => {
          this._menu = null;
          if (!this._singleChoice) {
            this.openMenu();
          } else {
            this._updateButtonClass();
          }
        },
      }
    );
    // The list takes the design's look here, not in the app-wide menu.
    this._menu.appendStyle(listStyles);
    if (this._singleChoice) {
      this._menu.appendStyle(singleChoiceListStyles);
    }
    this._menu.style.minWidth = `${rect.width}px`;
  }

  pickItem(item) {
    if (this._singleChoice) {
      for (const otherItem of this._items) {
        otherItem.checked = otherItem === item;
      }
    } else if (item.group) {
      for (const otherItem of this._items) {
        if (otherItem.group === item.group) {
          otherItem.checked = otherItem === item;
        }
      }
    } else {
      item.checked = !item.checked;
    }
    this._updateButtonClass();
    this.dispatchEvent(
      new CustomEvent("change", { detail: { checked: this.checkedValues(), item } })
    );
  }

  checkedValues() {
    return this._items
      .filter((item) => item.checked && !item.divider)
      .map((item) => item.value);
  }
}

customElements.define("multi-select-dropdown", MultiSelectDropdown);
