import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import "@fontra/web-components/icon-button.js";
import "@fontra/web-components/multi-select-dropdown.js";

// A section header's preset control: a dropdown, Add and Update. Generation
// carries one for width presets (ticket 49) and Terminal one for the Square,
// Rounded, Ball and Serif presets (tickets 56, 60); this is the one copy of it
// (rail R-B).
//
// Picking an entry applies it at once. Update writes over the entry picked
// last, which is remembered here. By default the dropdown shows no picked
// state and Update is live whenever a pick and a capture exist. A caller can
// ask for the picked entry to show (a check and its name on the button), for
// Update to be live only when it says so, and for Update to take two presses.
//
// The caller owns the list, the capture and the writes. Items carry whatever
// value the caller needs to find the entry again, typically its index in the
// stored list.
export class PresetHeaderControl {
  constructor({ onPick, onAdd, onUpdate }) {
    this.lastPicked = null;
    this._updateArmed = false;
    this._confirmUpdate = false;
    this.dropdown = html.createDomElement("multi-select-dropdown", {
      label: translate("sidebar.skeleton-parameters.width-preset"),
    });
    this.dropdown.singleChoice = true;
    this.dropdown.addEventListener("change", (event) => {
      const [value] = [].concat(event.detail.checked);
      if (value == null) {
        return;
      }
      this.lastPicked = value;
      this._disarmUpdate();
      onPick(value);
    });
    // Add and Update are the design's plus and arrow-up icons, ahead of the
    // dropdown. An armed Update shows lit, and its tooltip asks for the second
    // press.
    const iconButton = (src, tooltipKey, onclick) => {
      const button = html.createDomElement("icon-button", {
        "src": src,
        "data-tooltip": translate(tooltipKey),
        "data-tooltipposition": "top",
        "style": "width: 1.1em; height: 1.1em; padding: 0.15em;",
      });
      button.onclick = onclick;
      return button;
    };
    this.addButton = iconButton(
      "/images/preset-add.svg",
      "sidebar.skeleton-parameters.width-preset.add",
      () => {
        this._disarmUpdate();
        onAdd();
      }
    );
    this.updateButton = iconButton(
      "/images/preset-update.svg",
      "sidebar.skeleton-parameters.width-preset.update",
      () => {
        if (this.lastPicked == null) {
          return;
        }
        if (this._confirmUpdate && !this._updateArmed) {
          this._updateArmed = true;
          this.updateButton.on = true;
          this.updateButton.setAttribute(
            "data-tooltip",
            translate("sidebar.skeleton-parameters.width-preset.update-confirm")
          );
          return;
        }
        this._disarmUpdate();
        onUpdate(this.lastPicked);
      }
    );
    this.element = html.div(
      {
        style: "display: flex; gap: 0.2rem; align-items: center; font-weight: normal;",
      },
      [this.addButton, this.updateButton, this.dropdown]
    );
  }

  _disarmUpdate() {
    this._updateArmed = false;
    this.updateButton.on = false;
    this.updateButton.setAttribute(
      "data-tooltip",
      translate("sidebar.skeleton-parameters.width-preset.update")
    );
  }

  // `items` is [{value, label}]. A list with nothing in it shows one greyed
  // entry, because an empty list opened as an empty frame.
  //
  // `showPicked` checks the picked entry and puts its name on the button.
  // `updateEnabled`, when given, is the caller's word on whether Update is
  // live. `confirmUpdate` makes Update take two presses.
  refresh({
    items,
    canCapture,
    showPicked = false,
    updateEnabled,
    confirmUpdate = false,
  }) {
    if (
      this.lastPicked != null &&
      !items.some((item) => item.value === this.lastPicked)
    ) {
      this.lastPicked = null;
    }
    const picked = items.find((item) => item.value === this.lastPicked);
    this.dropdown.items = items.length
      ? items.map((item) => ({
          ...item,
          checked: showPicked && item.value === this.lastPicked,
        }))
      : [
          {
            value: null,
            label: translate("sidebar.skeleton-parameters.width-preset.none"),
            disabled: true,
          },
        ];
    this.dropdown.label =
      showPicked && picked
        ? picked.label
        : translate("sidebar.skeleton-parameters.width-preset");
    this.addButton.disabled = !canCapture;
    this._confirmUpdate = confirmUpdate;
    const updateLive = updateEnabled ?? (canCapture && this.lastPicked != null);
    this.updateButton.disabled = !updateLive;
    if (!updateLive) {
      this._disarmUpdate();
    }
  }
}
