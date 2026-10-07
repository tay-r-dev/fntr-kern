import * as html from "@fontra/core/html-utils.js";
import { SimpleElement } from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import "./ui-text-input.js";

// The glyph search field: input/text (ui-text-input) with the search hint.
export class GlyphSearchField extends SimpleElement {
  static styles = `
    :host {
      display: block;
    }
  `;

  constructor(options) {
    super();
    this.searchField = html.createDomElement("ui-text-input", {
      placeholder: translate("sidebar.glyphs.search"),
      oninput: (event) => this._searchFieldChanged(event),
    });

    if (options?.settingsController) {
      this._settingsController = options.settingsController;
      this._searchStringKey = options.searchStringKey || "searchString";
      this._settingsController.addKeyListener(this._searchStringKey, (event) => {
        this.searchField.value = event.newValue;
      });
      this.searchField.value = this._settingsController.model.searchString;
    }

    this.shadowRoot.appendChild(this.searchField);
  }

  get searchString() {
    return this.searchField.value;
  }

  focusSearchField() {
    this.searchField.focus();
  }

  _searchFieldChanged(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const value = event.target.value;

    if (this._settingsController) {
      this._settingsController.model[this._searchStringKey] = value;
    }

    this.onSearchFieldChanged?.(event);
  }
}

customElements.define("glyph-search-field", GlyphSearchField);
