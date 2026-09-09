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
  setAllMarkersVisible,
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
    this._eraseArmed = false;
    this._eraseTimer = null;

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

    // Two glyph-wide commands. They are drawn only where there is something to act on,
    // and the visibility one reads as show-all once nothing is left to hide, so the
    // button always says what pressing it will do.
    if (markers.length) {
      const allHidden = markers.every((marker) => marker.hidden);
      formContents.push({
        type: "single-icon",
        // The label flips between hide-all and show-all, and the form only rebuilds a
        // row whose description changed, so the state has to be part of the key.
        key: `allVisible:${allHidden}:${this._eraseArmed}`,
        element: html.span({ style: ROW_CONTROLS_STYLE }, [
          html.button({ onclick: () => this.setAllVisible(allHidden) }, [
            translate(
              allHidden ? "sidebar.markers.show-all" : "sidebar.markers.hide-all"
            ),
          ]),
          // Erasing every marker in the glyph cannot be aimed at anything smaller and
          // cannot be seen coming, so it takes two presses. The first press only changes
          // what the button says; the second one does it. The arming lapses on its own
          // after a few seconds, so a stray press never leaves a live delete sitting
          // under the cursor.
          html.button({ onclick: () => this.pressEraseAll() }, [
            translate(
              this._eraseArmed
                ? "sidebar.markers.erase-all-confirm"
                : "sidebar.markers.erase-all"
            ),
          ]),
        ]),
      });
    }

    // Groups carry visibility and a name, nothing else. Deleting one leaves its markers
    // in place and ungrouped.
    formContents.push({ type: "header", label: translate("sidebar.markers.groups") });
    if (!groups.length) {
      formContents.push({
        type: "text",
        value: translate("sidebar.markers.no-groups"),
      });
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
        auxiliaryElement: html.span({ style: ROW_CONTROLS_STYLE }, [
          this._groupSelect(marker, groupOptions),
          html.button(
            {
              style: ROW_BUTTON_STYLE,
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
        style: "max-width: 5em; flex: 0 1 auto;",
        title: translate("sidebar.markers.group"),
        onchange: () => this.assignGroup(marker.id, select.value || undefined),
      },
      groupOptions.map((option) => html.option({ value: option.value }, [option.label]))
    );
    select.value = marker.groupId || "";
    return select;
  }

  _removeButton(title, onclick) {
    return html.button({ style: ROW_BUTTON_STYLE, title, onclick }, ["×"]);
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

  async setAllVisible(visible) {
    await setAllMarkersVisible(this.sceneController, visible);
  }

  async pressEraseAll() {
    clearTimeout(this._eraseTimer);
    if (this._eraseArmed) {
      this._eraseArmed = false;
      await this.deleteAllMarkers();
      return;
    }
    this._eraseArmed = true;
    this._eraseTimer = setTimeout(() => {
      this._eraseArmed = false;
      this.update();
    }, ERASE_ARMED_MILLISECONDS);
    await this.update();
  }

  async deleteAllMarkers() {
    await deleteMarkers(
      this.sceneController,
      (this._markers || []).map((marker) => marker.id),
      "Delete All Markers"
    );
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

// The controls sit in the form's own shadow root, so they carry their sizing with them:
// nothing outside can reach in with a stylesheet.
// How long the erase button stays armed, in milliseconds.
const ERASE_ARMED_MILLISECONDS = 4000;

const ROW_CONTROLS_STYLE =
  "display: flex; align-items: center; gap: 0.2em; flex: 0 0 auto;";
const ROW_BUTTON_STYLE =
  "flex: 0 0 auto; padding: 0 0.3em; background: none; border: none; cursor: pointer; font-size: 1em;";

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

// The segment named by the two points that make it up. A marker on a segment can sit
// anywhere along it, and where it sits is not a property of the outline, so a name that
// changes as the marker slides names the marker rather than the place. The two end
// points do not move as it slides.
//
// A marker outlives the geometry it was placed on: delete the contour and the stored
// contour number names nothing. Asking the path for it throws, and a throw here stops
// the whole panel from being rebuilt, which leaves it showing whatever it last drew --
// the "no glyph selected" line it starts up with. So the number is checked against the
// path before it is used, and a marker with nowhere to point is named as broken.
function pointNameOfSegment(path, end) {
  if (!path || end.contourIndex < 0 || end.contourIndex >= path.numContours) {
    return translate("sidebar.markers.broken");
  }
  const segments = [...path.iterContourDecomposedSegments(end.contourIndex)];
  const segment = segments[end.segmentIndex];
  if (!segment) {
    return `${end.contourIndex}.?`;
  }
  // The walk hands back point numbers counted across the whole path, and a marker row
  // names points the way the canvas does, counted within their own contour.
  const first = path.getContourAndPointIndex(segment.pointIndices[0])[1];
  const last = path.getContourAndPointIndex(segment.pointIndices.at(-1))[1];
  return `${end.contourIndex}.${first}-${last}`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function valueOrUndefined(value) {
  return value === "" || value === null ? undefined : value;
}

customElements.define("panel-markers", MarkersPanel);
