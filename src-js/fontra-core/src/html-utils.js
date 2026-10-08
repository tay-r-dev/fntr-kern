// This is a tiny subset of a few things that Lit does, except it uses
// object notation to construct dom elements instead of HTML.

import { consolidateCalls } from "./utils.ts";

export class SimpleElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._postInit();
  }

  _postInit() {
    this._attachStyles();
  }

  _attachStyles() {
    this._appendStyleSheetLink("/css/shared.css");
    if (this.constructor.styles) {
      this._appendStyle(this.constructor.styles);
    }
  }

  _appendStyle(cssText) {
    addStyleSheet(cssText, this.shadowRoot);
  }

  _appendStyleSheetLink(href) {
    addStyleSheetLink(href, this.shadowRoot);
  }

  appendStyle(cssText) {
    this._appendStyle(cssText);
  }
}

export class UnlitElement extends SimpleElement {
  _postInit() {
    this._additionalStyles = [];
    this._setupProperties();
    this.requestUpdate = consolidateCalls(() => this._render());
  }

  _attachStyles() {
    super._attachStyles();
    for (const style of this._additionalStyles) {
      this._appendStyle(style);
    }
  }

  appendStyle(cssText) {
    this._additionalStyles.push(cssText);
  }

  connectedCallback() {
    this._render();
  }

  _setupProperties() {
    this._propertyValues = {};
    for (const [prop, description] of Object.entries(
      this.constructor.properties || {}
    )) {
      Object.defineProperty(this, prop, {
        get: () => {
          return this._propertyValues[prop];
        },
        set: (value) => {
          if (
            description.type &&
            !(
              value?.constructor === description.type ||
              value instanceof description.type
            )
          ) {
            throw new TypeError(
              `${prop}: expected instance of ${description.type.name}, got ${value?.constructor.name}`
            );
          }
          this._propertyValues[prop] = value;
          this.requestUpdate();
        },
      });
    }
  }

  render() {
    //
    // Override, but don't call super().
    //
    // It should return a DOM Element, or an array of DOM Elements,
    // or arrays of arrays of DOM Elements, etc.
    //
    // Use createDomElement() to conveniently construct DOM Elements.
    //
  }

  async _render() {
    this.shadowRoot.innerHTML = "";
    this._attachStyles();

    let elements = await this.render();
    // Cleared again after the await. Two renders can overlap -- a connect and
    // an update, or an element moved between two parents -- and both cleared
    // before either appended, so the element drew its contents twice.
    this.shadowRoot.innerHTML = "";
    this._attachStyles();
    if (!elements) {
      return;
    }

    if (!Array.isArray(elements)) {
      elements = [elements];
    }
    elements = elements.flat();
    for (const element of elements) {
      this.shadowRoot.append(element);
    }
  }
}

const attrExceptions = { for: "htmlFor", class: "className", tabindex: "tabIndex" };

export function createDomElement(tagName, attributes, children) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key.slice(0, 5) === "data-") {
      element.dataset[key.slice(5)] = value;
    } else {
      element[attrExceptions[key] || key] = value;
    }
  }
  for (const child of children || []) {
    element.append(child);
  }
  return element;
}

export function htmlToElement(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  if (template.content.childNodes.length !== 1) {
    throw new Error("The html should contain a single node");
  }
  return template.content.firstChild;
}

export function htmlToElements(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  return template.content.childNodes;
}

// A table head's dividers: one per boundary between two neighbouring head
// cells, shown by marking the cell on its left with `shownClass`. A hovered
// cell shows the boundaries on both its sides; while a drag handle is
// hovered or dragged, only that handle's boundary shows. Tracked from the
// pointer, not from :hover, so leaving a cell always clears it. `cells()`
// lists the head cells in order; a boundary's handle, found by
// `handleSelector`, sits in the cell on its left and carries `draggingClass`
// while dragged. Returns a function that redraws, for a drag that ends.
export function trackHeadDividers(
  head,
  { cells, handleSelector, draggingClass = "dragging", shownClass = "divider-shown" }
) {
  let target = null;
  const show = () => {
    const list = cells();
    const handle =
      head.querySelector(`${handleSelector}.${draggingClass}`) ??
      target?.closest?.(handleSelector);
    const at = handle ? list.findIndex((cell) => cell.contains(handle)) : -1;
    const hovered = handle ? -1 : list.findIndex((cell) => cell.contains(target));
    list.forEach((cell, i) => {
      const shown = handle
        ? i === at
        : hovered >= 0 && (i === hovered || i === hovered - 1);
      cell.classList.toggle(shownClass, shown && i < list.length - 1);
    });
  };
  head.addEventListener("pointermove", (event) => {
    target = event.target;
    show();
  });
  head.addEventListener("pointerleave", () => {
    target = null;
    show();
  });
  return show;
}

export function addStyleSheet(cssText, element = null) {
  if (!element) {
    element = document.head;
  }
  element.appendChild(style({}, [cssText]));
}

export function addStyleSheetLink(href, element = null) {
  if (!element) {
    element = document.head;
  }
  element.appendChild(link({ href, rel: "stylesheet" }));
}

// Convenience shortcuts
export const a = createDomElement.bind(null, "a");
export const br = createDomElement.bind(null, "br");
export const button = createDomElement.bind(null, "button");
export const div = createDomElement.bind(null, "div");
export const form = createDomElement.bind(null, "form");
export const section = createDomElement.bind(null, "section");
export const input = createDomElement.bind(null, "input");
export const label = createDomElement.bind(null, "label");
export const span = createDomElement.bind(null, "span");
export const hr = createDomElement.bind(null, "hr");
export const link = createDomElement.bind(null, "link");
export const select = createDomElement.bind(null, "select");
export const option = createDomElement.bind(null, "option");
export const style = createDomElement.bind(null, "style");
export const details = createDomElement.bind(null, "details");
export const summary = createDomElement.bind(null, "summary");
export const b = createDomElement.bind(null, "b");
export const i = createDomElement.bind(null, "i");
export const pre = createDomElement.bind(null, "pre");
// Let's add more once needed
