import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
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
};

export class MultiSelectDropdown extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
    }

    button {
      cursor: pointer;
      background-color: var(--multi-select-dropdown-background-color);
      color: var(--multi-select-dropdown-text-color);
      border: 1px solid var(--multi-select-dropdown-border-color);
      border-radius: 6px;
      padding: 4px 6px;
      gap: 4px;
      font-family: inherit;
      font-size: 10px;
      letter-spacing: -0.3px;
      line-height: 12px;
      box-sizing: border-box;
      height: var(--multi-select-dropdown-height, auto);
      width: var(--multi-select-dropdown-width, auto);
      max-width: 100%;
      display: inline-flex;
      align-items: center;
    }

    button:hover {
      background-color: var(--multi-select-dropdown-hover-color);
      border-color: var(--multi-select-dropdown-hover-border-color);
    }

    /* Pressed: the lime accent border from the Figma design's "press" state.
       The "selecting" (open) state keeps the rest-state border. */
    button:active {
      border-color: var(--multi-select-dropdown-active-border-color);
    }

    /* The chevron flips while the list is open, matching the design's
       "selecting" state. */
    button.open .triangle {
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

    .triangle {
      flex: 0 0 auto;
      margin-left: 0.4em;
      font-size: 0.7em;
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
      cursor: default;
      opacity: 35%;
    }

    button:disabled:hover {
      background-color: transparent;
    }
  `;

  constructor() {
    super();
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
  }

  get singleChoice() {
    return this._singleChoice;
  }

  set singleChoice(value) {
    this._singleChoice = !!value;
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
        class: this._icon ? "icon-mode" : "",
        disabled: this._disabled,
        // A press on the button toggles, and it has to be mousedown: the
        // menu closes itself on any window mousedown (menu-panel.js's own
        // listener), so by the time a click event arrived the menu was
        // already gone and the button only ever reopened it. Stopping
        // propagation here keeps that window listener off our own press.
        onmousedown: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleMenu();
        },
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
        : [this._labelSpan, html.span({ class: "triangle" }, ["▾"])]
    );
    return this._button;
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
          this._button.classList.remove("open");
        },
        onSelect: () => {
          this._menu = null;
          if (!this._singleChoice) {
            this.openMenu();
          } else {
            this._button.classList.remove("open");
          }
        },
      }
    );
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
