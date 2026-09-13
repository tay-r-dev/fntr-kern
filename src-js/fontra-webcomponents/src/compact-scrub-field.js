import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import {
  SCRUB_CANCELLED,
  SCRUB_THRESHOLD,
  clampScrubValue,
  isScrubCancelled,
  roundScrubValue,
  scrubIncrement,
} from "@fontra/core/number-scrub.js";
import { InlineSVG } from "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

// Ticket 26 (UI-REFACTOR.md §2.5, UI-NOMENCLATURE.md §14): the compact scrub
// field -- one box holding its own name, a scrub icon and a right-aligned
// value. Dragging anywhere in the box but the value text scrubs it; clicking
// the value edits it. Works standalone (this ticket's SpeedPunk group) and,
// because it is a plain custom element, inside a `ui-form` row too (a later
// ticket's job, not this one).
//
// The arithmetic and the cancel sentinel are number-scrub.js's, the same
// ones ui-form.js's own label-drag scrub uses -- this is a second place to
// grab a field, not a second scrub.
const colors = {
  "compact-scrub-field-background-color": ["#eee", "#3a3a3a"],
  "compact-scrub-field-border-color": ["#ccc", "#555"],
  "compact-scrub-field-text-color": ["#000", "#fff"],
};

export class CompactScrubField extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
    }

    .box {
      display: flex;
      align-items: center;
      gap: 0.35em;
      background-color: var(--compact-scrub-field-background-color);
      border: 1px solid var(--compact-scrub-field-border-color);
      border-radius: 0.25em;
      padding: 0.2em 0.5em;
      color: var(--compact-scrub-field-text-color);
      cursor: ew-resize;
      user-select: none;
      touch-action: none;
    }

    .box.disabled {
      opacity: 0.5;
      cursor: default;
    }

    .name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.9em;
    }

    .scrub-icon {
      flex: 0 0 auto;
      width: 0.9em;
      height: 0.9em;
      opacity: 0.55;
    }

    .value {
      flex: 0 0 auto;
      min-width: 2.5em;
      text-align: right;
      font-family: monospace;
      cursor: text;
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
    }
  `;

  constructor() {
    super();
    this._label = "";
    this._value = 0;
    this._disabled = false;
    this._minValue = undefined;
    this._maxValue = undefined;
    this._step = undefined;
    this._integer = false;
    this._editing = false;
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
    };
  }

  _renderValue() {
    if (this._valueElement && !this._editing) {
      this._valueElement.textContent = String(this._value);
    }
  }

  _commit(value, cancelMarker) {
    this._value = value;
    this._renderValue();
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value, cancelled: isScrubCancelled(cancelMarker) },
      })
    );
  }

  render() {
    this._nameElement = html.span({ class: "name" }, [this._label]);
    this._valueElement = html.span(
      {
        class: "value",
        onclick: () => this._startEdit(),
      },
      [String(this._value)]
    );

    this._box = html.div(
      {
        class: "box" + (this._disabled ? " disabled" : ""),
        onpointerdown: (event) => this._onPointerDown(event),
      },
      [
        this._nameElement,
        html.createDomElement("inline-svg", {
          class: "scrub-icon",
          src: "/tabler-icons/arrows-horizontal.svg",
        }),
        this._valueElement,
      ]
    );
    return this._box;
  }

  _startEdit() {
    if (this._disabled || this._editing) {
      return;
    }
    this._editing = true;
    const input = html.createDomElement("input", {
      type: "number",
      value: String(this._value),
    });
    if (this._minValue != null) {
      input.min = this._minValue;
    }
    if (this._maxValue != null) {
      input.max = this._maxValue;
    }
    input.step = this._integer ? 1 : "any";

    this._valueElement.innerHTML = "";
    this._valueElement.appendChild(input);
    input.focus();
    input.select();

    const finishEdit = (commit) => {
      if (!this._editing) {
        return;
      }
      this._editing = false;
      if (commit) {
        const parsed = parseFloat(input.value);
        const value = Number.isFinite(parsed)
          ? roundScrubValue(
              clampScrubValue(parsed, this._boundsFieldItem),
              this._boundsFieldItem
            )
          : this._value;
        this._commit(value);
      } else {
        this._renderValue();
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
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
    if (this._valueElement.contains(event.target)) {
      // Let the click-to-edit handler take it instead.
      return;
    }
    this._box.setPointerCapture(event.pointerId);
    event.preventDefault();

    const startX = event.clientX;
    const startValue = this._value;
    let lastX = startX;
    let travel = 0;
    let dragging = false;

    const onMove = (moveEvent) => {
      if (!dragging) {
        if (Math.abs(moveEvent.clientX - startX) < SCRUB_THRESHOLD) {
          return;
        }
        dragging = true;
        lastX = moveEvent.clientX;
      }
      travel += scrubIncrement(moveEvent.clientX - lastX, {
        step: this._step,
        shiftKey: moveEvent.shiftKey,
        ctrlKey: moveEvent.ctrlKey,
        metaKey: moveEvent.metaKey,
      });
      lastX = moveEvent.clientX;
      const clamped = clampScrubValue(startValue + travel, this._boundsFieldItem);
      travel = clamped - startValue;
      const rounded = roundScrubValue(clamped, this._boundsFieldItem);
      this._commit(rounded);
    };

    const detach = () => {
      this._box.removeEventListener("pointermove", onMove);
      this._box.removeEventListener("pointerup", onUp);
      this._box.removeEventListener("pointercancel", onUp);
      this._box.removeEventListener("pointerdown", onSecondButton);
      this._box.removeEventListener("contextmenu", onContextMenu);
      this._box.releasePointerCapture?.(event.pointerId);
    };

    const onUp = () => detach();

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
