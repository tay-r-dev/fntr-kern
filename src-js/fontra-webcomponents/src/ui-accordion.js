import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { FocusKeeper, enumerate } from "@fontra/core/utils.ts";

export class Accordion extends UnlitElement {
  static styles = `
  .ui-accordion-contents {
    display: grid;
    grid-template-rows: auto;
    align-content: start;
    gap: 0.5em;
    text-wrap: wrap;
    width: 100%;
    height: 100%;
  }

  .ui-accordion-item {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 0.2em;
    min-height: 0;
  }

  .ui-accordion-item[hidden] {
    display: none;
  }

  .ui-accordion-item-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    justify-content: start;
    align-items: center;
    /* heading/h1: the header is its card's heading. */
    font: var(--ui-text-heading-h1);
    letter-spacing: var(--ui-tracking-sans);
    text-transform: uppercase;
    cursor: pointer;
  }

  .ui-accordion-item .open-close-icon {
    height: 1.5em;
    width: 1.5em;
    transition: 120ms;
  }

  .ui-accordion-item.ui-accordion-item-closed .open-close-icon {
    transform: rotate(180deg);
  }

  .ui-accordion-item.ui-accordion-item-closed .ui-accordion-item-content {
    display: none;
  }

  /* Every accordion's contents: 12px under the header and in at the sides,
     8px under. An accordion runs to its card's edges, so these are the
     distances from the card's edge too. A plain div
     given as the contents lays its parts out top to bottom, 8px apart, so a
     caller writes no layout for it; a caller's own rules for that div win
     over this default -- a div whose parts touch says gap: 0 itself. */
  .ui-accordion-item-content {
    display: block;
    overflow: auto;
    padding: 12px 12px 8px;
  }

  ::slotted(div[slot$="-content"]) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* accordion switch (Figma 413:31167): a grey header bar ruled above and
     below, a 16px chevron, the h5 label, and the sections stacked with no
     gap. Open, the chevron points down; closed, up. The label is light grey
     at rest and darkens on hover, in both. */
  :host([switch]) .ui-accordion-contents {
    gap: 0;
  }

  :host([switch]) .ui-accordion-item {
    gap: 0;
  }

  :host([switch]) .ui-accordion-item-header {
    gap: 4px;
    padding: 4px 6px 4px 4px;
    background-color: var(--ui-accordion-switch-background-color, var(--surface-base-basic-1));
    border-top: 1px solid var(--ui-accordion-switch-border-color, var(--line-base-basic-1));
    border-bottom: 1px solid var(--ui-accordion-switch-border-color, var(--line-base-basic-1));
    /* ui/heading/h5 */
    font: var(--ui-text-heading-h5);
    text-transform: none;
    color: var(--ui-accordion-switch-text-color, var(--text-base-basic-3));
    transition: color 120ms;
  }

  :host([switch]) .ui-accordion-item-header:hover {
    color: var(--ui-accordion-switch-hover-text-color, var(--text-base-basic-2));
  }

  :host([switch]) .ui-accordion-item + .ui-accordion-item .ui-accordion-item-header {
    border-top: none;
  }

  :host([switch]) .open-close-icon {
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    padding: 3px;
    transform: rotate(180deg);
  }

  /* Closed, the chevron turns to point up. */
  :host([switch]) .ui-accordion-item-closed .open-close-icon {
    transform: none;
  }

  /* Last in its card, with its last shown item closed, the switch's header
     bar runs into the card's 8px under it and takes the card's lower
     corners (14px less its 1px rule), so no white strip is left below it. */
  :host([switch]:last-child)
    .ui-accordion-item-closed:not(:has(~ .ui-accordion-item:not([hidden])))
    .ui-accordion-item-header {
    margin-bottom: -8px;
    padding-bottom: 12px;
    border-bottom: none;
    border-radius: 0 0 13px 13px;
  }


  `;

  static properties = {
    items: { type: Array },
  };

  // The caller's parts of an item -- its content, its header's extra element
  // and a label that is an element -- are not moved into this shadow root but
  // shown through slots. They stay in the caller's tree, so the caller's own
  // styles (a panel's, a page's) style them; nothing need be passed in.
  // appendStyle is for this accordion's own chrome only.
  _slotted(node, name) {
    if (!(node instanceof Node)) {
      return node;
    }
    node.slot = name;
    if (node.parentNode !== this) {
      this.appendChild(node);
    }
    this._slottedNodes.add(node);
    return html.createDomElement("slot", { name });
  }

  render() {
    const itemElements = [];
    this._itemElements = new Map();
    this._slottedNodes = new Set();
    for (const [index, item] of enumerate(this.items || [])) {
      const id = item.id || `ui-accordion-item-${index}`;
      const slotName = (part) => `${index}-${part}`;

      const headerElement = html.div(
        {
          class: "ui-accordion-item-header",
          onclick: (event) => this._handleItemHeaderClick(event, item),
        },
        [
          html.createDomElement("inline-svg", {
            class: "open-close-icon",
            src: "/tabler-icons/chevron-up.svg",
          }),
          this._slotted(item.label, slotName("label")),
        ]
      );
      if (item.auxiliaryHeaderElement) {
        headerElement.appendChild(
          this._slotted(item.auxiliaryHeaderElement, slotName("aux"))
        );
      }

      const contentElement = html.div(
        { class: "ui-accordion-item-content", hidden: !item.open },
        [this._slotted(item.content, slotName("content"))]
      );

      const itemElement = html.div(
        { class: "ui-accordion-item", id: id, hidden: !!item.hidden },
        [headerElement, contentElement]
      );

      if (!item.open) {
        itemElement.classList.add("ui-accordion-item-closed");
      }

      itemElements.push(itemElement);
      this._itemElements.set(item, itemElement);
    }
    // Parts of items no longer shown go, including an earlier item's part
    // under a slot name a new item reuses.
    for (const child of [...this.children]) {
      if (child.slot && !this._slottedNodes.has(child)) {
        child.remove();
      }
    }
    return [
      html.link({ href: "/css/tooltip.css", rel: "stylesheet" }),
      html.div({ class: "ui-accordion-contents" }, itemElements),
    ];
  }

  // The caller's slotted parts first, then this accordion's own chrome.
  querySelector(selector) {
    return super.querySelector(selector) ?? this.shadowRoot.querySelector(selector);
  }

  querySelectorAll(selector) {
    return [
      ...super.querySelectorAll(selector),
      ...this.shadowRoot.querySelectorAll(selector),
    ];
  }

  _handleItemHeaderClick(event, item) {
    // A click on the header's own control (a switch, a reset button) is that
    // control's, not an open/close.
    if (item.auxiliaryHeaderElement?.contains?.(event.target)) {
      return;
    }
    if (event.altKey) {
      // Toggle all items depending on the open/closed state of the clicked item
      const doClose = item.open;
      this.items.forEach((item) => {
        this.openCloseAccordionItem(item, !doClose);
      });
    } else {
      // Toggle single item
      this.openCloseAccordionItem(item, !item.open);
    }
  }

  openCloseAccordionItem(item, openClose) {
    item.open = openClose;
    const parent = this._itemElements?.get(item);
    if (parent) {
      parent.classList.toggle("ui-accordion-item-closed", !openClose);
    }
    this.onItemOpenClose?.(item, item.open);
  }

  showHideAccordionItem(item, onOff) {
    item.hidden = !onOff;

    const parent = this._itemElements?.get(item);

    if (parent) {
      parent.hidden = !onOff;
    }
  }
}

customElements.define("ui-accordion", Accordion);

// An accordion's open and closed items survive a reload: restored from local
// storage under `prefix` + the item's id before the accordion first renders,
// and stored on every open or close from then on. Storage that fails leaves
// each item at its own default.
export function restoreAccordionOpenState(items, prefix) {
  for (const item of items) {
    if (!item.id) {
      continue;
    }
    try {
      const stored = localStorage.getItem(prefix + item.id);
      if (stored != null) {
        item.open = stored === "1";
      }
    } catch (error) {
      // The item's own default stands.
    }
  }
  return items;
}

export function persistAccordionOpenState(accordion, prefix) {
  accordion.onItemOpenClose = (item, open) => {
    if (!item.id) {
      return;
    }
    try {
      localStorage.setItem(prefix + item.id, open ? "1" : "0");
    } catch (error) {
      // Losing the state here isn't worth surfacing.
    }
  };
}

export function makeClickableIconHeader(iconPath, onClick) {
  const focus = new FocusKeeper();
  return html.div(
    {
      class: "clickable-icon-header",
      style: "height: 1.2em; width: 1.2em;",
      onmousedown: focus.save,
      onclick: (event) => {
        onClick(event);
        focus.restore();
      },
    },
    [
      html.createDomElement("inline-svg", {
        src: iconPath,
      }),
    ]
  );
}

export function groupAccordionHeaderButtons(buttons) {
  return html.div(
    {
      style: `display: grid;
      grid-template-columns: repeat(${buttons.length}, auto);
      gap: 0.15em;
      `,
    },
    buttons
  );
}

export function makeAccordionHeaderButton(button) {
  // button/icon at size S. `icon` is a full path, or a tabler icon's name.
  let options = {
    size: "S",
    src: button.icon.startsWith("/") ? button.icon : `/tabler-icons/${button.icon}.svg`,
    onclick: button.onclick,
  };

  if (button.id) {
    options.id = button.id;
  }

  if (button.tooltip) {
    options["data-tooltip"] = button.tooltip;
    options["data-tooltipposition"] = button.tooltipposition ?? "bottom";
  }

  return html.createDomElement("icon-button", options);
}
