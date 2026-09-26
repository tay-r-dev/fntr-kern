import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// The link button from the Figma scrub-input design
// (_external/component-code/scrub/link buttonm.txt): a narrow strip between
// two fields. "on" draws as a gray strip with a subtle horizontal gradient
// (darker toward the middle; faint at rest, full strength on hover), and two
// field-background-colored notches bite into it from top and bottom, their
// facing ends pill-rounded; on hover the notches grow toward each other
// (120ms), shrinking the gray waist. "off" draws as three dots. Clicking
// toggles it and sends "link-changed" with detail {state, linked}. Unlike
// chain-link (an icon button), this one is purely CSS-drawn.
//
// `state` is "on" or "off" (`linked` mirrors it as a boolean); both are
// plain JS properties, the convention every UnlitElement component in this
// tree uses.
const colors = {
  // The strip keeps the fields' outer-shell gray, so it merges with them.
  "link-button-background-color": ["#f5f5f5", "#3a3a3a"],
  // The notches match the fields' inner background (white / its dark
  // counterpart), so they read as cutouts from the strip.
  "link-button-notch-color": ["#ffffff", "#2c2c2c"],
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
      /* A <button> gets the UA font, not the host's -- but every internal
         size (the triangle borders whose base must equal the strip width,
         the dots) is in ems. Inherit so the notch geometry matches the
         0.5em x 1.5em host strip exactly. */
      font: inherit;
    }

    .ui-link-button.state-on {
      background: var(--link-button-background-color);
    }

    /* "on": a horizontal gradient darkens the strip toward its middle
       (faint at rest, full strength on hover). Two notches in the field
       background color bite in from the top and bottom, their facing ends
       pill-rounded; on hover they grow toward each other, shrinking the gray
       waist (0.5em -> 0.65625em each) in the ref's 120ms. */
    .ui-link-button.state-on::before {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.04),
        rgba(0, 0, 0, 0.086) 32%,
        rgba(0, 0, 0, 0.086) 68%,
        rgba(0, 0, 0, 0.04)
      );
      content: "";
      opacity: 0.3;
      pointer-events: none;
      transition: 120ms;
    }

    .ui-link-button.state-on:hover::before {
      opacity: 1;
    }

    .ui-link-button-notch {
      position: absolute;
      left: 0;
      z-index: 1;
      width: 100%;
      height: 0.5em;
      background: var(--link-button-notch-color);
      transition: 120ms;
    }

    .ui-link-button-notch.top {
      top: 0;
      border-radius: 0 0 0.25em 0.25em;
    }

    .ui-link-button-notch.bottom {
      bottom: 0;
      border-radius: 0.25em 0.25em 0 0;
    }

    .ui-link-button.state-on:hover .ui-link-button-notch {
      /* Past half the strip each: the pill ends overlap on hover, so the
         rounded corners of one are hidden behind the other. */
      height: 0.875em;
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
    this._tooltip = "";
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

  // Overrides the default "Link values"/"Unlink values" titles, so a caller
  // can pass a localized tooltip.
  get tooltip() {
    return this._tooltip;
  }

  set tooltip(value) {
    this._tooltip = value || "";
    this.requestUpdate();
  }

  render() {
    const state = this._state;
    const tooltip = this._tooltip || (state === "on" ? "Unlink values" : "Link values");

    return html.createDomElement(
      "button",
      {
        "class": `ui-link-button state-${state}`,
        "type": "button",
        "disabled": this._disabled,
        "title": tooltip,
        "aria-label": tooltip,
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
        : [
            html.div({ class: "ui-link-button-notch top" }),
            html.div({ class: "ui-link-button-notch bottom" }),
          ]
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
