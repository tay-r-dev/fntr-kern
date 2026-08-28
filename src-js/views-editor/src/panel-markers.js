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
    const formContents = [];

    if (!positionedGlyph) {
      formContents.push({ type: "header", label: translate("sidebar.markers.title") });
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

    // A ray and a dimension are read differently — one is a thickness at a place, the
    // other a distance between two named points — so they are listed apart rather than
    // interleaved by the order they happened to be drawn in.
    const rays = markers.filter((marker) => isRay(marker));
    const dimensions = markers.filter((marker) => !isRay(marker));

    // The group menu on every marker row carries the group NAMES, so a rename has to
    // reach rows that are not the renamed one. Naming the groups in the layout makes
    // the whole form rebuild on rename, which is exactly what a rename needs.
    const groupOptions = [
      { value: "", label: translate("sidebar.markers.no-group") },
      ...groups.map((group) => ({ value: group.id, label: group.name })),
    ];
    const groupFingerprint = groups
      .map((group) => `${group.id}=${group.name}`)
      .join(",");

    // A marker is called by its number. Once it belongs to a group it is called by the
    // group and its number WITHIN that group, so the panel reads the way the drawing
    // does — "Stem 2", not "marker 7, which happens to be a stem".
    const ordinals = new Map();
    const labels = new Map();
    for (const marker of markers) {
      const key = marker.groupId || "";
      const ordinal = (ordinals.get(key) || 0) + 1;
      ordinals.set(key, ordinal);
      const group = groups.find((candidate) => candidate.id === marker.groupId);
      labels.set(marker.id, group ? `${group.name} ${ordinal}` : String(ordinal));
    }

    const section = (label, list) => {
      formContents.push({ type: "header", label: translate(label) });
      if (!list.length) {
        formContents.push({ type: "text", value: translate("sidebar.markers.none") });
        return;
      }
      for (const marker of list) {
        this._pushMarkerRow(formContents, {
          marker,
          positionedGlyph,
          skeletonData,
          groupOptions,
          groupFingerprint,
          label: labels.get(marker.id),
        });
      }
    };

    section("sidebar.markers.rays", rays);
    section("sidebar.markers.dimensions", dimensions);

    // Groups carry visibility and a name, nothing else. Deleting one leaves its markers
    // in place and ungrouped.
    formContents.push({ type: "header", label: translate("sidebar.markers.groups") });
    if (!groups.length) {
      formContents.push({ type: "text", value: translate("sidebar.markers.no-groups") });
    }
    for (const group of groups) {
      const members = markers.filter((marker) => marker.groupId === group.id);
      const hiddenCount = members.filter((marker) => marker.hidden).length;
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
        },
        field3: {
          type: "text",
          key: `groupInfo:${group.id}`,
          value: hiddenCount
            ? `${members.length} · ${hiddenCount} hidden`
            : `${members.length}`,
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

  // One line per marker: what it is and what it holds, what it measures, what it is
  // aiming at, and its controls. A marker is a small thing and should read as one.
  _pushMarkerRow(
    formContents,
    { marker, positionedGlyph, skeletonData, groupOptions, groupFingerprint, label }
  ) {
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

    const place = describeEnds(marker, positionedGlyph.glyph.flattenedPath);

    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        key: `id:${marker.id}`,
        value: place ? `${label} · ${place}` : label,
      },
      field2: {
        type: "text",
        key: `measure:${marker.id}`,
        value: delta === null ? measurement : `${measurement} (${signed(delta)})`,
      },
      field3: {
        type: "edit-number",
        key: `target:${marker.id}`,
        value: marker.target ?? "",
        allowEmptyField: true,
        auxiliaryElement: html.span({}, [
          this._groupSelect(marker, groupOptions),
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
      // The menu and the eye are drawn, not set, so both have to survive in the layout
      // or the row will never be rebuilt when they change.
      flags: `${marker.hidden ? "hidden" : ""}|${groupFingerprint}|${label}|${place}`,
    });
  }

  // The group menu is built here rather than as a form field: the row already spends its
  // three fields, and this control is a plain menu with nothing to remember.
  _groupSelect(marker, groupOptions) {
    const select = html.select(
      {
        class: "marker-row-select",
        title: translate("sidebar.markers.group"),
        onchange: () => this.assignGroup(marker.id, select.value || undefined),
      },
      groupOptions.map((option) => html.option({ value: option.value }, [option.label]))
    );
    select.value = marker.groupId || "";
    return select;
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
      } else if (kind === "groupVisible") {
        await setGroupVisible(this.sceneController, id, !!value);
      } else if (kind === "groupName") {
        await this.renameGroup(id, value);
      }
    } finally {
      this._activeFieldKey = null;
    }
    if (kind === "groupName") {
      // The renamed group is named on every marker's menu, so the whole form is stale.
      await this.update();
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

function isRay(marker) {
  return (marker.ends || []).some((end) => end.kind === "cast");
}

function packedFields(item) {
  return [item.field1, item.field2, item.field3].filter((field) => field);
}

// What the marker is holding on to, named by the POINT it sits on. A segment number is
// an artefact of how the outline is stored and means nothing to a person; the point at
// the near end of that segment is something you can see and click.
function describeEnds(marker, path) {
  const parts = (marker.ends || [])
    .filter((end) => end.kind !== "cast")
    .map((end) => {
      switch (end.kind) {
        case "pathSegment":
          return pointNameOfSegment(path, end);
        case "pathPoint":
          return `${end.contourIndex}.${end.pointIndex}`;
        case "skeletonPoint":
          return translate("sidebar.markers.on-skeleton");
        case "free":
          return translate("sidebar.markers.free");
        default:
          return end.kind;
      }
    });
  return parts.join(" → ");
}

// The near end of the segment: before halfway, the point it starts from; after halfway,
// the one it runs to.
function pointNameOfSegment(path, end) {
  const segments = [...path.iterContourDecomposedSegments(end.contourIndex)];
  const segment = segments[end.segmentIndex];
  if (!segment) {
    return `${end.contourIndex}.?`;
  }
  const pointIndex =
    (end.t ?? 0) < 0.5 ? segment.pointIndices[0] : segment.pointIndices.at(-1);
  return `${end.contourIndex}.${pointIndex}`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function valueOrUndefined(value) {
  return value === "" || value === null ? undefined : value;
}

customElements.define("panel-markers", MarkersPanel);
