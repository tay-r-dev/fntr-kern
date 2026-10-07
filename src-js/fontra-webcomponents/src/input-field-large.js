import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import {
  SCRUB_CANCELLED,
  SCRUB_THRESHOLD,
  clampScrubValue,
  isScrubCancelled,
  keyStepScrubValue,
  roundScrubValue,
  scrubIncrement,
} from "@fontra/core/number-scrub.js";
import { QueueIterator } from "@fontra/core/queue-iterator.js";
import { InlineSVG } from "./inline-svg.js";
import { EdgeScrub } from "./edge-scrub.js";
import { themeColorCSS } from "./theme-support.js";

// The large input field (Figma input/field: basic 2004:29576, scrub
// 2004:29534, slider 2004:29608): one box holding its own name and its value.
// `type` picks what the box does:
//
// - "scrub" (the default): a scrub icon after the name; dragging anywhere but
//   the value scrubs it, clicking the value types it;
// - "number": a plain numeric field -- no icon, no drag, a press types;
// - "text": as "number", but the typing is sent as typed text (a metrics key
//   such as "=H+10"), for the caller to evaluate;
// - "slider": a bar behind the name showing where the value sits between
//   minValue and maxValue; dragging moves it, as "scrub" does.
//
// `scrubOnly` keeps a dragging type from being typed in. A double-click on the
// scrub area puts back `defaultValue`, as a typed value would; a field with no
// default ignores it. An element with slot="end" sits after the value, for one
// icon.
//
// The arithmetic and the cancel sentinel are number-scrub.js's, the same
// ones ui-form.js's own label-drag scrub uses.
// input/field/basic and ./scrub-field (Figma 2004:29576, 2004:29534): a grey
// tray ruled on top holding the box the label and value sit in. The box is
// invisible at rest, ruled on hover, and white with the lime line while
// scrubbing or typing -- the tray then lightens and takes side lines too.
// Light colours are the design system's tokens (core.css); dark ones stay
// hand-picked until the design has a dark mode.
const colors = {
  "input-field-large-background-color": ["var(--in-bsr-rest)", "#3a3a3a"],
  "input-field-large-border-color": ["var(--in-bln-rest)", "#4a4a4a"],
  "input-field-large-tray-active-color": ["var(--in-bsr-focus)", "#333"],
  "input-field-large-tray-active-border-color": ["var(--in-bln-focus)", "#4a4a4a"],
  "input-field-large-tray-disabled-color": ["var(--in-bsr-disabled)", "#3a3a3a"],
  "input-field-large-tray-disabled-border-color": ["var(--in-bln-disabled)", "#444"],
  "input-field-large-hover-background-color": ["var(--in-csr-hover)", "#464646"],
  "input-field-large-hover-border-color": [
    "var(--in-sln-hover)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "input-field-large-active-background-color": ["var(--in-csr-focus)", "#2c2c2c"],
  "input-field-large-active-border-color": ["var(--in-sln-focus)", "#8fae4a"],
  // The label: grey at rest, dark on hover and while active.
  "input-field-large-text-color": ["var(--in-lbl-rest)", "#b0b0b0"],
  "input-field-large-hover-text-color": ["var(--in-lbl-hover)", "#e0e0e0"],
  "input-field-large-disabled-text-color": ["var(--in-lbl-disabled)", "#666"],
  // The value: darker than the label at rest, near-black while active.
  "input-field-large-value-rest-text-color": ["var(--in-vl-rest)", "#b0b0b0"],
  "input-field-large-active-text-color": ["var(--in-vl-focus)", "#f0f0f0"],
  "input-field-large-value-disabled-text-color": ["var(--in-vl-disabled)", "#666"],
  // The scrub (drag-arrows) icon.
  "input-field-large-handle-color": ["var(--in-ic-rest)", "#777777"],
  "input-field-large-handle-active-color": ["var(--in-ic-focus)", "#999999"],
  "input-field-large-handle-disabled-color": ["var(--in-ic-disabled)", "#555555"],
  // input/field/slider (Figma 2004:29608): the value's share of the range as
  // a bar -- grey at rest (a Figma literal), lime while active.
  "input-field-large-fill-color": ["#e9e9e9", "#4a4a4a"],
  "input-field-large-active-fill-color": ["var(--in-sln-focus)", "#6f8a1e"],
  "input-field-large-selection-color": ["var(--in-sln-focus)", "#5c7033"],
  "input-field-large-stepper-color": ["#d9d9d9", "#666666"],
  "input-field-large-stepper-active-color": ["#303030", "#dddddd"],
  // button/increment (Figma 2004:29110): the hovered half lifts to white.
  "input-field-large-stepper-hover-background-color": [
    "var(--bt-sgb-sr-hover)",
    "#555",
  ],
};

export class InputFieldLarge extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
    }

    /* The design is two nested boxes: the outer .box keeps the constant gray
       background and padding; the inner container carries the border and all
       hover/scrub/manual-input background and text changes. */
    .box {
      background-color: var(--input-field-large-background-color);
      border: 0 solid var(--input-field-large-border-color);
      border-top-width: 1px;
      border-radius: 6px;
      box-sizing: border-box;
      height: 24px;
      padding: 3px;
      color: var(--input-field-large-text-color);
      cursor: ew-resize;
      user-select: none;
      touch-action: none;
      /* ui/label/S */
      font: var(--ui-text-label-s);
      letter-spacing: var(--ui-tracking);
      font-feature-settings: "case" 1;
    }

    /* No border at rest: hover and active draw theirs as an inset ring, so
       nothing moves when it appears. */
    .inner {
      display: flex;
      align-items: center;
      gap: 4px;
      border-radius: 3px;
      box-sizing: border-box;
      height: 100%;
      padding: 0 0 0 6px;
    }

    .inner::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px transparent;
      pointer-events: none;
    }

    .inner {
      position: relative;
      overflow: hidden;
    }

    .inner > :not(.fill) {
      position: relative;
    }

    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      background-color: var(--input-field-large-fill-color);
      pointer-events: none;
    }

    .box.scrubbing .fill,
    .box.editing .fill {
      background-color: var(--input-field-large-active-fill-color);
    }

    .box:hover:not(.disabled):not(.editing):not(.scrubbing) .inner {
      background-color: var(--input-field-large-hover-background-color);
      color: var(--input-field-large-hover-text-color);
    }

    .box:hover:not(.disabled):not(.editing):not(.scrubbing) .inner::after {
      box-shadow: inset 0 0 0 1px var(--input-field-large-hover-border-color);
    }

    /* Scrubbing and manual input share the design's active look: lime accent
       border on white, dark text. */
    .box.scrubbing .inner,
    .box.editing .inner,
    .box:focus-within .inner {
      background-color: var(--input-field-large-active-background-color);
      color: var(--input-field-large-active-text-color);
    }

    .box.scrubbing .inner::after,
    .box.editing .inner::after,
    .box:focus-within .inner::after {
      box-shadow: inset 0 0 0 1px var(--input-field-large-active-border-color);
    }

    .box.scrubbing,
    .box.editing,
    .box:focus-within {
      background-color: var(--input-field-large-tray-active-color);
      border-color: var(--input-field-large-tray-active-border-color);
      border-width: 1px 1px 0;
    }

    /* One of a linked pair (input-scrub.js): the side line only on the
       pair's outer edge. */
    :host([side="left"]) .box:is(.scrubbing, .editing, :focus-within) {
      border-right-width: 0;
    }

    :host([side="right"]) .box:is(.scrubbing, .editing, :focus-within) {
      border-left-width: 0;
    }

    .box:is(.scrubbing, .editing, :focus-within) .name {
      color: var(--input-field-large-hover-text-color);
    }

    .box:is(.scrubbing, .editing, :focus-within) .scrub-icon {
      color: var(--input-field-large-handle-active-color);
    }

    .box.string {
      cursor: text;
    }

    .box.disabled {
      cursor: default;
    }

    .box.disabled {
      background-color: var(--input-field-large-tray-disabled-color);
      border-color: var(--input-field-large-tray-disabled-border-color);
      color: var(--input-field-large-disabled-text-color);
    }

    .box.disabled .value {
      color: var(--input-field-large-value-disabled-text-color);
    }

    .box.disabled .scrub-icon {
      color: var(--input-field-large-handle-disabled-color);
    }

    .name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .apply-icon {
      flex: 0 0 auto;
      width: 1.1em;
      height: 1.1em;
      opacity: 0.75;
    }

    .scrub-icon {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      color: var(--input-field-large-handle-color);
    }

    /* Stretched to the inner container's height, so a blank value -- a mixed
       selection, or no selection at all -- still has something to click.
       Centred on its own text line it collapsed to zero height, and the
       keyboard editor it opens was out of reach. */
    .value {
      flex: 0 0 auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      min-height: 1.2em;
      cursor: text;
    }

    .value.scrub-only {
      cursor: inherit;
    }

    .value.mixed {
      font-family: inherit;
      font-style: italic;
      opacity: 0.6;
    }

    .box:not(:hover):not(.scrubbing):not(.editing):not(.disabled) .value {
      color: var(--input-field-large-value-rest-text-color);
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
      /* The design's own up/down steppers replace the native spin buttons. */
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
      background: var(--input-field-large-selection-color);
      color: #151515;
    }

    .stepper {
      display: grid;
      place-items: center;
      flex: 1 1 0;
      width: 10px;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--input-field-large-stepper-color);
      cursor: pointer;
    }

    .stepper:hover {
      color: var(--input-field-large-stepper-active-color);
      background: var(--input-field-large-stepper-hover-background-color);
      border-radius: 2px;
    }

    .stepper::before {
      width: 0;
      height: 0;
      border-right: 3.5px solid transparent;
      border-left: 3.5px solid transparent;
      content: "";
    }

    .stepper.up::before {
      border-bottom: 4px solid currentColor;
    }

    .stepper.down::before {
      border-top: 4px solid currentColor;
    }

    /* Ticket (coordinator addendum): button/icon/increment, node 287:15519 --
       the up/down stepper, present in every state (including the plain
       "input/string" mode) rather than only while editing. Invisible at rest;
       a hover, a drag or the keyboard focus the editing input already gets
       reveals it. One instance serves both rest and editing: while the value
       is being edited its clicks press the input's arrow keys, so they step
       the live edit instead of committing over it. */
    .hover-steppers {
      display: flex;
      flex-direction: column;
      align-self: stretch;
      justify-content: center;
      box-sizing: border-box;
      width: 10px;
      padding: 2px 0;
      opacity: 0;
    }

    /* The end slot: one icon the caller puts after the value. */
    ::slotted([slot="end"]) {
      flex: 0 0 auto;
    }

    .box:hover:not(.disabled) .hover-steppers,
    .box.scrubbing .hover-steppers,
    .box:focus-within .hover-steppers {
      opacity: 1;
    }
  `;

  constructor() {
    super();
    this._label = "";
    this._value = 0;
    this._mixed = false;
    this._disabled = false;
    this._minValue = undefined;
    this._maxValue = undefined;
    this._step = undefined;
    this._integer = false;
    this._editing = false;
    this._editInput = null;
    this._icon = undefined;
    this._iconTooltip = "";
    this._dragValueStream = null;
    // input/string (Figma 287:15577) is this same field with the scrub
    // (drag-arrows) icon hidden -- everything else, including the drag
    // itself, is unchanged.
    this._scrubIcon = true;
    this._fill = false;
    this._scrubOnly = false;
    this._text = false;
  }

  get type() {
    if (this._fill) {
      return "slider";
    }
    if (this._scrubIcon) {
      return "scrub";
    }
    return this._text ? "text" : "number";
  }

  set type(value) {
    this._fill = value === "slider";
    this._scrubIcon = !value || value === "scrub";
    this._text = value === "text";
    this.requestUpdate();
  }

  // A field whose value only a drag sets: no typing, no stepper arrows. For a
  // value that snaps to a list of steps, where a typed number or a one-unit
  // step would land back where it was.
  get scrubOnly() {
    return this._scrubOnly;
  }

  set scrubOnly(value) {
    this._scrubOnly = !!value;
    this.requestUpdate();
  }

  // "number" and "text": neither the scrub icon nor the slider's fill, so
  // nothing says the field drags, and it does not.
  _isStringInput() {
    return !this._scrubIcon && !this._fill;
  }

  _renderFill() {
    if (!this._fillElement) {
      return;
    }
    const min = this._minValue ?? 0;
    const max = this._maxValue ?? 100;
    const share = max > min ? (Number(this._value) - min) / (max - min) : 0;
    const clamped = Math.max(0, Math.min(1, share || 0));
    this._fillElement.style.width = `${clamped * 100}%`;
  }

  // Ticket 38: the transform row's own icon, drawn inside the field rather
  // than as a separate label element. Decorative only -- it identifies the
  // row, nothing more. A row applies on a scrub (live, "scrubstart" below)
  // or on Enter while editing the value ("apply"); the icon carries neither.
  get icon() {
    return this._icon;
  }

  set icon(value) {
    this._icon = value || undefined;
    this.requestUpdate();
  }

  get iconTooltip() {
    return this._iconTooltip;
  }

  set iconTooltip(value) {
    this._iconTooltip = value || "";
  }

  get label() {
    return this._label;
  }

  set label(value) {
    this._label = value || "";
    if (this._nameElement) {
      this._nameElement.textContent = this._label;
    }
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
    this._renderValue();
  }

  // A selection whose values differ. The box reads "mixed" until a value is
  // typed or scrubbed in.
  get mixed() {
    return this._mixed;
  }

  set mixed(value) {
    this._mixed = !!value;
    this._renderValue();
  }

  get defaultValue() {
    return this._defaultValue;
  }

  set defaultValue(value) {
    this._defaultValue = value;
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this._box?.classList.toggle("disabled", this._disabled);
  }

  get minValue() {
    return this._minValue;
  }

  set minValue(value) {
    this._minValue = value;
    this._renderFill();
  }

  get maxValue() {
    return this._maxValue;
  }

  set maxValue(value) {
    this._maxValue = value;
    this._renderFill();
  }

  get step() {
    return this._step;
  }

  set step(value) {
    this._step = value;
  }

  // Whole numbers by default match number-scrub.js's own roundScrubValue
  // default; a field with fractional steps (SpeedPunk's sharpness, opacity)
  // sets this false.
  get integer() {
    return this._integer;
  }

  set integer(value) {
    this._integer = !!value;
  }

  get _boundsFieldItem() {
    return {
      minValue: this._minValue,
      maxValue: this._maxValue,
      integer: this._integer,
      // Doubles as the rounding grid for a non-integer field (roundScrubValue),
      // not just the per-pixel increment size scrubIncrement reads it for.
      step: this._step,
    };
  }

  // Dimensions (ticket 38) has no selection to show sometimes, and passes
  // null rather than a number: blank reads better there than the literal
  // string "null".
  _displayValue() {
    return this._value == null ? "" : String(this._value);
  }

  _showsMixed() {
    return this._mixed && this._value == null;
  }

  _renderValue() {
    this._renderFill();
    if (this._valueElement && !this._editing) {
      this._valueElement.textContent = this._showsMixed()
        ? "mixed"
        : this._displayValue();
      this._valueElement.classList.toggle("mixed", this._showsMixed());
    }
  }

  _commit(value, cancelMarker) {
    this._value = value;
    this._mixed = false;
    this._renderValue();
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value, cancelled: isScrubCancelled(cancelMarker) },
      })
    );
    // A drag in progress also gets this frame down its stream (see
    // "scrubstart" in _onPointerDown) -- "change" alone cannot tell a caller
    // which frames belong to the same gesture, which a caller wanting one
    // undo step for the whole drag needs to know.
    if (this._dragValueStream) {
      this._dragValueStream.put(isScrubCancelled(cancelMarker) ? cancelMarker : value);
    }
  }

  render() {
    this._nameElement = html.span({ class: "name" }, [this._label]);
    this._valueElement = html.span(
      {
        class:
          "value" +
          (this._showsMixed() ? " mixed" : "") +
          (this._scrubOnly ? " scrub-only" : ""),
        onclick: () => this._startEdit(),
      },
      [this._showsMixed() ? "mixed" : this._displayValue()]
    );

    // Decorative only: a plain inline-svg, not an icon-button -- no click
    // handler and no pointer cursor of its own, so it reads as part of the
    // field's own name rather than a second control. Dragging over it
    // scrubs the field like any other part of the box.
    this._iconElement = this._icon
      ? html.createDomElement("inline-svg", {
          "class": "apply-icon",
          "src": this._icon,
          "data-tooltip": this._iconTooltip || "",
          "data-tooltipposition": "top",
        })
      : undefined;

    this._fillElement = this._fill ? html.div({ class: "fill" }) : undefined;

    this._hoverSteppers = html.div({ class: "hover-steppers" }, [
      this._makeStepperButton(1, "Increase"),
      this._makeStepperButton(-1, "Decrease"),
    ]);

    this._box = html.div(
      {
        class:
          "box" +
          (this._disabled ? " disabled" : "") +
          (this._isStringInput() ? " string" : ""),
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
          ...(this._fillElement ? [this._fillElement] : []),
          ...(this._iconElement ? [this._iconElement] : []),
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
          ...(this._scrubOnly || this._text ? [] : [this._hoverSteppers]),
          html.createDomElement("slot", { name: "end" }),
        ]),
      ]
    );
    this._renderFill();
    return this._box;
  }

  // The always-present increment control (Figma 287:15519, "button/icon/
  // increment"): opacity 0 until a hover/drag/focus reveals it (CSS above).
  // A click steps the value exactly one keyStepScrubValue tick and applies
  // it immediately -- no live drag stream, since there is no gesture to
  // batch into one undo step.
  _makeStepperButton(direction, label) {
    return html.createDomElement("button", {
      "class": `stepper ${direction > 0 ? "up" : "down"}`,
      "type": "button",
      "tabindex": -1,
      "aria-label": label,
      "onpointerdown": (event) => event.preventDefault(),
      "onclick": (event) => {
        event.stopPropagation();
        this._stepByClick(direction, event.shiftKey);
      },
    });
  }

  _stepByClick(direction, shiftKey) {
    if (this._disabled) {
      return;
    }
    // An edit in progress owns the value: press its arrow key, so the click
    // steps the live edit through the same stream the arrow keys use rather
    // than committing behind the open input's back.
    if (this._editing && this._editInput) {
      this._editInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: direction > 0 ? "ArrowUp" : "ArrowDown",
          shiftKey: !!shiftKey,
          cancelable: true,
        })
      );
      return;
    }
    const current = Number.isFinite(this._value) ? this._value : 0;
    const value = keyStepScrubValue(current, direction, {
      ...this._boundsFieldItem,
      shiftKey: !!shiftKey,
    });
    this._commit(value);
    // Mirrors the Enter-key path in _startEdit: the value is already
    // committed, "apply" just tells a row consumer the edit is final.
    this.dispatchEvent(new CustomEvent("apply"));
  }

  _resetToDefault() {
    if (this._disabled || this._editing) {
      return;
    }
    if (this._defaultValue == null) {
      return;
    }
    this._commit(
      roundScrubValue(
        clampScrubValue(Number(this._defaultValue), this._boundsFieldItem),
        this._boundsFieldItem
      )
    );
  }

  _startEdit() {
    if (this._scrubOnly) {
      return;
    }
    if (this._disabled || this._editing) {
      return;
    }
    this._editing = true;
    this._box.classList.add("editing");
    const input = html.createDomElement("input", {
      type: this._text ? "text" : "number",
      value: this._displayValue(),
      placeholder: this._showsMixed() ? "mixed" : "",
    });
    if (this._minValue != null) {
      input.min = this._minValue;
    }
    if (this._maxValue != null) {
      input.max = this._maxValue;
    }
    // Whole numbers for the spin buttons, like the arrow keys below.
    input.step = 1;

    this._valueElement.innerHTML = "";
    this._valueElement.appendChild(input);
    input.focus();
    input.select();
    this._editInput = input;

    // Arrow keys step the value live, as a drag does: the first press opens one
    // stream for the edit, so a caller applying drags live applies these too and
    // records the whole edit as one undo step. Typed digits still wait for Enter,
    // where a half-typed number would apply on the way.
    const editStartValue = this._value;
    let steppedLive = false;
    const stepLive = (direction, shiftKey) => {
      const parsed = parseFloat(input.value);
      const value = keyStepScrubValue(
        Number.isFinite(parsed) ? parsed : editStartValue,
        direction,
        { ...this._boundsFieldItem, shiftKey }
      );
      input.value = String(value);
      applyLive(value);
    };
    const applyLive = (value) => {
      if (!this._dragValueStream) {
        this._dragValueStream = new QueueIterator(5, true);
        this.dispatchEvent(
          new CustomEvent("scrubstart", {
            detail: { valueStream: this._dragValueStream, startValue: editStartValue },
          })
        );
      }
      steppedLive = true;
      this._commit(value);
    };
    const endLiveStream = () => {
      if (this._dragValueStream) {
        this._dragValueStream.done();
        this._dragValueStream = null;
      }
    };

    const finishEdit = (commit) => {
      if (!this._editing) {
        return;
      }
      this._editing = false;
      this._editInput = null;
      this._box.classList.remove("editing");
      if (!commit && steppedLive) {
        // Escape takes back what the arrows applied.
        this._commit(
          roundScrubValue(editStartValue, this._boundsFieldItem),
          SCRUB_CANCELLED
        );
        endLiveStream();
        return;
      }
      if (commit && this._text) {
        const typed = input.value.trim();
        if (typed === "" || typed === this._displayValue()) {
          this._renderValue();
        } else {
          this._commit(typed);
        }
        return;
      }
      if (commit) {
        const parsed = parseFloat(input.value);
        // Nothing typed leaves the values alone. Committing the old value would
        // write a blank, which callers read as zero.
        if (!Number.isFinite(parsed)) {
          this._renderValue();
          endLiveStream();
          return;
        }
        const value = roundScrubValue(
          clampScrubValue(parsed, this._boundsFieldItem),
          this._boundsFieldItem
        );
        // A value typed after the arrows goes down the same stream, so it
        // lands in the same undo step.
        if (!steppedLive || value !== this._value) {
          this._commit(value);
        }
        endLiveStream();
      } else {
        this._renderValue();
      }
    };

    input.addEventListener("keydown", (event) => {
      const arrow = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (arrow && this._text && !Number.isFinite(Number(input.value))) {
        // Expression text has no number to step.
      } else if (arrow) {
        event.preventDefault();
        stepLive(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
      } else if (event.key === "Enter") {
        // .blur() fires the "blur" listener below synchronously, committing
        // the value, before "apply" goes out -- a row's apply handler always
        // sees the value just typed, never the one before it. An edit the
        // arrows already applied live is done, and applying it again would
        // double it.
        const alreadyApplied = steppedLive;
        input.blur();
        if (!alreadyApplied) {
          this.dispatchEvent(new CustomEvent("apply"));
        }
      } else if (event.key === "Escape") {
        finishEdit(false);
      }
    });
    input.addEventListener("blur", () => finishEdit(true), { once: true });
  }

  // Mirrors ui-form.js's own _attachScrub, adapted to an absolute value
  // rather than a relative delta stream: this field has one target, not a
  // multi-selection to move by the same amount.
  _onPointerDown(event) {
    if (this._disabled || this._editing || event.button !== 0) {
      return;
    }
    if (!this._scrubOnly && this._valueElement.contains(event.target)) {
      // Let the click-to-edit handler take it instead.
      return;
    }
    if (this._hoverSteppers.contains(event.target)) {
      // Let the increment button's own click handler take it instead.
      return;
    }
    if (this._isStringInput()) {
      // input/string has no drag: a press anywhere types.
      event.preventDefault();
      this._startEdit();
      return;
    }
    this._box.setPointerCapture(event.pointerId);
    event.preventDefault();

    const startX = event.clientX;
    const startValue = Number(this._value) || 0;
    let travel = 0;
    let dragging = false;
    // The modifiers of the last real move, so the travel the edge adds on its
    // own is stepped the same way the hand's travel would have been.
    let lastEvent = event;
    const applyDelta = (dx) => {
      travel += scrubIncrement(dx, {
        step: this._step,
        shiftKey: lastEvent.shiftKey,
        ctrlKey: lastEvent.ctrlKey,
        metaKey: lastEvent.metaKey,
      });
      const clamped = clampScrubValue(startValue + travel, this._boundsFieldItem);
      travel = clamped - startValue;
      this._commit(roundScrubValue(clamped, this._boundsFieldItem));
    };
    const scrub = new EdgeScrub(this._box);

    const onMove = (moveEvent) => {
      if (!dragging) {
        if (Math.abs(moveEvent.clientX - startX) < SCRUB_THRESHOLD) {
          return;
        }
        dragging = true;
        this._box.classList.add("scrubbing");
        scrub.begin(moveEvent);
        // One stream per gesture, opened the moment it is confirmed to be a
        // drag rather than a click. A caller that wants the whole drag as one
        // undo step (a live preview it commits once) reads this instead of
        // "change", which fires once per frame with no way to tell a drag's
        // last frame from its next one.
        this._dragValueStream = new QueueIterator(5, true);
        this.dispatchEvent(
          new CustomEvent("scrubstart", {
            detail: { valueStream: this._dragValueStream, startValue },
          })
        );
      }
      lastEvent = moveEvent;
      applyDelta(scrub.delta(moveEvent));
    };

    const detach = () => {
      this._box.classList.remove("scrubbing");
      this._box.removeEventListener("pointermove", onMove);
      this._box.removeEventListener("pointerup", onUp);
      this._box.removeEventListener("pointercancel", onUp);
      this._box.removeEventListener("pointerdown", onSecondButton);
      this._box.removeEventListener("contextmenu", onContextMenu);
      this._box.releasePointerCapture?.(event.pointerId);
      scrub.end();
    };

    const endStream = () => {
      if (this._dragValueStream) {
        this._dragValueStream.done();
        this._dragValueStream = null;
      }
    };

    const onUp = () => {
      detach();
      endStream();
    };

    // Right-click abandons the drag: the value goes back to where the press
    // found it, using the same SCRUB_CANCELLED sentinel ui-form.js's scrub
    // sends down its value stream.
    const onSecondButton = (downEvent) => {
      if (downEvent.button === 0) {
        return;
      }
      downEvent.preventDefault();
      detach();
      if (dragging) {
        this._commit(
          roundScrubValue(startValue, this._boundsFieldItem),
          SCRUB_CANCELLED
        );
      }
      endStream();
    };

    const onContextMenu = (menuEvent) => menuEvent.preventDefault();

    this._box.addEventListener("pointermove", onMove);
    this._box.addEventListener("pointerup", onUp);
    this._box.addEventListener("pointercancel", onUp);
    this._box.addEventListener("pointerdown", onSecondButton);
    this._box.addEventListener("contextmenu", onContextMenu);
  }
}

customElements.define("input-field-large", InputFieldLarge);
