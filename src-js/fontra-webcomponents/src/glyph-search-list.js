import { GlyphOrganizer } from "@fontra/core/glyph-organizer.js";
import * as html from "@fontra/core/html-utils.js";
import { SimpleElement } from "@fontra/core/html-utils.js";
import {
  consolidateCalls,
  getCharFromCodePoint,
  glyphMapToItemList,
  guessCharFromGlyphName,
  makeUPlusStringFromCodePoint,
  throttleCalls,
} from "@fontra/core/utils.ts";
import { GlyphSearchField } from "./glyph-search-field.js";
import "./ui-handle.js";
import { UIList } from "./ui-list.js";

const MIN_LIST_HEIGHT = 60;

export class GlyphSearchList extends SimpleElement {
  static styles = `
    :host {
      display: grid;
      gap: 1em;
      grid-template-rows: auto 1fr;
      overflow: hidden;
      align-content: start;
    }

    /* Resizable: the table keeps its own height, set by the handle on its
       bottom edge (Figma 4098:10205), instead of filling the host. */
    :host([resizable]) {
      gap: 6px;
      grid-template-rows: auto auto;
    }

    :host([resizable]) ui-list {
      height: var(--glyph-search-list-height, 240px);
      padding-bottom: 8px;
    }

    .grip {
      height: 0;
      position: relative;
    }

    .grip > ui-handle {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
    }
  `;

  constructor() {
    super();

    this.glyphOrganizer = new GlyphOrganizer();

    this.searchField = new GlyphSearchField();
    this.glyphNamesList = this._makeGlyphNamesList();

    this.throttledUpdate = throttleCalls(() => this.update(), 50);
    this.requestUpdate = consolidateCalls(() => this.updateGlyphNamesListContent());

    this.searchField.onSearchFieldChanged = (event) => this.throttledUpdate();

    this.shadowRoot.appendChild(this.searchField);
    this.shadowRoot.appendChild(this.glyphNamesList);
  }

  _makeGlyphNamesList() {
    const columnDescriptions = [
      {
        key: "char",
        title: "symbol",
        width: "72px",
        cellFactory: (item, description) => {
          if (item.codePoints[0]) {
            return getCharFromCodePoint(item.codePoints[0]);
          }
          const guessedChar = guessCharFromGlyphName(item.glyphName);
          return guessedChar ? html.span({ class: "dimmed" }, [guessedChar]) : "";
        },
      },
      {
        key: "glyphName",
        title: "name",
        width: "72px",
        isIdentifierKey: true,
        get: (item) => item.glyphName,
        cellFactory: (item, description) => this._cellFactory(item, description),
      },
      {
        key: "unicode",
        width: "fit-content",
        get: (item) => item.codePoints.map(makeUPlusStringFromCodePoint).join(","),
        cellFactory: (item, description) => this._cellFactory(item, description),
      },
    ];
    const glyphNamesList = new UIList();
    // table, look "select" (Figma 4098:10206).
    glyphNamesList.setAttribute("look", "select");
    glyphNamesList.appendStyle(`
      .dimmed {
        color: #999;
      }
    `);
    glyphNamesList.columnDescriptions = columnDescriptions;

    glyphNamesList.addEventListener("listSelectionChanged", () => {
      const event = new CustomEvent("selectedGlyphNameChanged", {
        bubbles: false,
        detail: this.getSelectedGlyphName(),
      });
      this.dispatchEvent(event);
    });

    glyphNamesList.addEventListener("rowDoubleClicked", () => {
      const event = new CustomEvent("selectedGlyphNameDoubleClicked", {
        bubbles: false,
        detail: this.getSelectedGlyphName(),
      });
      this.dispatchEvent(event);
    });
    return glyphNamesList;
  }

  _cellFactory(item, description) {
    const glyphName = item.glyphName;
    const valueString = description.get(item);
    return !this._fontGlyphMap || this._fontGlyphMap[glyphName]
      ? valueString
      : html.span({ class: "dimmed" }, [valueString]);
  }

  focusSearchField() {
    this.searchField.focusSearchField();
  }

  // The table takes a fixed height with a handle under it; the height is kept
  // under `storageKey`.
  makeResizable(storageKey) {
    this.setAttribute("resizable", "");
    const applyHeight = (height) =>
      this.style.setProperty("--glyph-search-list-height", `${height}px`);
    try {
      const stored = parseInt(localStorage.getItem(storageKey));
      if (Number.isFinite(stored)) {
        applyHeight(Math.max(MIN_LIST_HEIGHT, stored));
      }
    } catch {
      // The default height applies.
    }
    let startHeight, height;
    const handle = html.createDomElement("ui-handle");
    handle.addEventListener("handle-drag-start", () => {
      startHeight = this.glyphNamesList.getBoundingClientRect().height;
    });
    handle.addEventListener("handle-drag", (event) => {
      height = Math.max(MIN_LIST_HEIGHT, startHeight + event.detail.dy);
      applyHeight(height);
    });
    handle.addEventListener("handle-drag-end", () => {
      if (height === undefined) {
        return;
      }
      try {
        localStorage.setItem(storageKey, height);
      } catch {
        // The height still applies for this page.
      }
    });
    this.shadowRoot.appendChild(html.div({ class: "grip" }, [handle]));
  }

  update() {
    this.requestUpdate();
  }

  get glyphMap() {
    return this._glyphMap;
  }

  set glyphMap(glyphMap) {
    this._glyphMap = glyphMap;
    this.requestUpdate();
  }

  get fontGlyphMap() {
    return this._fontGlyphMap;
  }

  set fontGlyphMap(fontGlyphMap) {
    this._fontGlyphMap = fontGlyphMap;
    this.requestUpdate();
  }

  get allowUnknownGlyphSearchResults() {
    return this._allowUnknownGlyphSearchResults ?? false;
  }

  set allowUnknownGlyphSearchResults(allowUnknownGlyphSearchResults) {
    this._allowUnknownGlyphSearchResults = allowUnknownGlyphSearchResults;
    this.requestUpdate();
  }

  updateGlyphNamesListContent() {
    this.glyphOrganizer.setSearchString(this.searchField.searchString);
    this.glyphsListItems = this.glyphOrganizer.sortGlyphs(
      glyphMapToItemList(this.glyphMap)
    );
    this._setFilteredGlyphNamesListContent();
  }

  _setFilteredGlyphNamesListContent() {
    const filteredGlyphItems = this.glyphOrganizer.filterGlyphs(
      this.glyphsListItems,
      this.allowUnknownGlyphSearchResults
    );
    this.glyphNamesList.setItems(filteredGlyphItems);
    this.glyphNamesList.hidden = filteredGlyphItems.length === 0;
  }

  getSelectedGlyphName() {
    return this.glyphNamesList.items[this.glyphNamesList.selectedItemIndex]?.glyphName;
  }

  setSelectedGlyphName(glyphName, shouldDispatchEvent = false) {
    const index = this.glyphNamesList.items.findIndex(
      (item) => item.glyphName === glyphName
    );
    this.glyphNamesList.setSelectedItemIndex(
      index >= 0 ? index : undefined,
      shouldDispatchEvent
    );
  }

  getFilteredGlyphNames() {
    return this.glyphNamesList.items.map((item) => item.glyphName);
  }
}

customElements.define("glyph-search-list", GlyphSearchList);
