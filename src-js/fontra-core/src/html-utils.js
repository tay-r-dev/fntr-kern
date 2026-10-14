// This is a tiny subset of a few things that Lit does, except it uses
// object notation to construct dom elements instead of HTML.

// One parsed sheet per stylesheet file and per block of style text, shared by
// every shadow root that uses it. A shadow root adopts the sheet; nothing is
// inserted, parsed or matched again per element. A file the page already
// loaded is copied from the page's own sheet, so it applies on the first
// frame; the file is then fetched once and its exact text replaces the copy.
const sharedSheets = new Map();

export function sharedStyleSheet(href) {
  let sheet = sharedSheets.get(href);
  if (sheet) {
    return sheet;
  }
  sheet = new CSSStyleSheet();
  sharedSheets.set(href, sheet);
  const [base] = href.split("/").pop().split(".");
  const loaded = [...document.styleSheets].find((pageSheet) => {
    const name = pageSheet.href?.split("/").pop() ?? "";
    return name === `${base}.css` || (name.startsWith(`${base}.`) && name.endsWith(".css"));
  });
  let rules = null;
  try {
    rules = loaded ? [...loaded.cssRules].map((rule) => rule.cssText).join("\n") : null;
  } catch (error) {
    // Not readable (still loading, or another origin): fetched below.
  }
  if (rules != null) {
    sheet.replaceSync(rules);
  }
  // Always the file's own text in the end: rules copied from the page's sheet
  // can come back without a shorthand written with a token, such as
  // `font: var(--ui-text-label-xs)`, so every such text style was missing
  // inside the shadow roots.
  fetch(href)
    .then((response) => response.text())
    .then((text) => sheet.replace(text));
  return sheet;
}

const textSheets = new Map();

function styleSheetFromText(cssText) {
  let sheet = textSheets.get(cssText);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    textSheets.set(cssText, sheet);
  }
  return sheet;
}

function adoptStyleSheet(root, sheet) {
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}

export class SimpleElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._postInit();
  }

  _postInit() {
    this._attachStyles();
  }

  // Safe to call more than once: a sheet already adopted is not added again.
  _attachStyles() {
    this._appendStyleSheetLink("/css/shared.css");
    if (this.constructor.styles) {
      this._appendStyle(this.constructor.styles);
    }
  }

  _appendStyle(cssText) {
    adoptStyleSheet(this.shadowRoot, styleSheetFromText(cssText));
  }

  _appendStyleSheetLink(href) {
    adoptStyleSheet(this.shadowRoot, sharedStyleSheet(href));
  }

  appendStyle(cssText) {
    this._appendStyle(cssText);
  }
}

export class UnlitElement extends SimpleElement {
  _postInit() {
    this._attachStyles();
    this._setupProperties();
    // A change marks the element for one redraw on the next turn. A redraw
    // that happens first (the element joining the page) clears the mark, so
    // properties set before the element is placed don't draw it twice.
    this._needsRender = true;
    this._renderScheduled = false;
    this.requestUpdate = () => {
      this._needsRender = true;
      if (this._renderScheduled) {
        return;
      }
      this._renderScheduled = true;
      setTimeout(() => {
        this._renderScheduled = false;
        if (this._needsRender) {
          this._render();
        }
      }, 0);
    };
  }

  // Joining the page draws the element only if it has never drawn or has a
  // change waiting; an element moved from one parent to another keeps what
  // it drew.
  connectedCallback() {
    if (this._needsRender) {
      this._render();
    }
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
    this._needsRender = false;
    this.shadowRoot.replaceChildren();

    let elements = await this.render();
    // Cleared again after the await. Two renders can overlap -- a connect and
    // an update, or an element moved between two parents -- and both cleared
    // before either appended, so the element drew its contents twice.
    this.shadowRoot.replaceChildren();
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

// A table cell's width if it hugged its contents: a hidden copy set beside it
// at its natural width, padding and border included. A text field counts as
// its value set in that field's type; a dropdown as its own natural width,
// which fits its longest choice.
export function naturalCellWidth(cell) {
  const copy = cell.cloneNode(true);
  const stand = (field) => {
    const box = document.createElement("span");
    box.className = field.className;
    if (field.tagName === "SELECT") {
      // Measured where it stands, freed of the width its column gives it:
      // its max-content is its longest choice, and as a flex item it must
      // not shrink back into the wrapper while measured.
      const saved = field.getAttribute("style");
      field.style.width = "max-content";
      field.style.maxWidth = "none";
      field.style.flex = "none";
      const width = field.getBoundingClientRect().width;
      if (saved == null) {
        field.removeAttribute("style");
      } else {
        field.setAttribute("style", saved);
      }
      box.style.cssText = `display: inline-block; flex: none; width: ${width}px;`;
    } else {
      box.textContent = field.value;
      box.style.cssText = "display: inline-block; width: auto;";
    }
    return box;
  };
  const isField = cell.matches("input, select");
  const fields = isField ? [cell] : [...cell.querySelectorAll("input, select")];
  const copies = isField ? [copy] : [...copy.querySelectorAll("input, select")];
  let probe = copy;
  copies.forEach((field, i) => {
    const box = stand(fields[i]);
    if (field === copy) {
      probe = box;
    } else {
      field.replaceWith(box);
    }
  });
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.width = probe.style.width || "max-content";
  probe.style.minWidth = "0";
  probe.style.maxWidth = "none";
  probe.style.whiteSpace = "nowrap";
  cell.parentElement.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

// Marks `element` with the own-line attribute while what it sits in has
// wrapped to a line of its own under a heading: it is then lower in its row
// than half its own height. What it sits in is its outermost control group
// (shared.css), or the element itself outside one; the row is that one's
// parent. Returns the observer, for the caller to disconnect.
export function watchOwnLine(element) {
  let group = element.closest(".control-group");
  while (group?.parentElement?.closest(".control-group")) {
    group = group.parentElement.closest(".control-group");
  }
  group = group || element;
  const row = group.parentElement;
  if (!row) {
    return null;
  }
  const update = () => {
    const groupBox = group.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    element.toggleAttribute(
      "own-line",
      groupBox.height > 0 && groupBox.top - rowBox.top > groupBox.height / 2
    );
  };
  const observer = new ResizeObserver(update);
  observer.observe(row);
  update();
  return observer;
}

// A popover its button opens and closes. It is a manual popover: an auto
// popover closes itself on the press on its button, and the button's click
// then opens it again, so the button could never close it. Here a press on
// the button, or in the popover, is the button's own; a press anywhere else
// closes it, except in a menu opened from it, and so does Escape. `owner` is
// the element whose presses are the button's: the button, or a component
// holding both the button and the popover.
export class ButtonPopover {
  constructor(popover, owner) {
    this.popover = popover;
    this.owner = owner;
    popover.popover = "manual";
  }

  get isOpen() {
    return this.popover.matches(":popover-open");
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (this.isOpen) {
      return;
    }
    this.popover.showPopover();
    const onPointerDown = (event) => {
      const path = event.composedPath();
      if (
        path.includes(this.owner) ||
        path.includes(this.popover) ||
        path.some((node) => node.tagName === "MENU-PANEL")
      ) {
        return;
      }
      this.close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    this._stopWatching = () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }

  close() {
    this._stopWatching?.();
    this._stopWatching = null;
    if (this.isOpen) {
      this.popover.hidePopover();
    }
  }
}
