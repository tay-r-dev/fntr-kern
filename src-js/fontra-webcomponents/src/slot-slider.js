import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import { themeColorCSS } from "./theme-support.js";

// The slot slider (Figma 421:15034 "in slot", 421:15066 "outside the
// slot"): a 4px track with slots cut at its stops -- the design's 9x10 slot
// shape, joined to the track by small fillets. The thumb is a white dot in a
// grey ring between stops; on a stop it takes the slot's shape instead: a
// white 7x10 key in a grey 9x12 well, filleted into the track like the slot
// it replaces.
//
// Dragging within SNAP_DISTANCE of a stop lands on it. "input" fires while
// dragging and "change" on release, both with {value} in event.detail.
// Arrow keys step by a hundredth of the range (a tenth with Shift); Home and
// End go to the ends.
//
// `min`, `max`, `value`, `stops` and `disabled` are plain JS properties, the
// convention every UnlitElement component in this tree uses. It is only the
// track; a caller puts its number field (input/string) beside it.
const colors = {
  "slot-slider-track-color": ["#e9e9e9", "#4a4a4a"],
  "slot-slider-thumb-color": ["#fff", "#d0d0d0"],
  "slot-slider-thumb-shadow-color": ["rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.6)"],
};

const SNAP_DISTANCE = 4;
// Half the widest thumb: the thumb's centre never leaves the track.
const INSET = 5.5;

export class SlotSlider extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    :host {
      display: block;
      position: relative;
      height: 16px;
      min-width: 40px;
      cursor: pointer;
      touch-action: none;
      outline: none;
    }

    :host([disabled]) {
      cursor: default;
      opacity: 0.5;
    }

    .track {
      position: absolute;
      left: 0;
      right: 0;
      top: 6px;
      height: 4px;
      border-radius: 1px;
      background-color: var(--slot-slider-track-color);
    }

    /* The slot and the well stand on the stop's x; their 9px widths centre
       on it. */
    .slot {
      position: absolute;
      top: 3px;
      width: 9px;
      height: 10px;
      margin-left: -4.5px;
      background: url("/images/slider-slot.svg") center / 9px 10px no-repeat;
    }

    .thumb {
      position: absolute;
      top: 50%;
      box-sizing: border-box;
      width: 9px;
      height: 9px;
      margin-left: -4.5px;
      transform: translateY(-50%);
      border-radius: 50%;
      background-color: var(--slot-slider-thumb-color);
      /* The 11px grey ring under the 9px dot, and the dot's own soft
         shadow. */
      box-shadow:
        0 0 2px var(--slot-slider-thumb-shadow-color),
        0 0 0 1px var(--slot-slider-track-color);
    }

    .well {
      display: none;
      position: absolute;
      top: 2px;
      width: 13px;
      height: 12px;
      margin-left: -6.5px;
    }

    .well-body {
      position: absolute;
      left: 2px;
      top: 0;
      width: 9px;
      height: 12px;
      border-radius: 3px;
      background-color: var(--slot-slider-track-color);
    }

    .fillet {
      position: absolute;
      width: 2px;
      height: 2px;
      background: url("/images/slider-fillet.svg") center / 2px 2px no-repeat;
    }

    .fillet.top-left {
      left: 0;
      top: 2px;
    }

    .fillet.top-right {
      left: 11px;
      top: 2px;
      transform: scaleX(-1);
    }

    .fillet.bottom-right {
      left: 11px;
      top: 8px;
      transform: rotate(180deg);
    }

    .fillet.bottom-left {
      left: 0;
      top: 8px;
      transform: scaleY(-1);
    }

    :host([in-slot]) .well {
      display: block;
    }

    :host([in-slot]) .thumb {
      width: 7px;
      height: 10px;
      margin-left: -3.5px;
      border-radius: 2px;
      box-shadow: 0 0 2px var(--slot-slider-thumb-shadow-color);
    }

    :host(:focus-visible) .thumb {
      outline: 1px solid #def280;
      outline-offset: 1px;
    }
  `;

  constructor() {
    super();
    this._min = 0;
    this._max = 1;
    this._value = 0;
    this._stops = [];
    this._disabled = false;
    this.tabIndex = 0;
    this.addEventListener("pointerdown", (event) => this._startDrag(event));
    this.addEventListener("keydown", (event) => this._keyDown(event));
  }

  get min() {
    return this._min;
  }

  set min(value) {
    this._min = Number(value);
    this.requestUpdate();
  }

  get max() {
    return this._max;
  }

  set max(value) {
    this._max = Number(value);
    this.requestUpdate();
  }

  get stops() {
    return this._stops;
  }

  set stops(value) {
    this._stops = [...(value || [])];
    this.requestUpdate();
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = Number(value);
    this._place();
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = !!value;
    this.toggleAttribute("disabled", this._disabled);
    this.tabIndex = this._disabled ? -1 : 0;
  }

  render() {
    this._slots = this._stops.map((stop) => {
      const slot = html.div({ class: "slot" });
      slot.style.left = this._leftFor(stop);
      slot.dataset.stop = stop;
      return slot;
    });
    this._thumb = html.div({ class: "thumb" });
    this._well = html.div({ class: "well" }, [
      html.div({ class: "fillet top-left" }),
      html.div({ class: "fillet top-right" }),
      html.div({ class: "fillet bottom-right" }),
      html.div({ class: "fillet bottom-left" }),
      html.div({ class: "well-body" }),
    ]);
    const elements = [
      html.div({ class: "track" }),
      ...this._slots,
      this._well,
      this._thumb,
    ];
    this._place();
    return elements;
  }

  _fraction(value) {
    const span = this._max - this._min;
    if (!(span > 0)) {
      return 0;
    }
    return Math.min(1, Math.max(0, (value - this._min) / span));
  }

  _leftFor(value) {
    return `calc(${INSET}px + (100% - ${2 * INSET}px) * ${this._fraction(value)})`;
  }

  // The stop the value sits on, if any.
  _stopAt(value) {
    return this._stops.find((stop) => stop === value);
  }

  _place() {
    if (!this._thumb) {
      return;
    }
    const left = this._leftFor(this._value);
    this._thumb.style.left = left;
    this._well.style.left = left;
    const stop = this._stopAt(this._value);
    this.toggleAttribute("in-slot", stop !== undefined);
    // The well takes the place of the slot it stands in.
    for (const slot of this._slots) {
      slot.style.visibility = Number(slot.dataset.stop) === stop ? "hidden" : "";
    }
  }

  _valueAtX(clientX) {
    const rect = this.getBoundingClientRect();
    const usable = rect.width - 2 * INSET;
    const x = clientX - rect.left - INSET;
    for (const stop of this._stops) {
      if (Math.abs(x - this._fraction(stop) * usable) <= SNAP_DISTANCE) {
        return stop;
      }
    }
    const fraction = usable > 0 ? Math.min(1, Math.max(0, x / usable)) : 0;
    return this._min + fraction * (this._max - this._min);
  }

  _setValue(value, eventType) {
    if (value === this._value && eventType === "input") {
      return;
    }
    this.value = value;
    this.dispatchEvent(
      new CustomEvent(eventType, { bubbles: true, detail: { value: this._value } })
    );
  }

  _startDrag(event) {
    if (this._disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.focus();
    this.setPointerCapture(event.pointerId);
    this._setValue(this._valueAtX(event.clientX), "input");
    const onMove = (moveEvent) =>
      this._setValue(this._valueAtX(moveEvent.clientX), "input");
    const onEnd = () => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onEnd);
      this.removeEventListener("lostpointercapture", onEnd);
      this._setValue(this._value, "change");
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onEnd);
    this.addEventListener("lostpointercapture", onEnd);
  }

  _keyDown(event) {
    if (this._disabled) {
      return;
    }
    const step = ((this._max - this._min) / 100) * (event.shiftKey ? 10 : 1);
    let value;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        value = this._value - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        value = this._value + step;
        break;
      case "Home":
        value = this._min;
        break;
      case "End":
        value = this._max;
        break;
      default:
        return;
    }
    event.preventDefault();
    this._setValue(Math.min(this._max, Math.max(this._min, value)), "change");
  }
}

customElements.define("slot-slider", SlotSlider);
