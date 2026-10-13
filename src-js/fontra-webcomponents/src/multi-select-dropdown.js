import * as html from "@fontra/core/html-utils.js";
import { iconPath } from "@fontra/core/icons.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
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
// place and fires "change" with the checked values in event.detail.checked
// -- a list, in singleChoice mode too, where the pick is event.detail.item.
// The caller owns
// persistence; this component only tracks what's checked and reopens the
// list after each pick so a designer can flip several checks in a row --
// singleChoice closes on pick instead, matching a plain <select>.
//
// `header` is an element shown above the list as its control row (a name and
// a field, say); the caller wires it, and closeMenu() shuts the list.
//
// An item may carry `group`: the items of one group are one choice among
// themselves, inside an otherwise multi-select list. `{divider: true}` draws a
// line. "change" also carries the picked item in event.detail.item.
// select/dropdown (Figma 2004:29427 field, 2004:29483 menu item): a white
// box with a hairline border, grey on hover, and the list's chosen item lime.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "multi-select-dropdown-background-color": ["var(--surface-base-basic-0)", "#2c2c2c"],
  // The field's own bindings (Figma 2004:29427): line 1 at rest and on
  // hover, surface 1 on hover.
  "multi-select-dropdown-border-color": [
    "var(--line-base-basic-1)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "multi-select-dropdown-hover-color": ["var(--surface-base-basic-1)", "#464646"],
  "multi-select-dropdown-hover-border-color": [
    "var(--line-base-basic-1)",
    "rgba(255, 255, 255, 0.18)",
  ],
  // The open ("selecting") field: surface 0 with a line 2 border.
  "multi-select-dropdown-open-color": ["var(--surface-base-basic-0)", "#2c2c2c"],
  "multi-select-dropdown-open-border-color": [
    "var(--line-base-basic-2)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "multi-select-dropdown-disabled-color": ["var(--surface-base-basic-1)", "#333"],
  "multi-select-dropdown-disabled-border-color": [
    "var(--line-base-basic-0)",
    "rgba(255, 255, 255, 0.08)",
  ],
  // The field's text: empty (the property name, or "select" under a label)
  // and filled (the pick), each at rest, on hover and while open.
  "multi-select-dropdown-placeholder-color": ["var(--text-base-basic-3)", "#8e8e8e"],
  "multi-select-dropdown-text-color": ["var(--text-base-basic-2)", "#e0e0e0"],
  "multi-select-dropdown-open-text-color": ["var(--text-base-basic-2)", "#e0e0e0"],
  "multi-select-dropdown-filled-text-color": ["var(--text-base-basic-2)", "#b0b0b0"],
  "multi-select-dropdown-filled-hover-text-color": [
    "var(--text-base-basic-2)",
    "#e0e0e0",
  ],
  "multi-select-dropdown-disabled-text-color": ["var(--text-base-basic-5)", "#5a5a5a"],
  // The chevron.
  "multi-select-dropdown-chevron-color": ["var(--icon-base-basic-3)", "#8e8e8e"],
  "multi-select-dropdown-chevron-hover-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "multi-select-dropdown-chevron-open-color": ["var(--icon-base-basic-2)", "#e0e0e0"],
  "multi-select-dropdown-chevron-filled-hover-color": [
    "var(--icon-base-basic-1)",
    "#f0f0f0",
  ],
  "multi-select-dropdown-chevron-disabled-color": [
    "var(--icon-base-basic-5)",
    "#5a5a5a",
  ],
  // The label above the field (select/dropdown, Figma 2004:29458).
  "multi-select-dropdown-heading-color": ["var(--text-base-basic-3)", "#b0b0b0"],
  // The "+N" tag after the pick when there are several.
  "multi-select-dropdown-tag-color": ["var(--surface-color-lime-basic-2)", "#d5ed57"],
  "multi-select-dropdown-tag-border-color": ["var(--line-color-lime-basic-2)", "#3b560033"],
  "multi-select-dropdown-tag-text-color": ["var(--text-color-lime-basic-2)", "#3b5600"],
  // The open list: white, hairline border, soft shadow.
  "multi-select-dropdown-list-background-color": ["#fff", "#2a2a2a"],
  "multi-select-dropdown-list-border-color": [
    "rgba(0, 0, 0, 0.1)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "multi-select-dropdown-list-shadow-color": [
    "rgba(0, 0, 0, 0.12)",
    "rgba(0, 0, 0, 0.4)",
  ],
  // Menu items: grey text; hover fills light grey. A one-choice list's pick
  // fills lime with dark-lime text; a several-choice list's checked items
  // are pale lime with a check, full lime on hover.
  "multi-select-dropdown-item-color": ["var(--text-base-basic-3)", "#b0b0b0"],
  "multi-select-dropdown-item-hover-color": [
    "var(--text-base-basic-2)",
    "#e0e0e0",
  ],
  "multi-select-dropdown-item-multi-hover-color": [
    "var(--text-base-basic-2)",
    "#e0e0e0",
  ],
  "multi-select-dropdown-item-hover-background-color": [
    "var(--surface-base-basic-2)",
    "#3a3a3a",
  ],
  "multi-select-dropdown-item-active-background-color": [
    "var(--surface-color-lime-basic-3)",
    "#d0eb49",
  ],
  "multi-select-dropdown-item-active-color": [
    "var(--text-color-lime-basic-2)",
    "#3b5600",
  ],
  "multi-select-dropdown-item-checked-background-color": [
    "var(--surface-color-lime-basic-1)",
    "#4a5a20",
  ],
  "multi-select-dropdown-item-checked-color": [
    "var(--text-color-lime-basic-3)",
    "#d0eb49",
  ],
  "multi-select-dropdown-item-check-color": [
    "var(--icon-color-lime-basic-3)",
    "#d0eb49",
  ],
  "multi-select-dropdown-item-checked-hover-background-color": [
    "var(--surface-color-lime-basic-3)",
    "#d0eb49",
  ],
  "multi-select-dropdown-item-checked-hover-color": [
    "var(--text-color-lime-basic-2)",
    "#3b5600",
  ],
  "multi-select-dropdown-item-check-hover-color": [
    "var(--icon-color-lime-basic-2)",
    "#3b5600",
  ],
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
    /* ui/label/XS */
    font: var(--ui-text-label-xs);
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
    border-radius: var(--corner-inner-l);
    color: var(--multi-select-dropdown-item-color);
  }

  .context-menu-item:not(.enabled) {
    opacity: 0.4;
  }

  .context-menu-item.enabled.selected {
    background-color: var(--multi-select-dropdown-item-hover-background-color);
    color: var(--multi-select-dropdown-item-multi-hover-color);
  }

  .context-menu-item.checked {
    background-color: var(--multi-select-dropdown-item-checked-background-color);
    color: var(--multi-select-dropdown-item-checked-color);
  }

  .context-menu-item.enabled.selected.checked {
    background-color: var(--multi-select-dropdown-item-checked-hover-background-color);
    color: var(--multi-select-dropdown-item-checked-hover-color);
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
    background-color: var(--multi-select-dropdown-item-check-color);
    mask: url("/images/menu-check.svg") center / contain no-repeat;
  }

  .context-menu-item.enabled.selected .check-mark {
    background-color: var(--multi-select-dropdown-item-check-hover-color);
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

  .context-menu-item.enabled.selected {
    color: var(--multi-select-dropdown-item-hover-color);
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
    /* In a row it takes the room the row has, from 72px to 156px; its label
       ends in an ellipsis where the field is narrower than it. Its control
       group moved to a line of its own under the heading, it fills that
       line; with stretch set it fills the room it is given anywhere. */
    :host {
      display: inline-block;
      flex: 1 1 auto;
      min-width: 72px;
      max-width: 156px;
      cursor: pointer;
    }

    :host([own-line]),
    :host([stretch]) {
      max-width: none;
    }

    /* The icon mode (the overflow button) is its icon's size, not a field's:
       it neither flexes nor takes a field's minimum. */
    :host([icon-mode]) {
      flex: none;
      min-width: 0;
      max-width: none;
    }

    :host([disabled]) {
      cursor: default;
    }

    /* With labelAbove (select/dropdown, Figma 2004:29458): the property name
       over the field, 4px apart. */
    :host([label-above]) {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
    }

    /* ui/heading/h5: the name is outside the field. */
    .heading {
      font: var(--ui-text-heading-h5);
      letter-spacing: var(--ui-tracking);
      color: var(--multi-select-dropdown-heading-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    button {
      pointer-events: none;
      background-color: var(--multi-select-dropdown-background-color);
      color: var(--multi-select-dropdown-placeholder-color);
      border: 1px solid var(--multi-select-dropdown-border-color);
      border-radius: var(--corner-outer-l);
      padding: 4px 6px;
      gap: 4px;
      /* ui/label/S */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
      box-sizing: border-box;
      height: var(--multi-select-dropdown-height, var(--height-l));
      width: var(--multi-select-dropdown-width, 100%);
      max-width: 100%;
      display: inline-flex;
      align-items: center;
    }

    /* select/dropdown/field (Figma 2004:29427): the text and the chevron
       each take their own token per state, empty or filled. */
    button.filled {
      color: var(--multi-select-dropdown-filled-text-color);
    }

    button.icon-mode,
    :host(:hover) button {
      color: var(--multi-select-dropdown-text-color);
    }

    :host(:hover) button.filled {
      color: var(--multi-select-dropdown-filled-hover-text-color);
    }

    button.open,
    :host(:hover) button.open {
      color: var(--multi-select-dropdown-open-text-color);
    }

    .chevron {
      color: var(--multi-select-dropdown-chevron-color);
    }

    :host(:hover) .chevron {
      color: var(--multi-select-dropdown-chevron-hover-color);
    }

    :host(:hover) button.filled .chevron {
      color: var(--multi-select-dropdown-chevron-filled-hover-color);
    }

    button.open .chevron,
    :host(:hover) button.open .chevron {
      color: var(--multi-select-dropdown-chevron-open-color);
    }

    button:disabled .chevron {
      color: var(--multi-select-dropdown-chevron-disabled-color);
    }

    :host(:hover) button {
      background-color: var(--multi-select-dropdown-hover-color);
      border-color: var(--multi-select-dropdown-hover-border-color);
    }

    /* Selecting (open): white with a faint border. */
    :host button.open:not(.icon-mode) {
      background-color: var(--multi-select-dropdown-open-color);
      border-color: var(--multi-select-dropdown-open-border-color);
    }

    /* Several picks: the lime "+N" tag (the other picks) after the first. */
    .tag {
      display: none;
      flex: none;
      box-sizing: border-box;
      height: 12px;
      padding: 0 2px;
      align-items: center;
      border: 1px solid var(--multi-select-dropdown-tag-border-color);
      border-radius: 3px;
      background-color: var(--multi-select-dropdown-tag-color);
      color: var(--multi-select-dropdown-tag-text-color);
      /* interactive/tag: 7/10 light, wide tracking, capitals */
      font: 300 semi-condensed 7px / 10px var(--ui-font-mono);
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    button.badged:not(.icon-mode) .tag {
      display: inline-flex;
    }

    /* The chevron flips while the list is open. */
    button.open .chevron {
      transform: scaleY(-1);
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

    /* The design's 8px chevron-down. */
    .chevron {
      display: block;
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
    }

    button:disabled,
    :host(:hover) button:disabled {
      background-color: var(--multi-select-dropdown-disabled-color);
      border-color: var(--multi-select-dropdown-disabled-border-color);
      color: var(--multi-select-dropdown-disabled-text-color);
    }

    /* Ticket 48: the icon mode, which is how the overflow button draws --
       as button/icon (icon-button.js): a 24px box round a 12px icon, the
       grey fill on hover, the press look while its list is open. */
    button.icon-mode,
    button.icon-mode:disabled {
      display: flex;
      justify-content: center;
      background-color: transparent;
      border: 1px solid transparent;
      border-radius: var(--corner-outer-l);
      padding: 0;
      width: var(--height-l);
      height: var(--height-l);
      color: var(--icon-base-basic-3);
      transition:
        background-color 150ms,
        color 150ms;
    }

    :host(:hover) button.icon-mode:not(:disabled) {
      background-color: var(--surface-base-basic-2);
      color: var(--icon-base-basic-2);
    }

    button.icon-mode.open,
    :host(:hover) button.icon-mode.open:not(:disabled) {
      background-color: var(--surface-base-basic-1);
      border-color: var(--line-base-basic-1);
      color: var(--icon-color-lime-basic-4);
    }

    button.icon-mode:disabled,
    :host(:hover) button.icon-mode:disabled {
      color: var(--icon-base-basic-4);
    }

    button.icon-mode inline-svg {
      display: block;
      width: 12px;
      height: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.toggleAttribute("icon-mode", !!this._icon);
    this._watchOwnLine();
  }

  disconnectedCallback() {
    this._ownLineObserver?.disconnect();
    this._ownLineObserver = null;
  }

  // In a control group (shared.css), marks whether the group has wrapped to
  // a line of its own under its heading.
  _watchOwnLine() {
    this._ownLineObserver?.disconnect();
    this._ownLineObserver = this.closest(".control-group")
      ? html.watchOwnLine(this)
      : null;
  }

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
    // A constructor may not set attributes; connectedCallback catches up.
    if (this.isConnected) {
      this.toggleAttribute("icon-mode", !!this._icon);
    }
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
    this._updateLabel();
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

  // `labelAbove`: the label is drawn over the field (select/dropdown), and
  // the empty field says "select". Without it the empty field shows the
  // label itself.
  get labelAbove() {
    return this._labelAbove ?? false;
  }

  set labelAbove(value) {
    this._labelAbove = !!value;
    this.toggleAttribute("label-above", this._labelAbove);
    this.requestUpdate();
  }

  // `stretch`: no 156px cap; the field fills the width its place gives it.
  get stretch() {
    return this._stretch ?? false;
  }

  set stretch(value) {
    this._stretch = !!value;
    this.toggleAttribute("stretch", this._stretch);
  }

  // The picks the field shows. A pick flagged `showsLabel` (an "All") reads
  // as no pick.
  _picks() {
    return this._items.filter(
      (item) => item.checked && !item.divider && !item.showsLabel
    );
  }

  _isBadged() {
    return this._picks().length > 1;
  }

  get header() {
    return this._header;
  }

  set header(value) {
    this._header = value || null;
  }

  get note() {
    return this._note;
  }

  set note(value) {
    this._note = value || "";
  }

  render() {
    this._headingSpan = this.labelAbove ? html.div({ class: "heading" }) : null;
    this._labelSpan = html.span({ class: "label" });
    this._tagSpan = null;
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
        ? [html.createDomElement("inline-svg", { src: iconPath(this._icon) })]
        : [
            this._labelSpan,
            (this._tagSpan = html.span({ class: "tag" })),
            html.createDomElement("inline-svg", {
              class: "chevron",
              src: "chevron-down",
            }),
          ]
    );
    this._updateLabel();
    return this._headingSpan ? [this._headingSpan, this._button] : this._button;
  }

  _buttonClass() {
    return [
      this._icon ? "icon-mode" : "",
      this._picks().length ? "filled" : "",
      this._isBadged() ? "badged" : "",
      this._menu ? "open" : "",
    ]
      .join(" ")
      .trim();
  }

  // Filled, the field reads as its first pick (the tag counts the rest).
  // Empty, it reads as the label, or "select" when the label is above it.
  _displayLabel() {
    const first = this._picks()[0];
    if (first) {
      return first.label ?? String(first.value);
    }
    return this.labelAbove ? translate("multi-select-dropdown.empty") : this._label;
  }

  _updateLabel() {
    if (this._headingSpan) {
      this._headingSpan.textContent = this._label;
    }
    if (this._labelSpan) {
      const text = this._displayLabel();
      const picks = this._picks().map((item) => item.label ?? String(item.value));
      this._labelSpan.textContent = text;
      this._labelSpan.title = picks.length ? picks.join(", ") : text;
    }
    if (this._tagSpan) {
      this._tagSpan.textContent = `+${this._picks().length - 1}`;
    }
  }

  _updateButtonClass() {
    this._updateLabel();
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
    if (this._header) {
      menuItems.unshift({ element: this._header });
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

  closeMenu() {
    if (this._menu) {
      this._menu.dismiss();
      this._menu = null;
    }
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
