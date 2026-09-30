import * as html from "@fontra/core/html-utils.js";
import { UnlitElement, htmlToElement } from "@fontra/core/html-utils.js";
import "./compact-scrub-field.js";
import { RangeSlider } from "./range-slider.js";
import "./slot-slider.js";
import { themeColorCSS } from "./theme-support.js";

const colors = {
  "disabled-color": ["#ccc", "#777"],
};

export class DesignspaceLocation extends UnlitElement {
  static styles = `
    ${themeColorCSS(colors)}

    .grid-wrapper {
      height: 100%;
      width: 100%;
      display: grid;
      grid-template-columns: 25% auto;
      gap: 0.3em;
      overflow: auto;
    }

    .grid-wrapper.only-show-phantom-axes {
      row-gap: 0;
    }

    .slider-label {
      text-align: right;
      text-overflow: ellipsis;
      vertical-align: middle;
      margin-top: 1px;
    }

    .slider-label:hover {
      /* overflow: visible; */  /* this is cool but makes the layout jump: too distracting? */
      cursor: pointer;
    }

    .slider-group {
      display: grid;
      gap: 0.1em;
    }

    .slider-group > .slider-disabled:only-child {
      transform: translate(0, 0.25em);
    }

    .info-box {
      display: none;
      grid-column: 1 / -1;
      margin-bottom: 0.5em;
      color: var(--disabled-color);
    }

    .info-box.visible {
      display: initial;
    }

    hr {
      border: none;
      border-top: 1px dotted var(--horizontal-rule-color);
      width: 100%;
      height: 1px;
      grid-column: 1 / -1;
    }

    hr.spacer {
      border-top: unset;
    }

    /* look="slot" (Figma 421:15034 / 421:15066): each axis is its name as a
       caption, then its value field and the slot slider, the slots at the
       axis's stops (where its sources sit). */
    :host([look="slot"]) .grid-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .slot-axis {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ui/heading/h5 */
    .slot-caption {
      font: var(--ui-text-heading-h5);
      letter-spacing: var(--ui-tracking);
      color: var(--slot-caption-color, #8e8e8e);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }

    .slot-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .slot-row compact-scrub-field {
      flex: none;
      width: 44px;
    }

    .slot-row slot-slider {
      flex: 1 1 auto;
      min-width: 0;
    }

    :host([look="slot"]) .info-box {
      margin-bottom: 0;
    }
  `;

  constructor() {
    super();
    this.continuous = true;
  }

  static properties = {
    axes: { type: Array },
    phantomAxes: { type: Array },
    onlyShowPhantomAxes: { type: Boolean },
    // For look="slot": {axisName: [values]}, where each axis's slots go. An
    // axis without an entry has slots at its minimum, default and maximum
    // (or at its values, for a discrete axis).
    axisStops: { type: Object },
  };

  // "slot" draws each axis as a caption, a value field and a slot slider.
  // Mirrored to the attribute, which the styles key on.
  get look() {
    return this.getAttribute("look");
  }

  set look(value) {
    if (value) {
      this.setAttribute("look", value);
    } else {
      this.removeAttribute("look");
    }
    this.requestUpdate();
  }

  get model() {
    return this._controller.model;
  }

  get controller() {
    return this._controller;
  }

  set controller(controller) {
    if (this._controller) {
      this._controller.removeListener(this._modelListener);
    }
    this._controller = controller;
    this._modelListener = (event) => {
      if (event.senderInfo === this) {
        // Event was triggered by us -- ignore
        return;
      }
      const slider = this._sliders?.[event.key];
      if (slider) {
        slider.value = event.newValue;
      }
    };
    this._controller.addListener(this._modelListener);
    this.values = controller.model;
  }

  get values() {
    if (!this._values) {
      this._values = {};
    }
    return this._values;
  }

  set values(values) {
    this._values = { ...values };
    this._setSliderValues(values, this._sliders);
  }

  get phantomValues() {
    if (!this._phantomValues) {
      this._phantomValues = {};
    }
    return this._phantomValues;
  }

  set phantomValues(phantomValues) {
    this._phantomValues = { ...phantomValues };
    this._setSliderValues(phantomValues, this._phantomSliders);
  }

  _setSliderValues(values, sliders) {
    for (const [axisName, value] of Object.entries(values)) {
      const slider = sliders?.[axisName];
      if (slider) {
        slider.value = value;
      }
    }

    for (const axis of this.axes || []) {
      if (!(axis.name in values)) {
        const slider = sliders?.[axis.name];
        if (slider) {
          slider.value = axis.defaultValue;
        }
      }
    }
  }

  render() {
    if (!this.axes) {
      return;
    }
    this._sliders = {};
    this._phantomSliders = {};

    const phantomAxesByName = {};
    for (const phantomAxis of this.phantomAxes || []) {
      phantomAxesByName[phantomAxis.name] = phantomAxis;
    }
    const elements = [];
    for (const axis of this.axes) {
      if (axis.isDivider) {
        elements.push(html.hr());
        continue;
      }
      this._setupAxis(elements, axis, phantomAxesByName[axis.name]);
    }

    const gridWrapper = html.div({ class: "grid-wrapper" }, elements);
    if (this.onlyShowPhantomAxes) {
      gridWrapper.classList.add("only-show-phantom-axes");
    }
    return [gridWrapper];
  }

  _setupAxis(elements, axis, phantomAxis) {
    if (this.getAttribute("look") === "slot") {
      this._setupSlotAxis(elements, axis, phantomAxis);
      return;
    }
    const modelValue = this.values[axis.name];
    const phantomModelValue = phantomAxis ? this.phantomValues[axis.name] : undefined;

    const infoBox = htmlToElement(
      `<div class="info-box">
        ${
          axis.values && axis.values.length > 0
            ? `
        <span>Default: <strong>${axis.defaultValue}</strong></span>&nbsp; |
        <span>Values: <strong style="white-space: break-spaces;">${axis.values.join(
          ", "
        )}</strong></span>
        `
            : `
        <span>Min: <strong>${axis.minValue}</strong></span>&nbsp; |
        <span>Default: <strong>${axis.defaultValue}</strong></span>&nbsp; |
        <span>Max: <strong>${axis.maxValue}</strong></span>
        `
        }
      </div>`
    );

    const sliderGroupContents = [];
    elements.push(
      html.div(
        {
          class: "slider-label",
          onclick: (event) => this._toggleInfoBox(infoBox, event),
        },
        [axis.name]
      )
    );
    if (!this.onlyShowPhantomAxes) {
      const slider = this._createSlider(axis, modelValue);
      this._sliders[axis.name] = slider;
      sliderGroupContents.push(slider);
    }

    if (phantomAxis) {
      const phantomSlider = this._createSlider(phantomAxis, phantomModelValue, true);
      this._phantomSliders[axis.name] = phantomSlider;
      sliderGroupContents.push(phantomSlider);
    }
    elements.push(html.div({ class: "slider-group" }, sliderGroupContents));
    elements.push(infoBox);
  }

  _createSlider(axis, modelValue, sliderDisabled = false) {
    const parms = {
      defaultValue: axis.defaultValue,
      value: modelValue !== undefined ? modelValue : axis.defaultValue,
      onChangeCallback: (event) => {
        if (this.continuous || !event.isDragging) {
          this._dispatchLocationChangedEvent(axis.name, event.value);
        }
      },
      disabled: sliderDisabled,
      class: sliderDisabled ? "slider-disabled" : "",
    };
    if (axis.values) {
      // Discrete axis
      parms.values = axis.values;
    } else {
      // Continuous axis
      parms.minValue = axis.minValue;
      parms.maxValue = axis.maxValue;
    }
    return html.createDomElement("range-slider", parms);
  }

  _setupSlotAxis(elements, axis, phantomAxis) {
    const infoBox = html.div({ class: "info-box" }, [
      axis.values?.length
        ? `Default: ${axis.defaultValue} | Values: ${axis.values.join(", ")}`
        : `Min: ${axis.minValue} | Default: ${axis.defaultValue} | Max: ${axis.maxValue}`,
    ]);
    const rows = [];
    if (!this.onlyShowPhantomAxes) {
      const row = this._createSlotRow(axis, this.values[axis.name]);
      this._sliders[axis.name] = row.control;
      rows.push(row.element);
    }
    if (phantomAxis) {
      const row = this._createSlotRow(phantomAxis, this.phantomValues[axis.name], true);
      this._phantomSliders[axis.name] = row.control;
      rows.push(row.element);
    }
    elements.push(
      html.div({ class: "slot-axis" }, [
        html.div(
          {
            class: "slot-caption",
            onclick: (event) => this._toggleInfoBox(infoBox, event),
          },
          [axis.name]
        ),
        ...rows,
        infoBox,
      ])
    );
  }

  _slotStops(axis) {
    const given = this.axisStops?.[axis.name];
    const stops = given?.length
      ? given
      : axis.values?.length
        ? axis.values
        : [axis.minValue, axis.defaultValue, axis.maxValue];
    return [...new Set(stops.filter((value) => value != null))].sort((a, b) => a - b);
  }

  // A value field and a slot slider that follow each other. `control` is
  // what _setSliderValues writes a value to.
  _createSlotRow(axis, modelValue, disabled = false) {
    const discrete = !!axis.values?.length;
    const minValue = discrete ? Math.min(...axis.values) : axis.minValue;
    const maxValue = discrete ? Math.max(...axis.values) : axis.maxValue;
    const value = modelValue ?? axis.defaultValue;

    const field = html.createDomElement("compact-scrub-field");
    field.scrubIcon = false;
    field.minValue = minValue;
    field.maxValue = maxValue;
    field.defaultValue = axis.defaultValue;
    field.value = value;
    field.disabled = disabled;

    const slider = html.createDomElement("slot-slider");
    slider.min = minValue;
    slider.max = maxValue;
    slider.stops = this._slotStops(axis);
    slider.discrete = discrete;
    slider.value = value;
    slider.disabled = disabled;

    const commit = (newValue) => {
      this._dispatchLocationChangedEvent(axis.name, newValue);
    };
    slider.addEventListener("input", (event) => {
      field.value = event.detail.value;
      if (this.continuous) {
        commit(event.detail.value);
      }
    });
    slider.addEventListener("change", (event) => {
      field.value = event.detail.value;
      commit(event.detail.value);
    });
    slider.addEventListener("dblclick", () => {
      slider.value = axis.defaultValue;
      field.value = axis.defaultValue;
      commit(axis.defaultValue);
    });
    field.addEventListener("change", (event) => {
      if (event.detail.cancelled) {
        return;
      }
      slider.value = event.detail.value;
      commit(event.detail.value);
    });

    const control = {
      set value(newValue) {
        field.value = newValue;
        slider.value = newValue;
      },
      get value() {
        return slider.value;
      },
    };
    return { element: html.div({ class: "slot-row" }, [field, slider]), control };
  }

  _toggleInfoBox(infoBox, event) {
    if (event.altKey) {
      const onOff = !infoBox.classList.contains("visible");
      for (const box of this.shadowRoot.querySelectorAll(".info-box")) {
        box.classList.toggle("visible", onOff);
      }
    } else {
      infoBox.classList.toggle("visible");
    }
  }

  _dispatchLocationChangedEvent(name, value) {
    if (this.controller) {
      this.controller.setItem(name, value, this);
    } else {
      this.values[name] = value;
      const event = new CustomEvent("locationChanged", {
        bubbles: false,
        detail: this,
      });
      this.dispatchEvent(event);
    }
  }
}

customElements.define("designspace-location", DesignspaceLocation);
