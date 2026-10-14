import { UnlitElement, div, input, label } from "@fontra/core/html-utils.js";
import { makeCheckmark } from "./ui-checkmark.js";

export class SimpleSettings extends UnlitElement {
  static styles = `
    .header {
      margin-top: 0.6em;
      margin-bottom: 0.2em;
      font-weight: bold;
    }
  `;

  get model() {
    return this.controller?.model;
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
      if (this._keys.has(event.key)) {
        this.requestUpdate();
      }
    };
    this._controller?.addListener(this._modelListener);
    this.requestUpdate();
  }

  get descriptions() {
    return this._descriptions;
  }

  set descriptions(descriptions) {
    this._descriptions = descriptions;
    this._keys = new Set(descriptions.map((description) => description.key));
    this.requestUpdate();
  }

  render() {
    if (!this._descriptions) {
      return;
    }

    return this._descriptions.map((description) =>
      uiTypes[description.ui](this, description, this.controller)
    );
  }
}

const uiTypes = {
  header(settingsElement, description, controller) {
    return div({ class: "header" }, [description.displayName]);
  },

  plain(settingsElement, description, controller) {
    return div({ class: "plain" }, [description.displayName]);
  },

  checkbox(settingsElement, description, controller) {
    return div({}, [
      makeCheckmark(
        controller.model[description.key],
        description.displayName,
        (checked) => controller.setItem(description.key, checked, settingsElement)
      ),
    ]);
  },

  radio(settingsElement, description, controller) {
    const id = `simple-settings.${description.key}`;

    return [
      description.displayName
        ? div({ class: "header" }, [description.displayName])
        : "",
      ...description.options.map((option) => {
        const itemID = `${id}.${option.key}`;
        return div({}, [
          input({
            type: "radio",
            id: itemID,
            name: id,
            value: option.key,
            onchange: (event) =>
              controller.setItem(description.key, event.target.value, settingsElement),
            checked: controller.model[description.key] == option.key,
          }),
          label({ for: itemID }, [option.displayName]),
        ]);
      }),
    ];
  },
};

customElements.define("simple-settings", SimpleSettings);
