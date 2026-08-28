import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { markerGeometry } from "@fontra/core/marker-measure.js";
import { getMarkerGroups, getMarkers } from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { round, throttleCalls } from "@fontra/core/utils.ts";
import { Form } from "@fontra/web-components/ui-form.js";
import {
  createGroup,
  deleteGroup,
  deleteMarkers,
  renameGroup,
  setGroupVisible,
  setMarkerGroup,
  setMarkerTarget,
  setMarkerVisible,
} from "./marker-editing.js";
import Panel from "./panel.js";

// The panel reads; every write goes through marker-editing.js. It never touches the
// stored section itself.

export default class MarkersPanel extends Panel {
  identifier = "markers";
  iconPath = "/tabler-icons/ruler-measure.svg";

  constructor(editorController) {
    super(editorController);
    this.infoForm = new Form();
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.infoForm]
      )
    );
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;

    this._lastFormLayout = null;
    this._activeFieldKey = null;

    this.updateBound = this.update.bind(this);
    this._throttledUpdate = throttleCalls(() => this.update(), 100);

    this.sceneController.addCurrentGlyphChangeListener(() => this._throttledUpdate());
    this.sceneSettingsController.addKeyListener(
      [
        "fontLocationSourceMapped",
        "selectedGlyphName",
        "selection",
        "editingLayers",
        "editLayerName",
      ],
      this.updateBound
    );
  }

  getContentElement() {
    return html.div({ class: "panel" }, []);
  }

  // A hosted panel has to refresh on the rebuild that re-attaches its host, or it draws
  // nothing until something else moves it. The letterspacer and skeleton-defaults panels
  // both had this and both had to be fixed.
  async toggle(on) {
    if (on) {
      await this.update();
    }
  }

  _getPositionedGlyph() {
    return this.sceneController.sceneModel?.getSelectedPositionedGlyph?.() || null;
  }

  _getEditLayerGlyph(positionedGlyph) {
    const editLayerName =
      this.sceneController.sceneSettings?.editLayerName ||
      positionedGlyph.glyph?.layerName;
    return (
      (editLayerName &&
        positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph) ||
      positionedGlyph.glyph
    );
  }

  async update() {
    const positionedGlyph = this._getPositionedGlyph();
    const formContents = [
      { type: "header", label: translate("sidebar.markers.title") },
    ];

    if (!positionedGlyph) {
      formContents.push({
        type: "text",
        value: translate("sidebar.markers.no-glyph"),
      });
      this._applyFormContents(formContents);
      return;
    }

    const layerGlyph = this._getEditLayerGlyph(positionedGlyph);
    const skeletonData = getSkeletonData(layerGlyph);
    const markers = getMarkers(layerGlyph);
    const groups = getMarkerGroups(layerGlyph);
    this._markers = markers;

    if (!markers.length) {
      formContents.push({
        type: "text",
        value: translate("sidebar.markers.none"),
      });
    }

    // A marker is one row: what it measures, the number it is aiming at, and the group
    // it answers to. The menu is the only place a marker joins a group, so it lists
    // every group plus the ungrouped case.
    const groupOptions = [
      { value: "", label: translate("sidebar.markers.no-group") },
      ...groups.map((group) => ({ value: group.id, label: group.name })),
    ];

    for (const marker of markers) {
      const geometry = markerGeometry(positionedGlyph.glyph, marker, skeletonData);
      const measurement = geometry.stale
        ? translate("sidebar.markers.broken")
        : geometry.distance === null
          ? "—"
          : String(round(geometry.distance, 1));
      const delta =
        !geometry.stale &&
        geometry.distance !== null &&
        marker.target !== undefined &&
        marker.target !== null
          ? round(geometry.distance - marker.target, 1)
          : null;

      formContents.push({
        type: "universal-row",
        field1: {
          type: "text",
          key: `measure:${marker.id}`,
          value: delta === null ? measurement : `${measurement} (${signed(delta)})`,
        },
        field2: {
          type: "edit-number",
          key: `target:${marker.id}`,
          value: marker.target ?? "",
          allowEmptyField: true,
        },
        field3: {
          type: "select",
          key: `group:${marker.id}`,
          value: marker.groupId || "",
          options: groupOptions,
          auxiliaryElement: html.span({}, [
            html.button(
              {
                class: "marker-row-button",
                title: translate(
                  marker.hidden
                    ? "sidebar.markers.show-marker"
                    : "sidebar.markers.hide-marker"
                ),
                onclick: () => this.setMarkerVisible(marker.id, !!marker.hidden),
              },
              [marker.hidden ? "◌" : "●"]
            ),
            this._removeButton(translate("sidebar.markers.delete-marker"), () =>
              this.deleteMarker(marker.id)
            ),
          ]),
        },
        // The eye is drawn, not set, so the row has to be rebuilt when it changes.
        flags: marker.hidden ? "hidden" : "",
      });
    }

    // Groups carry visibility and a name, nothing else. Deleting one leaves its markers
    // in place and ungrouped.
    formContents.push({ type: "divider" });
    for (const group of groups) {
      formContents.push({
        type: "universal-row",
        field1: {
          type: "checkbox",
          key: `groupVisible:${group.id}`,
          value: group.visible !== false,
        },
        field2: {
          type: "edit-text",
          key: `groupName:${group.id}`,
          value: group.name,
          auxiliaryElement: this._removeButton(
            translate("sidebar.markers.delete-group"),
            () => this.deleteGroup(group.id)
          ),
        },
      });
    }
    formContents.push({
      type: "single-icon",
      element: html.button(
        {
          onclick: () =>
            this.createGroup(
              `${translate("sidebar.markers.group")} ${groups.length + 1}`
            ),
        },
        [translate("sidebar.markers.new-group")]
      ),
    });

    this._applyFormContents(formContents);
    this.infoForm.onFieldChange = (fieldItem, value, valueStream) =>
      this._onFieldChange(fieldItem, value, valueStream);
  }

  _removeButton(title, onclick) {
    return html.button({ class: "marker-row-button", title, onclick }, ["×"]);
  }

  // Handing the form a new set of field descriptions rebuilds every input from scratch,
  // which throws away focus and any in-flight interaction: an arrow key in a number
  // input would apply once and then stop. When only the VALUES moved — the common case,
  // since editing a marker is what triggers the update — the existing inputs are still
  // the right ones and just need their values pushed in.
  _applyFormContents(formContents) {
    const layout = formContents
      .map((item) =>
        item.type === "universal-row"
          ? [
              item.type,
              item.flags ?? "",
              ...packedFields(item).map((field) => field.key ?? ""),
            ].join(" ")
          : [item.type, item.key ?? "", item.label ?? ""].join(" ")
      )
      .join("");
    if (layout === this._lastFormLayout) {
      const fields = formContents.flatMap((item) =>
        item.type === "universal-row" ? packedFields(item) : [item]
      );
      for (const item of fields) {
        if (item.key == null || !this.infoForm.hasKey(item.key)) {
          continue;
        }
        if (item.key === this._activeFieldKey) {
          continue;
        }
        this.infoForm.setValue(item.key, item.value);
      }
      return;
    }
    this._lastFormLayout = layout;
    this.infoForm.setFieldDescriptions(formContents);
  }

  async _onFieldChange(fieldItem, value, valueStream) {
    const [kind, id] = String(fieldItem.key || "").split(":");
    this._activeFieldKey = fieldItem.key;
    try {
      if (kind === "target") {
        await setMarkerTarget(this.sceneController, id, valueOrUndefined(value));
      } else if (kind === "group") {
        await this.assignGroup(id, value || undefined);
      } else if (kind === "groupVisible") {
        await setGroupVisible(this.sceneController, id, !!value);
      } else if (kind === "groupName") {
        await this.renameGroup(id, value);
      }
    } finally {
      this._activeFieldKey = null;
    }
  }

  // Panel-side commands, for whatever calls them: the context menu, a button row, or a
  // test. They exist so nothing outside this file needs to know the write path.
  async deleteMarker(id) {
    await deleteMarkers(this.sceneController, [id]);
  }

  async setMarkerVisible(id, visible) {
    await setMarkerVisible(this.sceneController, id, visible);
  }

  async createGroup(name) {
    await createGroup(this.sceneController, name);
  }

  async renameGroup(id, name) {
    await renameGroup(this.sceneController, id, name);
  }

  async deleteGroup(id) {
    await deleteGroup(this.sceneController, id);
  }

  async assignGroup(markerId, groupId) {
    await setMarkerGroup(this.sceneController, markerId, groupId);
  }
}

function packedFields(item) {
  return [item.field1, item.field2, item.field3].filter((field) => field);
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function valueOrUndefined(value) {
  return value === "" || value === null ? undefined : value;
}

customElements.define("panel-markers", MarkersPanel);
