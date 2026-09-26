import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import "./compact-scrub-field.js";
import "./link-button.js";

// The paired scrub input from the Figma design (_external/component-code/
// scrub/scrub input.txt): two compact-scrub-fields with a ui-link-button
// between them. With the link on, editing the left side mirrors into the
// right, and the right field is disabled (per the design's screenshot); with
// the link "n/a" there is no button at all and the two fields stand alone.
//
// Events a consumer sees:
//   "values-changed" -- {leftValue, rightValue, linked, side}, on every
//     committed change of either field (every frame of a scrub included).
//   "link-changed" -- {state, linked}, re-dispatched from the button.
//   "change" -- re-dispatched from the inner field with `side` added to the
//     detail, so the composite can stand in for a single field.
//   "scrubstart" -- re-dispatched with `side` added; the valueStream is the
//     inner field's own, so one drag remains one undo step for the consumer.
//   "apply" -- re-dispatched with `side` added.
const LINK_STATES = new Set(["on", "off", "n/a"]);

export class InputScrub extends UnlitElement {
  static styles = `
    :host {
      display: inline-block;
    }

    .ui-input-scrub {
      display: flex;
      width: 100%;
      height: 100%;
      align-items: center;
    }

    .ui-input-scrub.link-na {
      gap: 0.5em;
    }

    compact-scrub-field {
      flex: 1 1 auto;
      min-width: 0;
    }

    /* The ref composite sizes the button explicitly (0.5em x 1.5em between
       ~1.75em-tall fields): centred, its gray edges merge with the fields'
       outer shells, the notches aligning with the inner boxes' inset. */
    ui-link-button {
      width: 0.5em;
      height: 24px;
      flex: 0 0 0.5em;
    }
  `;

  constructor() {
    super();
    this._link = "on";
    this._leftLabel = "";
    this._rightLabel = "";
    this._leftValue = 0;
    this._rightValue = 0;
    this._min = undefined;
    this._max = undefined;
    this._step = undefined;
    this._integer = false;
    this._icon = undefined;
    this._iconTooltip = "";
    this._disabled = false;
    this._linkTooltip = "";

    // The fields are built once here, not per render: they keep their focus
    // and their listeners across re-renders, and a consumer can hold them
    // (leftField/rightField) before the element is ever attached.
    this._leftField = this._makeField("left");
    this._rightField = this._makeField("right");
    this._syncFields();
  }

  // The inner compact-scrub-fields, for a consumer that needs a plain field's
  // API (writing .value on an undo restore, say). Events still come from the
  // composite.
  get leftField() {
    return this._leftField;
  }

  get rightField() {
    return this._rightField;
  }

  get link() {
    return this._link;
  }

  set link(value) {
    this._link = LINK_STATES.has(value) ? value : "on";
    this._applyDisabled();
    this.requestUpdate();
  }

  get leftLabel() {
    return this._leftLabel;
  }

  set leftLabel(value) {
    this._leftLabel = value || "";
    this._leftField.label = this._leftLabel;
  }

  get rightLabel() {
    return this._rightLabel;
  }

  set rightLabel(value) {
    this._rightLabel = value || "";
    this._rightField.label = this._rightLabel;
  }

  get leftValue() {
    return this._leftValue;
  }

  set leftValue(value) {
    this._leftValue = value;
    this._leftField.value = value;
  }

  get rightValue() {
    return this._rightValue;
  }

  set rightValue(value) {
    this._rightValue = value;
    this._rightField.value = value;
  }

  get min() {
    return this._min;
  }

  set min(value) {
    this._min = value;
    this._syncFields();
  }

  get max() {
    return this._max;
  }

  set max(value) {
    this._max = value;
    this._syncFields();
  }

  get step() {
    return this._step;
  }

  set step(value) {
    this._step = value;
    this._syncFields();
  }

  get integer() {
    return this._integer;
  }

  set integer(value) {
    this._integer = !!value;
    this._syncFields();
  }

  // One icon for both fields (the row's icon, decorative only, per
  // compact-scrub-field.js).
  get icon() {
    return this._icon;
  }

  set icon(value) {
    this._icon = value || undefined;
    this._syncFields();
  }

  get iconTooltip() {
    return this._iconTooltip;
  }

  set iconTooltip(value) {
    this._iconTooltip = value || "";
    this._syncFields();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this._applyDisabled();
    this.requestUpdate();
  }

  // The link button's tooltip (localized by the caller); empty leaves the
  // button's own default titles.
  get linkTooltip() {
    return this._linkTooltip;
  }

  set linkTooltip(value) {
    this._linkTooltip = value || "";
    this.requestUpdate();
  }

  _linked() {
    return this._link === "on";
  }

  _syncFields() {
    for (const [field, label, value] of [
      [this._leftField, this._leftLabel, this._leftValue],
      [this._rightField, this._rightLabel, this._rightValue],
    ]) {
      field.label = label;
      field.value = value;
      field.minValue = this._min;
      field.maxValue = this._max;
      field.step = this._step;
      field.integer = this._integer;
      field.icon = this._icon;
      field.iconTooltip = this._iconTooltip;
    }
  }

  _applyDisabled() {
    this._leftField.disabled = this._disabled;
    this._rightField.disabled = this._disabled || this._linked();
  }

  render() {
    const link = this._link;

    const children = [this._leftField];

    if (link !== "n/a") {
      const linkButton = html.createDomElement("ui-link-button");
      linkButton.state = link;
      linkButton.disabled = this._disabled;
      linkButton.tooltip = this._linkTooltip;
      linkButton.addEventListener("link-changed", (event) => {
        this._handleLinkChanged(event);
      });
      children.push(linkButton);
    }

    children.push(this._rightField);

    return html.div(
      { class: `ui-input-scrub link-${link === "n/a" ? "na" : link}` },
      children
    );
  }

  _makeField(side) {
    const field = html.createDomElement("compact-scrub-field");

    field.addEventListener("change", (event) => this._handleFieldChange(side, event));
    field.addEventListener("scrubstart", (event) => {
      this.dispatchEvent(
        new CustomEvent("scrubstart", {
          detail: { ...event.detail, side },
        })
      );
    });
    field.addEventListener("apply", () => {
      this.dispatchEvent(new CustomEvent("apply", { detail: { side } }));
    });

    return field;
  }

  _handleLinkChanged(event) {
    this._link = event.detail.state;
    // Relinking mirrors the editable (left) side across, so the pair starts
    // linked with one agreed value.
    if (this._linked()) {
      this.rightValue = this._leftValue;
    }
    this._applyDisabled();

    this.dispatchEvent(
      new CustomEvent("link-changed", {
        bubbles: true,
        composed: true,
        detail: {
          state: this._link,
          linked: this._linked(),
        },
      })
    );
  }

  _handleFieldChange(side, event) {
    const value = event.detail.value;

    if (side === "left") {
      this._leftValue = value;
      if (this._linked()) {
        this.rightValue = value;
      }
    } else {
      this._rightValue = value;
      if (this._linked()) {
        this.leftValue = value;
      }
    }

    this.dispatchEvent(
      new CustomEvent("values-changed", {
        bubbles: true,
        composed: true,
        detail: {
          leftValue: this._leftValue,
          rightValue: this._rightValue,
          linked: this._linked(),
          side,
        },
      })
    );
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { ...event.detail, side },
      })
    );
  }
}

customElements.define("ui-input-scrub", InputScrub);
