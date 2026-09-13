import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
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
const colors = {
  "multi-select-dropdown-border-color": ["#bbb", "#555"],
  "multi-select-dropdown-text-color": ["#000", "#fff"],
  "multi-select-dropdown-hover-color": ["#eee", "#444"],
};

export class MultiSelectDropdown extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
    }

    button {
      cursor: pointer;
      background-color: transparent;
      color: var(--multi-select-dropdown-text-color);
      border: 1px solid var(--multi-select-dropdown-border-color);
      border-radius: 0.25em;
      padding: 0.2em 0.6em;
      font-family: inherit;
      font-size: inherit;
    }

    button:hover {
      background-color: var(--multi-select-dropdown-hover-color);
    }

    .triangle {
      margin-left: 0.4em;
      font-size: 0.7em;
      vertical-align: middle;
    }
  `;

  constructor() {
    super();
    this._label = "";
    this._items = [];
    this._singleChoice = false;
    this._note = "";
    this._menu = null;
  }

  get label() {
    return this._label;
  }

  set label(value) {
    this._label = value || "";
    if (this._labelSpan) {
      this._labelSpan.textContent = this._label;
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
    this._labelSpan = html.span({}, [this._label]);
    this._button = html.createDomElement(
      "button",
      {
        type: "button",
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
      [this._labelSpan, html.span({ class: "triangle" }, ["▾"])]
    );
    return this._button;
  }

  toggleMenu() {
    if (this._menu) {
      this._menu.dismiss();
      this._menu = null;
      return;
    }
    this.openMenu();
  }

  openMenu() {
    const rect = this._button.getBoundingClientRect();
    const menuItems = this._items.map((item) => ({
      title: item.label,
      checked: item.checked,
      callback: () => this.pickItem(item),
    }));
    if (this._note) {
      menuItems.push(MenuItemDivider);
      menuItems.push({ title: this._note, enabled: () => false });
    }
    this._menu = showMenu(
      menuItems,
      { x: rect.left, y: rect.bottom },
      {
        onClose: () => {
          this._menu = null;
        },
        onSelect: () => {
          this._menu = null;
          if (!this._singleChoice) {
            this.openMenu();
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
    } else {
      item.checked = !item.checked;
    }
    this.dispatchEvent(
      new CustomEvent("change", { detail: { checked: this.checkedValues() } })
    );
  }

  checkedValues() {
    return this._items.filter((item) => item.checked).map((item) => item.value);
  }
}

customElements.define("multi-select-dropdown", MultiSelectDropdown);
