import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./link-button.js";

// Ticket 45 (UI-REFACTOR.md §5.8, UI-NOMENCLATURE.md §14): the chain -- the
// link between a left field and a right field, drawn as the design's link
// strip (link-button.js) between them, as in ui-input-scrub. Closed says the two are typed as one; open says each is typed
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
    /* The strip's size in ui-input-scrub: as wide as the fields' gap, as
       tall as a field. */
    :host {
      display: inline-flex;
      align-items: center;
      flex: 0 0 8px;
      width: 8px;
      height: 24px;
    }

    ui-link-button {
      width: 100%;
      height: 100%;
    }

    ui-link-button.mixed {
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
    const button = html.createDomElement("ui-link-button", {
      class: this._linked == null ? "mixed" : "",
    });
    button.state = this._linked === true ? "on" : "off";
    button.disabled = this._disabled;
    button.tooltip = this._tooltip;
    button.addEventListener("link-changed", (event) => {
      // The chain speaks for itself with "change"; the strip's own event
      // stays inside.
      event.stopPropagation();
      // Mixed closes, so one click states the same thing about every member.
      this._linked = this._linked !== true;
      this.requestUpdate();
      this.dispatchEvent(
        new CustomEvent("change", { detail: { linked: this._linked } })
      );
    });
    return button;
  }
}

// Two fields with a chain between them, laid out as ui-input-scrub lays out
// its pair: the fields touch the strip, and each field's focus line draws on
// its outer edge only.
export function linkedPair(left, chain, right) {
  left.setAttribute("side", "left");
  right.setAttribute("side", "right");
  return html.div({ class: "linked-pair" }, [left, chain, right]);
}

customElements.define("chain-link", ChainLink);
