import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import "@fontra/web-components/multi-select-dropdown.js";

// A section header's preset control: a dropdown, Add and Update. Generation
// carries one for width presets (ticket 49) and Terminal one for the Square,
// Rounded and Ball presets (ticket 56); this is the one copy of it (rail R-B).
//
// Picking an entry applies it at once. The dropdown shows no picked state: no
// check mark stays on and the label stays "Preset". Update writes over the
// entry picked last, which is remembered here without being shown.
//
// The caller owns the list, the capture and the writes. Items carry whatever
// value the caller needs to find the entry again, typically its index in the
// stored list.
export class PresetHeaderControl {
  constructor({ onPick, onAdd, onUpdate }) {
    this.lastPicked = null;
    this.dropdown = html.createDomElement("multi-select-dropdown", {
      label: translate("sidebar.skeleton-parameters.width-preset"),
    });
    this.dropdown.singleChoice = true;
    this.dropdown.addEventListener("change", (event) => {
      const [value] = [].concat(event.detail.checked);
      for (const item of this.dropdown.items) {
        item.checked = false;
      }
      if (value == null) {
        return;
      }
      this.lastPicked = value;
      onPick(value);
    });
    this.addButton = html.button({ onclick: () => onAdd() }, [
      translate("sidebar.skeleton-parameters.width-preset.add"),
    ]);
    this.updateButton = html.button(
      {
        onclick: () => {
          if (this.lastPicked != null) {
            onUpdate(this.lastPicked);
          }
        },
      },
      [translate("sidebar.skeleton-parameters.width-preset.update")]
    );
    this.element = html.div(
      {
        style: "display: flex; gap: 0.35rem; align-items: center; font-weight: normal;",
      },
      [this.dropdown, this.addButton, this.updateButton]
    );
  }

  // `items` is [{value, label}]. A list with nothing in it shows one greyed
  // entry, because an empty list opened as an empty frame.
  refresh({ items, canCapture }) {
    if (
      this.lastPicked != null &&
      !items.some((item) => item.value === this.lastPicked)
    ) {
      this.lastPicked = null;
    }
    this.dropdown.items = items.length
      ? items.map((item) => ({ ...item, checked: false }))
      : [
          {
            value: null,
            label: translate("sidebar.skeleton-parameters.width-preset.none"),
            disabled: true,
          },
        ];
    this.addButton.disabled = !canCapture;
    this.updateButton.disabled = !canCapture || this.lastPicked == null;
  }
}
