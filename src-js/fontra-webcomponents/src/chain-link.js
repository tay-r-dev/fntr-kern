import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./icon-button.js";

// Ticket 45 (UI-REFACTOR.md §5.8, UI-NOMENCLATURE.md §14): the chain -- the
// link between a left field and a right field, drawn as a small icon button
// between them. Closed says the two are typed as one; open says each is typed
// on its own. It stores nothing and knows nothing about widths, corners or
// serifs: the caller reads `linked`, writes its own flag on "change", and
// greys its own right field. Tickets 46, 57 and 61 reuse it.
//
// `linked` is true, false, or null for a selection whose members disagree.
// A mixed chain draws open and dimmed, and a click on it closes it, which is
// the one answer that states something about every member.
//
// `linked`, `disabled` and `tooltip` are plain JS properties, not HTML
// attributes, the convention every UnlitElement component in this tree uses.
export class ChainLink extends UnlitElement {
  static styles = `
    :host {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
    }

    icon-button {
      width: 1.2em;
      height: 1.2em;
    }

    icon-button.mixed {
      opacity: 0.45;
    }
  `;

  constructor() {
    super();
    this._linked = true;
    this._disabled = false;
    this._tooltip = "";
  }

  get linked() {
    return this._linked;
  }

  set linked(value) {
    this._linked = value == null ? null : !!value;
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.requestUpdate();
  }

  get tooltip() {
    return this._tooltip;
  }

  set tooltip(value) {
    this._tooltip = value || "";
    this.requestUpdate();
  }

  render() {
    const closed = this._linked === true;
    const button = html.createDomElement("icon-button", {
      "class": this._linked == null ? "mixed" : "",
      "src": closed ? "/tabler-icons/link.svg" : "/tabler-icons/unlink.svg",
      "data-tooltip": this._tooltip,
      "data-tooltipposition": "top",
    });
    button.disabled = this._disabled;
    button.onclick = () => {
      if (this._disabled) {
        return;
      }
      // Mixed closes, so one click states the same thing about every member.
      this._linked = this._linked !== true;
      this.requestUpdate();
      this.dispatchEvent(
        new CustomEvent("change", { detail: { linked: this._linked } })
      );
    };
    return button;
  }
}

customElements.define("chain-link", ChainLink);
