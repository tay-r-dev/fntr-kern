import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { clamp, hyphenatedToLabel } from "@fontra/core/utils.ts";

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;

// How long the pointer rests on a panel's scrollbar strip before the
// scrollbar shows, and the strip's least width where scrollbars overlay.
const SCROLLBAR_REVEAL_DELAY = 500;
const SCROLLBAR_MIN_STRIP = 8;

export class Sidebar {
  constructor(identifier) {
    this.identifier = identifier;
    this.container = null;
    this.panelIdentifiers = [];
  }

  addPanel(panelElement) {
    if (!this.container) {
      throw new Error("Sidebar needs to be attached to a container element.");
    }

    this.panelIdentifiers.push(panelElement.identifier);

    const sidebarContainer = this.container.querySelector(
      `.sidebar-container.${this.identifier}`
    );

    const panelContent = html.div(
      {
        "class": "sidebar-content",
        "data-sidebarName": panelElement.identifier,
      },
      [panelElement]
    );

    sidebarContainer.append(panelContent);

    const tabs = this.container.querySelector(
      `.tab-pane.${this.identifier} > .tab-pane-tabs`
    );

    tabs.appendChild(
      html.div(
        {
          "class": "tab-pane-tab",
          "data-sidebarName": panelElement.identifier,
          "data-tooltip": translate("sidebar." + panelElement.identifier),
          "data-tooltipposition": this.identifier === "right" ? "left" : "right",
        },
        [
          html.createDomElement("inline-svg", { src: panelElement.iconPath }),
          html.div({ class: "tab-pane-tab-label" }, [panelElement.tabLabel]),
        ]
      )
    );
  }

  toggle(tabName) {
    const container = document.querySelector(`.sidebar-container.${this.identifier}`);
    let toggledTab;
    for (const panelIdentifier of this.panelIdentifiers) {
      const tabElement = document.querySelector(
        `.tab-pane-tab[data-sidebar-name="${panelIdentifier}"]`
      );
      const contentElement = document.querySelector(
        `.sidebar-content[data-sidebar-name="${panelIdentifier}"]`
      );
      if (tabName === panelIdentifier) {
        toggledTab = tabElement;
        const isSelected = tabElement.classList.contains("selected");
        tabElement.classList.toggle("selected", !isSelected);
        container.classList.toggle("visible", !isSelected);
        if (isSelected) {
          container.addEventListener(
            "transitionend",
            () => contentElement.classList.remove("selected"),
            { once: true }
          );
        } else {
          contentElement.classList.add("selected");
        }
      } else {
        tabElement.classList.remove("selected");
        contentElement.classList.remove("selected");
      }
    }
    return toggledTab.classList.contains("selected");
  }

  attach(element) {
    this.container = element;
    this.initResizeGutter();
    this.initScrollbarReveal();

    if (localStorage.getItem(`fontra-selected-sidebar-${this.identifier}`)) {
      const container = document.querySelector(`.sidebar-container.${this.identifier}`);
      container.classList.add("visible");
    }
  }

  // A panel's scrolling column (shared.css's .card-column, inside the panel's
  // shadow root) shows its scrollbar only after the pointer has rested on the
  // scrollbar's strip, and hides it as soon as the pointer leaves the strip.
  initScrollbarReveal() {
    const container = this.container.querySelector(
      `.sidebar-container.${this.identifier}`
    );
    if (!container) {
      return;
    }
    let column;
    let timer;
    const hide = () => {
      clearTimeout(timer);
      column?.classList.remove("scrollbar-shown");
      column = undefined;
    };
    container.addEventListener("pointermove", (event) => {
      const target = event
        .composedPath()
        .find((element) => element.classList?.contains("card-column"));
      if (!target || !isOnScrollbarStrip(target, event.clientX)) {
        hide();
        return;
      }
      if (target !== column) {
        hide();
        column = target;
        timer = setTimeout(
          () => column.classList.add("scrollbar-shown"),
          SCROLLBAR_REVEAL_DELAY
        );
      }
    });
    container.addEventListener("pointerleave", hide);
  }

  applyWidth(width, saveLocalStorage = false) {
    if (width === undefined) {
      return;
    }
    if (saveLocalStorage) {
      localStorage.setItem(`fontra-sidebar-width-${this.identifier}`, width);
    }
    document.documentElement.style.setProperty(
      `--sidebar-content-width-${this.identifier}`,
      `${width}px`
    );
  }

  getStoredWidth() {
    const sidebarWidth = localStorage.getItem(
      `fontra-sidebar-width-${this.identifier}`
    );

    if (!sidebarWidth) {
      return;
    }

    return clamp(parseInt(sidebarWidth), MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
  }

  getDOMWidth() {
    return parseInt(
      getComputedStyle(document.documentElement)
        .getPropertyValue(`--sidebar-content-width-${this.identifier}`)
        .replace("px", "")
    );
  }

  initResizeGutter() {
    let initialWidth;
    let initialPointerCoordinateX;
    let sidebarResizing;
    let growDirection;
    let width;
    const onPointerMove = (event) => {
      if (sidebarResizing) {
        // The CSS custom property this drag writes to is always this
        // instance's own `--sidebar-content-width-${identifier}` -- reused
        // by views-kerning's three-column layout (kerning.js/kerning.css),
        // which needs identifiers other than the literal "left"/"right" this
        // file originally shipped with, to avoid colliding with the editor's
        // own sidebar width/visibility localStorage keys (getStoredWidth/
        // attach above already key those by `this.identifier`; this was the
        // one remaining place still hardcoding the two editor-only
        // identifiers instead of reading it generically). Behavior-preserving
        // for the editor's own "left"/"right" sidebars: growDirection still
        // only changes the SIGN of the drag delta, not which property is
        // written.
        let cssProperty = `--sidebar-content-width-${this.identifier}`;
        if (growDirection === "left") {
          width = initialWidth + (initialPointerCoordinateX - event.clientX);
        } else {
          width = initialWidth + (event.clientX - initialPointerCoordinateX);
        }
        width = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        document.documentElement.style.setProperty(cssProperty, `${width}px`);
      }
    };
    const onPointerUp = () => {
      this.applyWidth(width, true);
      sidebarResizing.classList.add("animating");
      sidebarResizing = undefined;
      initialWidth = undefined;
      growDirection = undefined;
      initialPointerCoordinateX = undefined;
      document.documentElement.classList.remove("sidebar-resizing");
      document.removeEventListener("pointermove", onPointerMove);
    };
    const gutter = document.querySelector(
      `.sidebar-container.${this.identifier} .sidebar-resize-gutter`
    );
    gutter.addEventListener("pointerdown", (event) => {
      sidebarResizing = gutter.parentElement;
      initialWidth = sidebarResizing.getBoundingClientRect().width;
      initialPointerCoordinateX = event.clientX;
      sidebarResizing.classList.remove("animating");
      growDirection = gutter.dataset.growDirection;
      document.documentElement.classList.add("sidebar-resizing");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp, { once: true });
    });
    const sidebarWidth = this.getStoredWidth();
    this.applyWidth(sidebarWidth);
  }
}

function isOnScrollbarStrip(element, clientX) {
  if (element.scrollHeight <= element.clientHeight) {
    return false;
  }
  const strip = Math.max(
    element.offsetWidth - element.clientWidth,
    SCROLLBAR_MIN_STRIP
  );
  return clientX >= element.getBoundingClientRect().right - strip;
}
