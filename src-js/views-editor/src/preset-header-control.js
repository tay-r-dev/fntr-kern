import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import "@fontra/web-components/icon-button.js";
import { showMenu } from "@fontra/web-components/menu-panel.js";
import "@fontra/web-components/multi-select-dropdown.js";

// A section header's preset control: Add, Update, Lock, Refresh and a dropdown.
// Generation carries one for width presets (ticket 49) and Terminal one for the
// Square, Rounded, Ball and Serif presets (tickets 56, 60); this is the one copy
// of it (rail R-B). A button whose callback the caller leaves out is not drawn.
//
// Picking an entry applies it at once. Update writes over the entry picked
// last, which is remembered here. By default the dropdown shows no picked
// state and Update is live whenever a pick and a capture exist. A caller can
// ask for the picked entry to show (a check and its name on the button), for
// Update to be live only when it says so, and for Update to take two presses.
//
// Lock binds the selection to the picked preset, and shows lit while it is
// bound. Refresh brings bound points back to their presets, and shows lit while
// a preset has changed since. Neither changes anything on its own.
//
// The caller owns the list, the capture and the writes. Items carry whatever
// value the caller needs to find the entry again, typically its index in the
// stored list, and may carry a shorter `name` for the button.
const TILE = "1.8em";

export class PresetHeaderControl {
  constructor({ onPick, onAdd, onUpdate, onLock, onRefresh, onReset }) {
    this.lastPicked = null;
    this._updateArmed = false;
    this._confirmUpdate = false;
    this.dropdown = html.createDomElement("multi-select-dropdown", {
      label: translate("sidebar.skeleton-parameters.width-preset"),
    });
    this.dropdown.style.setProperty("--multi-select-dropdown-height", TILE);
    // One fixed width for every preset dropdown, so a longer name does not move
    // the buttons beside it; a name that does not fit ends in an ellipsis. In
    // rem, not em: the Generation dropdown sits in a section heading and the
    // Terminal one in a row, and the two do not share a font size.
    this.dropdown.style.setProperty("--multi-select-dropdown-width", "8.5rem");
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
    // Right-click offers Reset to default: the selection goes back to the
    // kind's own defaults and the dropdown shows no preset.
    if (onReset) {
      this.dropdown.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showMenu(
          [
            {
              title: translate("sidebar.skeleton-parameters.width-preset.reset"),
              enabled: () => !this._resetDisabled,
              callback: () => {
                this.lastPicked = null;
                this._disarmUpdate();
                onReset();
              },
            },
          ],
          { x: event.clientX, y: event.clientY }
        );
      });
    }
    // Square tiles, the same size as the tiles in a Generation tray. The glyph
    // is inset, so it sits centred.
    const iconButton = (src, tooltipKey, onclick) => {
      const button = html.createDomElement("icon-button", {
        "src": src,
        "data-tooltip": translate(tooltipKey),
        "data-tooltipposition": "top",
        "style": `display: block; box-sizing: border-box; width: ${TILE}; height: ${TILE}; padding: 0.4em;`,
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
    this.updateButton = onUpdate
      ? iconButton(
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
        )
      : null;
    this.lockButton = onLock
      ? iconButton(
          "/tabler-icons/lock.svg",
          "sidebar.skeleton-parameters.width-preset.lock",
          () => onLock(this.lastPicked)
        )
      : null;
    this.refreshButton = onRefresh
      ? iconButton(
          "/tabler-icons/refresh.svg",
          "sidebar.skeleton-parameters.width-preset.refresh",
          () => onRefresh()
        )
      : null;
    this.element = html.div(
      {
        style: "display: flex; gap: 0.1rem; align-items: center; font-weight: normal;",
      },
      [
        this.addButton,
        this.refreshButton,
        this.lockButton,
        this.updateButton,
        this.dropdown,
      ].filter(Boolean)
    );
  }

  _disarmUpdate() {
    this._updateArmed = false;
    if (!this.updateButton) {
      return;
    }
    this.updateButton.on = false;
    this.updateButton.setAttribute(
      "data-tooltip",
      translate("sidebar.skeleton-parameters.width-preset.update")
    );
  }

  // `items` is [{value, label, name}]. A list with nothing in it shows one
  // greyed entry, because an empty list opened as an empty frame.
  //
  // `showPicked` checks the picked entry and puts its name on the button.
  // `updateEnabled`, when given, is the caller's word on whether Update is
  // live. `confirmUpdate` makes Update take two presses. `bond` is the
  // selection's bond: `locked` (true, false or "mixed"), `lockEnabled`,
  // `stale` and `refreshEnabled`.
  refresh({
    items,
    canCapture,
    showPicked = false,
    updateEnabled,
    confirmUpdate = false,
    bond = null,
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
        ? (picked.name ?? picked.label)
        : translate("sidebar.skeleton-parameters.width-preset");
    this.addButton.disabled = !canCapture;
    this._resetDisabled = !bond?.resetEnabled;
    if (this.lockButton) {
      this.lockButton.on = bond?.locked === true;
      this.lockButton.mixed = bond?.locked === "mixed";
      this.lockButton.disabled = !bond?.lockEnabled;
    }
    if (this.refreshButton) {
      this.refreshButton.on = !!bond?.stale;
      this.refreshButton.disabled = !bond?.refreshEnabled;
    }
    if (!this.updateButton) {
      return;
    }
    this._confirmUpdate = confirmUpdate;
    const updateLive = updateEnabled ?? (canCapture && this.lastPicked != null);
    this.updateButton.disabled = !updateLive;
    if (!updateLive) {
      this._disarmUpdate();
    }
  }
}
