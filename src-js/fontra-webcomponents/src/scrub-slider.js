import * as html from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";
import { CompactScrubField } from "./compact-scrub-field.js";

// The scrub slider (Figma "input/slider", node 323:2410): a compact scrub
// field whose inner box fills from the left in proportion to the value's
// position between minValue and maxValue. The fill is grey/solid/7 at rest,
// on hover and in manual input, and turns the lime accent while scrubbing.
// There is no drag-arrows icon -- the fill itself reads as the control -- and
// the up/down steppers are the same always-present hover pair the compact
// field has, built once and serving every state.
//
// The scrub, edit and event machinery ("change", "apply", "scrubstart") is
// compact-scrub-field.js's; this class only re-draws the box.
const colors = {
  "scrub-slider-background-color": ["#f5f5f5", "#3a3a3a"],
  "scrub-slider-hover-background-color": ["#f7f7f7", "#464646"],
  "scrub-slider-hover-border-color": [
    "rgba(0, 0, 0, 0.08)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "scrub-slider-active-background-color": ["#fff", "#2c2c2c"],
  "scrub-slider-active-border-color": ["#def280", "#8fae4a"],
  "scrub-slider-text-color": ["#8e8e8e", "#b0b0b0"],
  "scrub-slider-value-rest-text-color": ["#565656", "#b0b0b0"],
  "scrub-slider-hover-text-color": ["#303030", "#e0e0e0"],
  "scrub-slider-active-text-color": ["#151515", "#f0f0f0"],
  "scrub-slider-fill-color": ["#e9e9e9", "#4a4a4a"],
  "scrub-slider-fill-active-color": ["#d5ed57", "#5c7033"],
  "scrub-slider-handle-color": ["#b4b4b4", "#777777"],
  "scrub-slider-selection-color": ["#d5ed57", "#5c7033"],
  "scrub-slider-stepper-color": ["#d9d9d9", "#666666"],
  "scrub-slider-stepper-active-color": ["#303030", "#dddddd"],
};

export class ScrubSlider extends CompactScrubField {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
    }

    .box {
      background-color: var(--scrub-slider-background-color);
      border-radius: 0.375em;
      box-sizing: border-box;
      height: 24px;
      padding: 3px;
      color: var(--scrub-slider-text-color);
      cursor: ew-resize;
      user-select: none;
      touch-action: none;
      /* ui/label/XS */
      font: var(--ui-text-label-s);
      letter-spacing: var(--ui-tracking);
    }

    /* The fill lives inside .inner, clipped by its radius, under the text. */
    .inner {
      position: relative;
      display: flex;
      align-items: center;
      border: 1px solid transparent;
      border-radius: 0.25em;
      box-sizing: border-box;
      height: 100%;
      padding: 0 0.4em;
      overflow: hidden;
    }

    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0;
      background-color: var(--scrub-slider-fill-color);
    }

    /* The fill is positioned, so it paints above plain content; everything it
       can cover takes a position of its own to paint above it again, and so
       keep its pointer events at a full-width fill. */
    .name,
    .value,
    .hover-steppers,
    .scrub-icon {
      position: relative;
    }

    .scrub-icon {
      flex: 0 0 auto;
      width: 0.9em;
      height: 0.9em;
      color: var(--scrub-slider-handle-color);
    }

    .box.scrubbing .fill {
      background-color: var(--scrub-slider-fill-active-color);
    }

    .box:hover:not(.disabled):not(.editing):not(.scrubbing) .inner {
      background-color: var(--scrub-slider-hover-background-color);
      border-color: var(--scrub-slider-hover-border-color);
      color: var(--scrub-slider-hover-text-color);
    }

    .box.scrubbing .inner,
    .box.editing .inner,
    .box:focus-within .inner {
      background-color: var(--scrub-slider-active-background-color);
      border-color: var(--scrub-slider-active-border-color);
      color: var(--scrub-slider-active-text-color);
    }

    /* The fill keeps its own color under the active white background; the
       rule above paints .inner, the fill sits over it. */
    .box.scrubbing .inner .fill,
    .box.editing .inner .fill,
    .box:focus-within .inner .fill {
      background-color: var(--scrub-slider-fill-color);
    }

    .box.scrubbing .inner .fill {
      background-color: var(--scrub-slider-fill-active-color);
    }

    .box.disabled {
      opacity: 0.7;
      cursor: default;
    }

    .name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .value {
      flex: 0 0 auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      min-width: 2.2em;
      min-height: 1.2em;
      cursor: text;
      text-align: center;
    }

    .value.mixed {
      font-family: inherit;
      font-style: italic;
      opacity: 0.6;
    }

    .box:not(:hover):not(.scrubbing):not(.editing):not(.disabled) .value {
      color: var(--scrub-slider-value-rest-text-color);
    }

    .value input {
      width: 4em;
      text-align: center;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      padding: 0;
      outline: none;
      appearance: textfield;
      -moz-appearance: textfield;
    }

    .value input::-webkit-inner-spin-button,
    .value input::-webkit-outer-spin-button {
      appearance: none;
      -webkit-appearance: none;
      margin: 0;
    }

    .value input::selection {
      background: var(--scrub-slider-selection-color);
      color: #151515;
    }

    /* The up/down stepper pair, built once: invisible at rest, revealed by a
       hover, a drag or the keyboard focus of an edit in progress -- the same
       reveal the compact field uses. */
    .hover-steppers {
      display: flex;
      flex-direction: column;
      align-self: stretch;
      justify-content: center;
      margin-left: 0.15em;
      opacity: 0;
    }

    .box:hover:not(.disabled) .hover-steppers,
    .box.scrubbing .hover-steppers,
    .box:focus-within .hover-steppers {
      opacity: 1;
    }

    .stepper {
      display: grid;
      place-items: center;
      width: 0.9em;
      height: 0.6em;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--scrub-slider-stepper-color);
      cursor: pointer;
    }

    .stepper:hover {
      color: var(--scrub-slider-stepper-active-color);
    }

    .stepper::before {
      width: 0;
      height: 0;
      border-right: 0.2em solid transparent;
      border-left: 0.2em solid transparent;
      content: "";
    }

    .stepper.up::before {
      border-bottom: 0.2em solid currentColor;
    }

    .stepper.down::before {
      border-top: 0.2em solid currentColor;
    }
  `;

  // The value's position between minValue and maxValue as a 0..1 fraction.
  // Without bounds the slider reads as a plain number field, with no fill.
  _fillFraction() {
    const min = this._minValue ?? 0;
    const max = this._maxValue ?? 100;
    if (!Number.isFinite(this._value) || !(max > min)) {
      return 0;
    }
    return Math.min(Math.max((this._value - min) / (max - min), 0), 1);
  }

  _renderValue() {
    super._renderValue();
    if (this._fillElement) {
      this._fillElement.style.width = `${this._fillFraction() * 100}%`;
    }
  }

  render() {
    this._nameElement = html.span({ class: "name" }, [this._label]);
    this._valueElement = html.span(
      {
        class: "value" + (this._showsMixed() ? " mixed" : ""),
        onclick: () => this._startEdit(),
      },
      [this._showsMixed() ? "mixed" : this._displayValue()]
    );
    this._fillElement = html.div({ class: "fill" });
    this._fillElement.style.width = `${this._fillFraction() * 100}%`;
    // The same always-present hover steppers the compact field builds; the
    // parent's pointer handler tests for them so its drag ignores their area.
    this._hoverSteppers = html.div({ class: "hover-steppers" }, [
      this._makeStepperButton(1, "Increase"),
      this._makeStepperButton(-1, "Decrease"),
    ]);

    this._box = html.div(
      {
        class: "box" + (this._disabled ? " disabled" : ""),
        onpointerdown: (event) => this._onPointerDown(event),
        ondblclick: (event) => {
          if (
            !this._valueElement.contains(event.target) &&
            !this._hoverSteppers.contains(event.target)
          ) {
            this._resetToDefault();
          }
        },
      },
      [
        html.div({ class: "inner" }, [
          this._fillElement,
          this._nameElement,
          ...(this._scrubIcon
            ? [
                html.createDomElement("inline-svg", {
                  class: "scrub-icon",
                  src: "/tabler-icons/arrows-horizontal.svg",
                }),
              ]
            : []),
          this._valueElement,
          this._hoverSteppers,
        ]),
      ]
    );
    return this._box;
  }
}

customElements.define("scrub-slider", ScrubSlider);
