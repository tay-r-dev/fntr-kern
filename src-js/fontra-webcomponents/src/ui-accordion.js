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
    /* ui/heading/h2 */
    font: var(--ui-text-heading-h2);
    letter-spacing: var(--ui-tracking);
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

  .ui-accordion-item-content {
    display: block;
    overflow: auto;
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
    background-color: var(--ui-accordion-switch-background-color, #fafafa);
    border-top: 1px solid var(--ui-accordion-switch-border-color, #e9e9e9);
    border-bottom: 1px solid var(--ui-accordion-switch-border-color, #e9e9e9);
    /* ui/heading/h5 */
    font: var(--ui-text-heading-h5);
    text-transform: none;
    color: var(--ui-accordion-switch-text-color, #b4b4b4);
    transition: color 120ms;
  }

  :host([switch]) .ui-accordion-item-header:hover {
    color: var(--ui-accordion-switch-hover-text-color, #565656);
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

  :host([switch]) .ui-accordion-item:not(.ui-accordion-item-closed) .ui-accordion-item-content {
    padding: 8px;
  }
  `;

  static properties = {
    items: { type: Array },
  };

  render() {
    const itemElements = [];
    for (const [index, item] of enumerate(this.items || [])) {
      const id = item.id || `ui-accordion-item-${index}`;

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
          item.label,
        ]
      );
      if (item.auxiliaryHeaderElement) {
        headerElement.appendChild(item.auxiliaryHeaderElement);
      }

      const contentElement = html.div(
        { class: "ui-accordion-item-content", hidden: !item.open },
        [item.content]
      );

      const itemElement = html.div(
        { class: "ui-accordion-item", id: id, hidden: !!item.hidden },
        [headerElement, contentElement]
      );

      if (!item.open) {
        itemElement.classList.add("ui-accordion-item-closed");
      }

      itemElements.push(itemElement);
    }
    return [
      html.link({ href: "/css/tooltip.css", rel: "stylesheet" }),
      html.div({ class: "ui-accordion-contents" }, itemElements),
    ];
  }

  querySelector(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.shadowRoot.querySelectorAll(selector);
  }

  _handleItemHeaderClick(event, item) {
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
    const parent = parentWithClass(item.content, "ui-accordion-item");
    if (parent) {
      parent.classList.toggle("ui-accordion-item-closed", !openClose);
    }
    this.onItemOpenClose?.(item, item.open);
  }

  showHideAccordionItem(item, onOff) {
    item.hidden = !onOff;

    const parent = parentWithClass(item.content, "ui-accordion-item");

    if (parent) {
      parent.hidden = !onOff;
    }
  }
}

customElements.define("ui-accordion", Accordion);

function parentWithClass(element, className) {
  let parent = element;
  do {
    parent = parent.parentElement;
  } while (parent && !parent.classList.contains(className));
  return parent;
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
  let options = {
    style: "width: 1.4em; height: 1.4em;",
    src: `/tabler-icons/${button.icon}.svg`,
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
