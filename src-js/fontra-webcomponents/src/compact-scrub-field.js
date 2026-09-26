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

// Ticket 26 (UI-REFACTOR.md §2.5, UI-NOMENCLATURE.md §14): the compact scrub
// field -- one box holding its own name, a scrub icon and a right-aligned
// value. Dragging anywhere in the box but the value text scrubs it; clicking
// the value edits it. Works standalone (this ticket's SpeedPunk group) and,
// because it is a plain custom element, inside a `ui-form` row too (a later
// ticket's job, not this one).
//
// A double-click on the scrub area (anywhere but the value, whose click opens
// the keyboard editor) puts back `defaultValue`, as a typed value would. A
// field with no default leaves it unset and ignores the double-click.
//
// The arithmetic and the cancel sentinel are number-scrub.js's, the same
// ones ui-form.js's own label-drag scrub uses -- this is a second place to
// grab a field, not a second scrub.
// Figma scrub-field design (_external/component-code/scrub/scrub.txt): light
// gray box, a faint border on hover, and a lime accent border with a white
// background while scrubbing or editing manually. Each light color carries a
// dark-theme counterpart.
const colors = {
  "compact-scrub-field-background-color": ["#f5f5f5", "#3a3a3a"],
  "compact-scrub-field-hover-background-color": ["#f7f7f7", "#464646"],
  "compact-scrub-field-hover-border-color": [
    "rgba(0, 0, 0, 0.08)",
    "rgba(255, 255, 255, 0.14)",
  ],
  "compact-scrub-field-active-background-color": ["#fff", "#2c2c2c"],
  "compact-scrub-field-active-border-color": ["#def280", "#8fae4a"],
  "compact-scrub-field-text-color": ["#8e8e8e", "#b0b0b0"],
  // The design gives the rest-state value a darker gray than its label
  // (grey/solid/3 vs grey/solid/4) -- every other state matches the two.
  "compact-scrub-field-value-rest-text-color": ["#565656", "#b0b0b0"],
  "compact-scrub-field-hover-text-color": ["#303030", "#e0e0e0"],
  "compact-scrub-field-active-text-color": ["#151515", "#f0f0f0"],
  "compact-scrub-field-handle-color": ["#b4b4b4", "#777777"],
  "compact-scrub-field-selection-color": ["#d5ed57", "#5c7033"],
  "compact-scrub-field-stepper-color": ["#d9d9d9", "#666666"],
  "compact-scrub-field-stepper-active-color": ["#303030", "#dddddd"],
};

export class CompactScrubField extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
    }

    /* The design is two nested boxes: the outer .box keeps the constant gray
       background and padding; the inner container carries the border and all
       hover/scrub/manual-input background and text changes. */
    .box {
      background-color: var(--compact-scrub-field-background-color);
      border-radius: 0.375em;
      box-sizing: border-box;
      height: 24px;
      padding: 3px;
      color: var(--compact-scrub-field-text-color);
      cursor: ew-resize;
      user-select: none;
      touch-action: none;
      /* ui/label/XS */
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
    }

    .inner {
      display: flex;
      align-items: center;
      gap: 0.35em;
      border: 1px solid transparent;
      border-radius: 0.25em;
      box-sizing: border-box;
      height: 100%;
      padding: 0 0.4em;
    }

    .box:hover:not(.disabled):not(.editing):not(.scrubbing) .inner {
      background-color: var(--compact-scrub-field-hover-background-color);
      border-color: var(--compact-scrub-field-hover-border-color);
      color: var(--compact-scrub-field-hover-text-color);
    }

    /* Scrubbing and manual input share the design's active look: lime accent
       border on white, dark text. */
    .box.scrubbing .inner,
    .box.editing .inner,
    .box:focus-within .inner {
      background-color: var(--compact-scrub-field-active-background-color);
      border-color: var(--compact-scrub-field-active-border-color);
      color: var(--compact-scrub-field-active-text-color);
    }

    /* The design fades the disabled state to 70% opacity, not 30% -- its
       text is already the faint grey/solid/4, so a heavier fade read as
       gone rather than disabled. */
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

    .apply-icon {
      flex: 0 0 auto;
      width: 1.1em;
      height: 1.1em;
      opacity: 0.75;
    }

    .scrub-icon {
      flex: 0 0 auto;
      width: 0.9em;
      height: 0.9em;
      color: var(--compact-scrub-field-handle-color);
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
      justify-content: flex-end;
      min-width: 2.5em;
      min-height: 1.2em;
      cursor: text;
    }

    .value.mixed {
      font-family: inherit;
      font-style: italic;
      opacity: 0.6;
    }

    .box:not(:hover):not(.scrubbing):not(.editing):not(.disabled) .value {
      color: var(--compact-scrub-field-value-rest-text-color);
    }

    .value input {
      width: 4em;
      text-align: right;
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
      background: var(--compact-scrub-field-selection-color);
      color: #151515;
    }

    /* Up/down steppers, visible only in manual input (per the Figma design).
       They live inside the value element, so the input's removal on edit end
       takes them along. */
    .steppers {
      display: flex;
      flex-direction: column;
      align-self: stretch;
      justify-content: center;
      margin-left: 0.15em;
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
      color: var(--compact-scrub-field-stepper-color);
      cursor: pointer;
    }

    .stepper:hover {
      color: var(--compact-scrub-field-stepper-active-color);
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

    /* Ticket (coordinator addendum): button/icon/increment, node 287:15519 --
       the same up/down stepper as the manual-input one above, but present in
       every state (including the plain "input/string" mode) rather than only
       while editing. Invisible at rest; a hover, a drag or the keyboard focus
       the editing input already gets reveals it. Hidden again while editing
       itself, where the value element grows its own copy (_startEdit below)
       wired to the live text instead of a bare click. */
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

    .box.editing .hover-steppers {
      opacity: 0;
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
    this._icon = undefined;
    this._iconTooltip = "";
    this._dragValueStream = null;
    // input/string (Figma 287:15577) is this same field with the scrub
    // (drag-arrows) icon hidden -- everything else, including the drag
    // itself, is unchanged.
    this._scrubIcon = true;
  }

  get scrubIcon() {
    return this._scrubIcon;
  }

  set scrubIcon(value) {
    this._scrubIcon = value == null ? true : !!value;
    this.requestUpdate();
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
  }

  get maxValue() {
    return this._maxValue;
  }

  set maxValue(value) {
    this._maxValue = value;
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
        class: "value" + (this._showsMixed() ? " mixed" : ""),
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
          this._hoverSteppers,
        ]),
      ]
    );
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
        this._stepByClick(direction);
      },
    });
  }

  _stepByClick(direction) {
    if (this._disabled) {
      return;
    }
    const current = Number.isFinite(this._value) ? this._value : 0;
    const value = keyStepScrubValue(current, direction, {
      ...this._boundsFieldItem,
      shiftKey: false,
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
    if (this._disabled || this._editing) {
      return;
    }
    this._editing = true;
    this._box.classList.add("editing");
    const input = html.createDomElement("input", {
      type: "number",
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
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
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
    // The design's own up/down steppers (the native spin buttons are hidden
    // by the CSS above). They step the value live like the arrow keys, and
    // their pointerdown is cancelled so the input keeps focus.
    const makeStepper = (direction, label) =>
      html.createDomElement("button", {
        "class": `stepper ${direction > 0 ? "up" : "down"}`,
        "type": "button",
        "tabindex": -1,
        "aria-label": label,
        "onpointerdown": (event) => event.preventDefault(),
        "onclick": (event) => stepLive(direction, event.shiftKey),
      });
    const steppers = html.div({ class: "steppers" }, [
      makeStepper(1, "Increase"),
      makeStepper(-1, "Decrease"),
    ]);
    this._valueElement.appendChild(steppers);
    input.addEventListener("blur", () => finishEdit(true), { once: true });
  }

  // Mirrors ui-form.js's own _attachScrub, adapted to an absolute value
  // rather than a relative delta stream: this field has one target, not a
  // multi-selection to move by the same amount.
  _onPointerDown(event) {
    if (this._disabled || this._editing || event.button !== 0) {
      return;
    }
    if (this._valueElement.contains(event.target)) {
      // Let the click-to-edit handler take it instead.
      return;
    }
    if (this._hoverSteppers.contains(event.target)) {
      // Let the increment button's own click handler take it instead.
      return;
    }
    this._box.setPointerCapture(event.pointerId);
    event.preventDefault();

    const startX = event.clientX;
    const startValue = this._value;
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

customElements.define("compact-scrub-field", CompactScrubField);
