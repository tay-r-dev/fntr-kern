import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// The link button from the Figma scrub-input design
// (_external/component-code/scrub/link buttonm.txt): a narrow strip between
// two fields. "on" draws as a bracket/tab merged into the fields on either
// side; "off" draws as three dots. Clicking toggles it and sends
// "link-changed" with detail {state, linked}. Unlike chain-link (an icon
// button), this one is purely CSS-drawn per the design.
//
// `state` is "on" or "off" (`linked` mirrors it as a boolean); both are
// plain JS properties, the convention every UnlitElement component in this
// tree uses.
const colors = {
  "link-button-background-color": ["#f5f5f5", "#3a3a3a"],
  "link-button-tab-color": ["#fff", "#222222"],
  "link-button-dot-color": ["#dedede", "#5a5a5a"],
  "link-button-dot-hover-color": ["#d6d6d6", "#707070"],
};

export class LinkButton extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: inline-block;
      width: 0.5em;
      height: 1.5em;
    }

    .ui-link-button {
      position: relative;
      box-sizing: border-box;
      display: flex;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .ui-link-button.state-on {
      background: var(--link-button-background-color);
    }

    .ui-link-button.state-on::before,
    .ui-link-button.state-on::after {
      position: absolute;
      left: 0;
      width: 0;
      height: 0;
      border-right: 0.25em solid transparent;
      border-left: 0.25em solid transparent;
      content: "";
      transition: 120ms;
    }

    .ui-link-button.state-on::before {
      top: 0;
      border-top: 0.5em solid var(--link-button-tab-color);
    }

    .ui-link-button.state-on::after {
      bottom: 0;
      border-bottom: 0.5em solid var(--link-button-tab-color);
    }

    .ui-link-button.state-on:hover::before {
      border-top-width: 0.65625em;
    }

    .ui-link-button.state-on:hover::after {
      border-bottom-width: 0.65625em;
    }

    .ui-link-button-dots {
      display: flex;
      flex-direction: column;
      gap: 0.09375em;
      align-items: center;
    }

    .ui-link-button-dot {
      width: 0.21875em;
      height: 0.21875em;
      border-radius: 50%;
      background: var(--link-button-dot-color);
      transition: 120ms;
    }

    .ui-link-button.state-off:hover .ui-link-button-dots {
      gap: 0.025em;
    }

    .ui-link-button.state-off:hover .ui-link-button-dot {
      width: 0.28125em;
      height: 0.28125em;
      background: var(--link-button-dot-hover-color);
    }

    .ui-link-button:disabled {
      cursor: default;
      opacity: 0.3;
    }
  `;

  constructor() {
    super();
    this._state = "on";
    this._disabled = false;
  }

  get state() {
    return this._state;
  }

  set state(value) {
    this._state = value === "off" ? "off" : "on";
    this.requestUpdate();
  }

  get linked() {
    return this._state === "on";
  }

  set linked(value) {
    this.state = value ? "on" : "off";
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.requestUpdate();
  }

  render() {
    const state = this._state;

    return html.createDomElement(
      "button",
      {
        "class": `ui-link-button state-${state}`,
        "type": "button",
        "disabled": this._disabled,
        "title": state === "on" ? "Unlink values" : "Link values",
        "aria-label": state === "on" ? "Unlink values" : "Link values",
        "aria-pressed": state === "on",
        "onclick": () => this._toggle(),
      },
      state === "off"
        ? [
            html.div({ class: "ui-link-button-dots" }, [
              html.div({ class: "ui-link-button-dot" }),
              html.div({ class: "ui-link-button-dot" }),
              html.div({ class: "ui-link-button-dot" }),
            ]),
          ]
        : []
    );
  }

  _toggle() {
    if (this._disabled) {
      return;
    }

    this._state = this._state === "off" ? "on" : "off";
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent("link-changed", {
        bubbles: true,
        composed: true,
        detail: {
          state: this._state,
          linked: this._state === "on",
        },
      })
    );
  }
}

customElements.define("ui-link-button", LinkButton);
