import * as html from "@fontra/core/html-utils.js";
import { SimpleElement } from "@fontra/core/html-utils.js";
import {
  SCRUB_THRESHOLD,
  clampScrubValue,
  scrubIncrement,
} from "@fontra/core/number-scrub.js";
import { QueueIterator } from "@fontra/core/queue-iterator.js";
import {
  assert,
  enumerate,
  hyphenatedToCamelCase,
  round,
  scheduleCalls,
} from "@fontra/core/utils.ts";
import { RangeSlider } from "@fontra/web-components/range-slider.js";
import "@fontra/web-components/rotary-control.js";

export class Form extends SimpleElement {
  static styles = `
    :host {
      --label-column-width: 32%;
    }

    .ui-form {
      display: grid;
      align-items: center;
      grid-template-columns: var(--label-column-width) auto;
      gap: 0.35rem 0.35rem;
      margin: 0em;
      padding: 0em;
    }

    .ui-form-label {
      text-align: right;
      overflow-x: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.6em;
    }

    /* A label that scrubs the number beside it. The arrows are the only thing
       announcing that the label is draggable at all, so they are not optional.
       Selection is off because a scrub that highlights the label text as it goes
       reads as a failed text drag. */
    .ui-form-label.scrubbable {
      cursor: ew-resize;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }

    .ui-form-full-width {
      grid-column: 1 / span 2;
    }

    hr {
      border: none;
      border-top: 1px solid var(--horizontal-rule-color);
      width: 100%;
      height: 1px;
      margin-block-start: 0.2em;
      margin-block-end: 0.1em;
      grid-column: 1 / span 2;
    }

    .ui-form-line-spacer {
      grid-column: 1 / span 2;
      height: 0.2em;
    }

    .ui-form-label.header {
      overflow-x: unset;
      font-weight: bold;
      grid-column: 1 / span 2;
      text-align: left;
      display: grid;
      grid-template-columns: auto auto;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }

    input {
      background-color: var(--text-input-background-color);
      color: var(--text-input-foreground-color);
      border-radius: 0.25em;
      border: none;
      outline: none;
      padding: 0.1em 0.3em;
      font-family: "fontra-ui-regular";
      font-size: 100%;
    }

    .ui-form-value {
      line-height: 1.6em;
    }

    .ui-form-value input {
      width: min(100%, 9.5em);
      height: 1.6em;
    }

    .ui-form-value input[type="checkbox"] {
      width: initial;
      height: initial;
    }

    .ui-form-value input[type="color"] {
      height: 2em;
      width: 4em;
    }

    .ui-form-value input[type="text"] {
      width: 100%;
    }

    .ui-form-value input[type="number"] {
      width: 4em;
    }

    .ui-form-value.edit-number,
    .ui-form-value.edit-number-x-y,
    .ui-form-value.edit-text-double,
    .ui-form-value.universal-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    /* A slider sharing its row with a number input takes whatever the input
       leaves, rather than its natural width, which would push the row wider
       than the panel. */
    .ui-form-value.universal-row range-slider {
      flex: 1 1 auto;
      min-width: 0;
    }

    .ui-form-value.slider-has-checkbox {
      display: grid;
      gap: 0.25em;
      grid-template-columns: auto 1.5em;
    }

    .ui-form-icon {
      overflow-x: unset;
      width: 1.5em;
      height: 1.5em;
      white-space: nowrap;
      margin-left: 1.25em;
      margin-right: 1.25em;
    }

    .ui-form-icon.ui-form-icon-button {
      display: inline-block;
    }

    .ui-form-center {
      display: flex;
      justify-content: center;
      align-items: center;
    }
  `;

  constructor() {
    super();
    this.shadowRoot.appendChild(
      html.link({ href: "/css/tooltip.css", rel: "stylesheet" })
    );
    this.contentElement = this.shadowRoot.appendChild(document.createElement("div"));
    this.contentElement.classList.add("ui-form");
  }

  set labelWidth(width) {
    this.appendStyle(`:host {
      --label-column-width: ${width};
    }`);
  }

  setFieldDescriptions(fieldDescriptions) {
    this.contentElement.innerHTML = "";
    this._fieldGetters = {};
    this._fieldSetters = {};
    this._lastValidFieldValues = {};
    if (!fieldDescriptions) {
      return;
    }
    for (const fieldItem of fieldDescriptions) {
      if (fieldItem.type === "divider") {
        this.contentElement.appendChild(html.hr());
        continue;
      }
      if (fieldItem.type === "line-spacer") {
        this.contentElement.appendChild(html.div({ class: "ui-form-line-spacer" }));
        continue;
      }
      if (fieldItem.type === "spacer") {
        this.contentElement.appendChild(html.br());
        continue;
      }
      if (fieldItem.type === "single-icon") {
        if (fieldItem.element) {
          const valueElement = document.createElement("div");
          valueElement.classList.add("ui-form-full-width");
          valueElement.appendChild(fieldItem.element);
          this.contentElement.appendChild(valueElement);
        }
        continue;
      }

      const labelElement = document.createElement("div");
      labelElement.classList.add("ui-form-label", fieldItem.type);
      const valueElement = document.createElement("div");
      valueElement.classList.add("ui-form-value", fieldItem.type);
      if (fieldItem.width) {
        valueElement.style.width = fieldItem.width;
      }

      let label = fieldItem.label || fieldItem.key || "";
      /* if (label.length && fieldItem.type !== "header") {
        label += ":";
      } */ // Conflicts with colons within localization values
      labelElement.append(label);
      this.contentElement.appendChild(labelElement);
      if (fieldItem.type === "header") {
        if (fieldItem.auxiliaryElement) {
          labelElement.appendChild(fieldItem.auxiliaryElement);
        }
        continue;
      }

      this.contentElement.appendChild(valueElement);

      const methodName = hyphenatedToCamelCase("_add-" + fieldItem.type);
      if (this[methodName] === undefined) {
        throw new Error(`Unknown field type: ${fieldItem.type}`);
      }
      this[methodName](valueElement, fieldItem, labelElement);
      // After the field is built, so its getter and setter exist for the scrub
      // to read the starting value through and write the running one back.
      if (fieldItem.type !== "universal-row") {
        this._attachScrub(labelElement, fieldItem);
      }

      if (fieldItem.onEnterKey) {
        valueElement.addEventListener("keyup", (event) => {
          if (event.key != "Enter") {
            return;
          }
          fieldItem.onEnterKey(event);
        });
      }
    }
  }

  // Dragging a field's label sideways scrubs the number beside it. The pointer
  // events live here; what a pixel is worth lives in number-scrub.js.
  //
  // The label is the grab area rather than the input. An input is a place to
  // select text and type into, and a drag starting inside one fights both — the
  // dead zone alone is not enough to make that pleasant.
  //
  // What goes down the stream is the CHANGE from where the drag started, not the
  // value under the pointer. That is what lets a listener move every selected
  // item by the same amount and keep whatever differences it had, and it is the
  // only thing it can do when the field reads "mixed" and has no value to start
  // from.
  _attachScrub(labelElement, fieldItem) {
    if (!fieldItem?.scrub || fieldItem.disabled || fieldItem.key == null) {
      return;
    }
    const step = fieldItem.scrub === true ? undefined : fieldItem.scrub.step;
    labelElement.classList.add("scrubbable");

    labelElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      // Capture on the label, so a drag that leaves the panel keeps arriving.
      // Without it the value stops the moment the pointer crosses the edge of a
      // 32%-wide column, which is most of any real drag.
      labelElement.setPointerCapture(event.pointerId);
      event.preventDefault();

      const startX = event.clientX;
      const startValue = parseFloat(this._fieldGetters[fieldItem.key]?.());
      // A field showing "mixed" has no value to move away from. The drag still
      // works — the change is what is being sent — but nothing truthful can be
      // shown in the box, so it is left alone.
      const hasStartValue = Number.isFinite(startValue);
      let lastX = startX;
      let change = 0;
      let valueStream = null;
      let streamStarted = false;

      const onMove = (moveEvent) => {
        if (!valueStream) {
          if (Math.abs(moveEvent.clientX - startX) < SCRUB_THRESHOLD) {
            return;
          }
          valueStream = new QueueIterator(5, true);
          // Everything before the threshold was a click, not travel, so the
          // drag starts counting from where it crossed rather than from the
          // press — otherwise the value lurches by the dead zone on the first
          // move that registers.
          lastX = moveEvent.clientX;
        }
        change += scrubIncrement(moveEvent.clientX - lastX, {
          step,
          shiftKey: moveEvent.shiftKey,
          ctrlKey: moveEvent.ctrlKey,
          metaKey: moveEvent.metaKey,
        });
        lastX = moveEvent.clientX;
        if (hasStartValue) {
          const value = clampScrubValue(startValue + change, fieldItem);
          // Fold the clamp back into the travel, so a drag that has run past the
          // end of the range turns around the moment the hand does instead of
          // spending the overshoot first.
          change = value - startValue;
          this._fieldSetters[fieldItem.key]?.(value);
        }
        if (!streamStarted) {
          streamStarted = true;
          this._fieldChanging(fieldItem, change, valueStream);
        }
        valueStream.put(change);
        this._dispatchEvent("doChange", { key: fieldItem.key, value: change });
      };

      const onUp = () => {
        labelElement.removeEventListener("pointermove", onMove);
        labelElement.removeEventListener("pointerup", onUp);
        labelElement.removeEventListener("pointercancel", onUp);
        labelElement.releasePointerCapture?.(event.pointerId);
        if (!valueStream) {
          // Never crossed the dead zone: this was a click and nothing happened.
          return;
        }
        valueStream.done();
        this._dispatchEvent("endChange", { key: fieldItem.key });
      };

      labelElement.addEventListener("pointermove", onMove);
      labelElement.addEventListener("pointerup", onUp);
      labelElement.addEventListener("pointercancel", onUp);
    });
  }

  _addUniversalRow(valueElement, fieldItem, labelElement) {
    for (const [i, field] of enumerate([
      fieldItem.field1,
      fieldItem.field2,
      fieldItem.field3,
    ])) {
      const element = i === 0 ? labelElement : valueElement;
      const methodName = hyphenatedToCamelCase("_add-" + field.type);
      if (this[methodName]) {
        this[methodName](element, field, field.allowEmptyField);
      }
      if (field.auxiliaryElement) {
        element.appendChild(field.auxiliaryElement, field);
      }
      // A packed row has no label of its own to grab, so a scrubbable field in
      // one drives from whatever sits in the label column — which is field1.
      this._attachScrub(labelElement, field);
    }
  }

  _addHeader(valueElement, fieldItem) {
    this._addText(valueElement, fieldItem);
  }

  _addNumber(valueElement, fieldItem) {
    this._addText(valueElement, fieldItem);
  }

  _addText(valueElement, fieldItem) {
    if (fieldItem.value !== undefined) {
      valueElement.innerText = fieldItem.value;
      this._fieldGetters[fieldItem.key] = () => valueElement.innerText;
      this._fieldSetters[fieldItem.key] = (value) => (valueElement.innerText = value);
    }
  }

  _addEditText(valueElement, fieldItem) {
    const inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.value = fieldItem.value || "";
    inputElement.disabled = fieldItem.disabled;
    inputElement.onchange = (event) => {
      this._fieldChanging(fieldItem, inputElement.value, undefined);
    };
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (inputElement.value = value);
    valueElement.appendChild(inputElement);
  }

  _addEditTextDouble(valueElement, fieldItem) {
    this._addEditText(valueElement, fieldItem.field1);
    this._addEditText(valueElement, fieldItem.field2);
  }

  _addEditNumberXY(valueElement, fieldItem) {
    this._addEditNumber(valueElement, fieldItem.fieldX);
    this._addEditNumber(valueElement, fieldItem.fieldY);
  }

  _addEditNumber(valueElement, fieldItem, allowEmptyField = false) {
    if (fieldItem.evaluateExpression) {
      return this._addEditNumberExpression(valueElement, fieldItem, allowEmptyField);
    }

    this._lastValidFieldValues[fieldItem.key] = fieldItem.value;
    const inputElement = document.createElement("input");
    inputElement.type = "number";
    inputElement.value = maybeRound(fieldItem.value, fieldItem.numDigits);

    if (fieldItem["data-tooltip"]) {
      // data-tooltip doesn't work for input number,
      // default title is used
      inputElement.setAttribute("title", fieldItem["data-tooltip"]);
    }

    if ("minValue" in fieldItem) {
      inputElement.min = fieldItem.minValue;
    }
    if ("maxValue" in fieldItem) {
      inputElement.max = fieldItem.maxValue;
    }
    inputElement.step = "any";
    if (fieldItem.integer) {
      inputElement.pattern = "\\d*";
      inputElement.step = 1;
    }

    inputElement.disabled = fieldItem.disabled;
    inputElement.onkeydown = (event) => {
      if (event.shiftKey) {
        switch (event.key) {
          case "ArrowUp":
            // We add to the "regular" +1 increment
            event.target.value = event.target.valueAsNumber + 9;
            break;

          case "ArrowDown":
            // We add to the "regular" -1 increment
            event.target.value = event.target.valueAsNumber - 9;
            break;
        }
      }
    };
    inputElement.onchange = (event) => {
      let value;
      if (allowEmptyField && inputElement.value === "") {
        value = null;
      } else {
        value = parseFloat(inputElement.value);
        if (isNaN(value)) {
          value = this._lastValidFieldValues[fieldItem.key];
          inputElement.value = value;
        }
      }

      if (!inputElement.reportValidity()) {
        if (inputElement.min != undefined) {
          value = Math.max(value, inputElement.min);
        }
        if (inputElement.max != undefined) {
          value = Math.min(value, inputElement.max);
        }
        inputElement.value = value;
      }
      this._lastValidFieldValues[fieldItem.key] = value;
      this._fieldChanging(fieldItem, value, undefined);
    };
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) =>
      (inputElement.value = maybeRound(value, fieldItem.numDigits));
    valueElement.appendChild(inputElement);
  }

  _addEditNumberExpression(valueElement, fieldItem, allowEmptyField = false) {
    this._lastValidFieldValues[fieldItem.key] = fieldItem.value;
    const inputElement = document.createElement("input");
    inputElement.value = maybeRoundToString(fieldItem.value, fieldItem.numDigits);

    if (fieldItem["data-tooltip"]) {
      // data-tooltip doesn't work for input number,
      // default title is used
      inputElement.setAttribute("title", fieldItem["data-tooltip"]);
    }

    inputElement.disabled = fieldItem.disabled;
    inputElement.onkeydown = (event) => {
      const increment = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case "ArrowUp": {
          event.preventDefault();
          let value = Number(event.target.value) + increment;
          if (fieldItem.maxValue != undefined) {
            value = Math.min(value, fieldItem.maxValue);
          }
          event.target.value = value;
          this._fieldChanging(fieldItem, value, undefined);
          break;
        }
        case "ArrowDown": {
          event.preventDefault();
          let value = Number(event.target.value) - increment;
          if (fieldItem.minValue != undefined) {
            value = Math.max(value, fieldItem.minValue);
          }
          event.target.value = value;
          this._fieldChanging(fieldItem, value, undefined);
          break;
        }
      }
    };

    inputElement.oninput = (event) => {
      inputElement.setCustomValidity("");
    };

    inputElement.onchange = async (event) => {
      let value, valueObject, validitationError;
      if (allowEmptyField && inputElement.value === "") {
        value = null;
      } else {
        assert(fieldItem.evaluateExpression);
        value = await fieldItem.evaluateExpression(inputElement.value);
        if (typeof value !== "number" && typeof value !== "string") {
          valueObject = value;
          value = value.value;
          if (valueObject.error) {
            validitationError = valueObject.error;
            value = this._lastValidFieldValues[fieldItem.key];
            valueObject = undefined;
          }
          inputElement.value = maybeRoundToString(value, fieldItem.numDigits);
        }

        if (!valueObject) {
          if (isNaN(value)) {
            value = this._lastValidFieldValues[fieldItem.key];
            inputElement.value = maybeRoundToString(value, fieldItem.numDigits);
          }
          if (fieldItem.minValue != undefined && value < fieldItem.minValue) {
            validitationError = "value below minimum";
          } else if (fieldItem.maxValue != undefined && value > fieldItem.maxValue) {
            validitationError = "value above minimum";
          }
        }
      }

      inputElement.setCustomValidity(validitationError || "");

      if (!inputElement.reportValidity()) {
        if (fieldItem.minValue != undefined) {
          value = Math.max(value, fieldItem.minValue);
        }
        if (fieldItem.maxValue != undefined) {
          value = Math.min(value, inputElement.max);
        }
        inputElement.value = value;
      }

      this._lastValidFieldValues[fieldItem.key] = value;
      this._fieldChanging(fieldItem, valueObject || value, undefined);
    };
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) =>
      (inputElement.value = maybeRoundToString(value, fieldItem.numDigits));
    valueElement.appendChild(inputElement);
  }

  _addEditAngle(valueElement, fieldItem) {
    this._lastValidFieldValues[fieldItem.key] = fieldItem.value;
    const inputElement = html.input({
      type: "number",
      value: fieldItem.value,
      step: "any",
      disabled: fieldItem.disabled,
      onchange: () => {
        let value = parseFloat(inputElement.value);
        if (isNaN(value)) {
          value = this._lastValidFieldValues[fieldItem.key];
          inputElement.value = value;
        }
        this._lastValidFieldValues[fieldItem.key] = value;
        this._fieldChanging(fieldItem, value);
        rotaryControl.value = -value;
      },
    });
    const rotaryControl = html.createDomElement("rotary-control", {
      value: -fieldItem.value,
    });
    {
      // Rotary change closure
      let valueStream;

      rotaryControl.onChangeCallback = (event) => {
        const value = -event.value;
        inputElement.value = value;
        if (event.dragBegin) {
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        if (valueStream) {
          valueStream.put(value);
          this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
          if (event.dragEnd) {
            valueStream.done();
            valueStream = undefined;
            this._dispatchEvent("endChange", { key: fieldItem.key });
          }
        } else {
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (inputElement.value = value);
    valueElement.appendChild(
      html.div({ style: "display: flex; gap: 0.15rem;" }, [inputElement, rotaryControl])
    );
  }

  _addEditNumberSlider(valueElement, fieldItem) {
    const rangeElement = new RangeSlider();
    rangeElement.value = getInitialValueWithFallback(fieldItem);
    rangeElement.minValue = fieldItem.minValue;
    rangeElement.defaultValue = fieldItem.defaultValue;
    rangeElement.maxValue = fieldItem.maxValue;
    if (fieldItem.displayValue !== undefined) {
      rangeElement.displayValue = fieldItem.displayValue;
    }
    if (fieldItem.values !== undefined) {
      rangeElement.values = fieldItem.values;
    }
    if (fieldItem.step !== undefined) {
      rangeElement.step = fieldItem.step;
    }
    if (fieldItem.allowInputBeyondRange) {
      rangeElement.allowInputBeyondRange = true;
    }
    if (fieldItem.disabled) {
      rangeElement.disabled = true;
    }

    let checkboxElement;
    if (fieldItem.hasCheckBox) {
      checkboxElement = html.input({
        type: "checkbox",
        checked: fieldItem.value !== undefined,
        onchange: (event) => {
          const isChecked = event.target.checked;
          const changeToValue = isChecked ? rangeElement.value : null;
          this._fieldChanging(fieldItem, changeToValue, undefined);
        },
      });
      valueElement.classList.add("slider-has-checkbox");
    }

    {
      // Slider change closure
      let valueStream = undefined;

      rangeElement.onChangeCallback = (event) => {
        const value = event.value;
        if (event.dragBegin) {
          // A second begin without an end in between would abandon the first
          // stream still open, and a listener consuming it keeps its edit open
          // with it — after which every later edit is refused. Close the old one
          // rather than letting it strand.
          valueStream?.done();
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        if (valueStream) {
          valueStream.put(value);
          this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
          if (event.dragEnd) {
            valueStream.done();
            valueStream = undefined;
            this._dispatchEvent("endChange", { key: fieldItem.key });
            // mark checkbox as used
            if (checkboxElement) {
              checkboxElement.checked = true;
            }
          }
        } else {
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    // Sliders were the only editable field type with no getter/setter, so
    // form.getValue() could not read one back. Callers were left inferring the
    // value from onFieldChange, which during a drag reports the value from
    // *before* the drag and streams the rest — easy to get wrong, and invisible
    // when you do.
    this._fieldGetters[fieldItem.key] = () => rangeElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (rangeElement.value = value);

    valueElement.appendChild(rangeElement);
    if (checkboxElement) {
      valueElement.appendChild(checkboxElement);
    }
  }

  _addCheckbox(valueElement, fieldItem) {
    const inputElement = html.input({
      type: "checkbox",
      checked: !!fieldItem.value,
      disabled: !!fieldItem.disabled,
      onchange: (event) => {
        this._fieldChanging(fieldItem, inputElement.checked, undefined);
      },
    });
    if (fieldItem.indeterminate) {
      inputElement.indeterminate = true;
    }
    this._fieldGetters[fieldItem.key] = () => inputElement.checked;
    this._fieldSetters[fieldItem.key] = (value) => (inputElement.checked = !!value);
    valueElement.appendChild(inputElement);
  }

  _addSelect(valueElement, fieldItem) {
    const selectElement = html.select(
      {
        disabled: !!fieldItem.disabled,
        onchange: (event) => {
          this._fieldChanging(fieldItem, selectElement.value, undefined);
        },
      },
      (fieldItem.options || []).map((option) =>
        html.option(
          {
            value: option.value,
            selected: option.value === fieldItem.value,
            disabled: !!option.disabled,
          },
          [option.label ?? option.value]
        )
      )
    );
    this._fieldGetters[fieldItem.key] = () => selectElement.value;
    this._fieldSetters[fieldItem.key] = (value) => (selectElement.value = value);
    valueElement.appendChild(selectElement);
  }

  _addColorPicker(valueElement, fieldItem) {
    const parseColor = fieldItem.parseColor || ((v) => v);
    const formatColor = fieldItem.formatColor || ((v) => v);

    let checkboxElement;
    const colorInputElement = html.input({ type: "color" });
    colorInputElement.value = formatColor(fieldItem.value);

    {
      // color picker change closure
      let valueStream = undefined;

      const oninputFunc = scheduleCalls((event) => {
        if (checkboxElement) {
          checkboxElement.checked = true;
        }
        const value = parseColor(colorInputElement.value);
        if (!valueStream) {
          valueStream = new QueueIterator(5, true);
          this._fieldChanging(fieldItem, value, valueStream);
        }

        valueStream.put(value);
        this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
      }, fieldItem.continuousDelay || 0);

      let oninputTimer;

      colorInputElement.oninput = (event) => {
        oninputTimer = oninputFunc(event);
      };

      colorInputElement.onchange = (event) => {
        if (checkboxElement) {
          checkboxElement.checked = true;
        }
        if (oninputTimer) {
          clearTimeout(oninputTimer);
          oninputTimer = undefined;
        }
        if (valueStream) {
          valueStream.done();
          valueStream = undefined;
          this._dispatchEvent("endChange", { key: fieldItem.key });
        } else {
          const value = parseColor(colorInputElement.value);
          this._fieldChanging(fieldItem, value, undefined);
        }
      };
    }

    valueElement.appendChild(colorInputElement);

    if (fieldItem.allowNoColor) {
      checkboxElement = html.input({
        type: "checkbox",
        checked: !!fieldItem.value,
        onchange: (event) => {
          this._fieldChanging(
            fieldItem,
            checkboxElement.checked ? parseColor(colorInputElement.value) : undefined,
            undefined
          );
        },
      });
      valueElement.appendChild(checkboxElement);
    }
  }

  addEventListener(eventName, handler, options) {
    this.contentElement.addEventListener(eventName, handler, options);
  }

  _fieldChanging(fieldItem, value, valueStream) {
    if (valueStream) {
      this._dispatchEvent("beginChange", { key: fieldItem.key });
    } else {
      this._dispatchEvent("doChange", { key: fieldItem.key, value: value });
    }
    const handlerName = "onFieldChange";
    if (this[handlerName] !== undefined) {
      this[handlerName](fieldItem, value, valueStream);
    }
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      bubbles: false,
      detail: detail,
    });
    this.contentElement.dispatchEvent(event);
  }

  getKeys() {
    return Object.keys(this._fieldGetters);
  }

  hasKey(key) {
    return key in this._fieldGetters;
  }

  getValue(key) {
    const getter = this._fieldGetters[key];
    if (getter === undefined) {
      throw new Error(`getting unknown Form key: ${key}`);
    }
    return getter();
  }

  setValue(key, value) {
    if (!this._fieldSetters) {
      // The object isn't functional yet, eg. before a call to setFieldDescriptions()
      // This happens when the Form is in a sidebar that hasn't been visible yet.
      return;
    }
    const setter = this._fieldSetters[key];
    if (setter === undefined) {
      throw new Error(`setting unknown Form key: ${key}`);
    }
    setter(value);
  }
}

function maybeRound(value, digits) {
  return digits == undefined || value == undefined ? value : round(value, digits);
}

function maybeRoundToString(value, digits) {
  return value == undefined ? "" : digits == undefined ? value : round(value, digits);
}

function getInitialValueWithFallback(fieldItem) {
  return fieldItem.value ?? fieldItem.fallbackValue ?? fieldItem.defaultValue;
}

customElements.define("ui-form", Form);
