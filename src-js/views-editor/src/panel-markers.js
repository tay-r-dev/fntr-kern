import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { markerGeometry } from "@fontra/core/marker-measure.js";
import { getMarkerGroups, getMarkers } from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { round, throttleCalls } from "@fontra/core/utils.ts";
import { showArmedTooltip } from "@fontra/web-components/armed-tooltip.js";
import {
  actionsCell,
  editableCell,
  rowAction,
  selectCell,
  tableCell,
  tableRow,
} from "@fontra/web-components/data-table.js"; // for <data-table>, tickets 62, 63, 66
import "@fontra/web-components/icon-button.js"; // for <icon-button>, tickets 64, 65
import {
  createGroup,
  deleteGroup,
  deleteMarkers,
  renameGroup,
  setGroupVisible,
  setMarkerGroup,
  setMarkerTarget,
  setMarkerVisible,
  setMarkersVisible,
} from "./marker-editing.js";
import Panel from "./panel.js";

// The panel reads; every write goes through marker-editing.js. It never touches the
// stored section itself.
//
// UI-REFACTOR.md §7: Rays and Dimensions are shared tables (tickets 62, 63), each under
// a heading with an eye and a two-press trash for that section alone (64, 65). Groups
// are a third table: name, count, eye and trash (66).

// How long a section trash stays armed, in milliseconds.
const ERASE_ARMED_MILLISECONDS = 4000;

const MARKERS_PANEL_STYLES = `
  .markers-section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }

  .markers-section[hidden] {
    display: none;
  }

  .markers-heading-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .markers-heading {
    font-weight: bold;
    flex: 1 1 auto;
  }

  .markers-heading-row icon-button {
    width: 1.1em;
    height: 1.1em;
  }

  .markers-table th {
    font-weight: normal;
    opacity: 0.7;
  }

  .markers-goal-cell {
    display: flex;
    align-items: center;
    gap: 0.25em;
  }

  .markers-goal {
    width: 3.5em;
  }

  .markers-delta {
    opacity: 0.6;
    white-space: nowrap;
  }

  .markers-group-select {
    max-width: 6em;
  }

  .markers-broken {
    color: var(--fontra-red-color, #c00);
  }

  .markers-empty {
    opacity: 0.6;
  }
`;

export default class MarkersPanel extends Panel {
  identifier = "markers";
  iconPath = "/tabler-icons/ruler-measure.svg";

  constructor(editorController) {
    super(editorController);
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;
    this._appendStyle(MARKERS_PANEL_STYLES);

    // Which section trash is armed ("rays" or "dimensions"), its lapse timer and the
    // tooltip it shows.
    this._eraseArmed = null;
    this._eraseTimer = null;
    this._hideEraseTooltip = null;

    this.noGlyphNote = html.div({ class: "markers-empty" }, [
      translate("sidebar.markers.no-glyph"),
    ]);
    this.rays = this._buildMarkerSection("rays", "sidebar.markers.rays");
    this.dimensions = this._buildMarkerSection(
      "dimensions",
      "sidebar.markers.dimensions"
    );
    this.groups = this._buildGroupSection();
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [
          this.noGlyphNote,
          this.rays.element,
          this.dimensions.element,
          this.groups.element,
        ]
      )
    );

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

  // A section: heading with its eye and trash, a note when empty, and the table.
  _buildMarkerSection(kind, labelKey) {
    const eye = html.createDomElement("icon-button", {
      "src": "/tabler-icons/eye.svg",
      "data-tooltipposition": "left",
    });
    eye.onclick = () => this.toggleSectionVisible(kind);
    const trash = html.createDomElement("icon-button", {
      "src": "/tabler-icons/trash.svg",
      "data-tooltip": translate("sidebar.markers.erase-section"),
      "data-tooltipposition": "left",
    });
    trash.onclick = (event) => this.pressEraseSection(kind, event.currentTarget);
    const table = html.createDomElement("data-table");
    table.tableClassName = "markers-table";
    table.columns = [
      { label: translate("sidebar.markers.column.id") },
      { label: translate("sidebar.markers.column.nodes") },
      { label: translate("sidebar.markers.column.value"), align: "right" },
      { label: translate("sidebar.markers.column.goal") },
      { label: translate("sidebar.markers.column.group") },
      { label: translate("sidebar.markers.column.action") },
    ];
    // §7.1: both tables carry a vertical resize grip.
    table.minHeight = 60;
    table.resizable = true;
    table.heightStorageKey = `fontra-markers-${kind}-table-height`;
    const empty = html.div({ class: "markers-empty" }, [
      translate("sidebar.markers.none"),
    ]);
    const element = html.div({ class: "markers-section" }, [
      html.div({ class: "markers-heading-row" }, [
        html.div({ class: "markers-heading" }, [translate(labelKey)]),
        eye,
        trash,
      ]),
      empty,
      table,
    ]);
    return { element, eye, trash, table, empty, markers: [] };
  }

  _buildGroupSection() {
    const table = html.createDomElement("data-table");
    table.tableClassName = "markers-table";
    table.columns = [
      { label: translate("sidebar.markers.column.name") },
      { label: translate("sidebar.markers.column.count"), align: "right" },
      { label: "" },
    ];
    const empty = html.div({ class: "markers-empty" }, [
      translate("sidebar.markers.no-groups"),
    ]);
    const element = html.div({ class: "markers-section" }, [
      html.div({ class: "markers-heading-row" }, [
        html.div({ class: "markers-heading" }, [translate("sidebar.markers.groups")]),
      ]),
      empty,
      table,
      html.div({}, [
        html.button({ onclick: () => this._createNextGroup() }, [
          translate("sidebar.markers.new-group"),
        ]),
      ]),
    ]);
    return { element, table, empty, groups: [] };
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
    this.noGlyphNote.hidden = !!positionedGlyph;
    for (const section of [this.rays, this.dimensions, this.groups]) {
      section.element.hidden = !positionedGlyph;
    }
    if (!positionedGlyph) {
      this._disarmErase();
      return;
    }

    const layerGlyph = this._getEditLayerGlyph(positionedGlyph);
    const skeletonData = getSkeletonData(layerGlyph);
    const markers = getMarkers(layerGlyph);
    const groups = getMarkerGroups(layerGlyph);

    // A ray and a dimension are read differently — one is a thickness at a place, the
    // other a distance between two named points — so they are listed apart rather than
    // interleaved by the order they happened to be drawn in.
    const groupOptions = [
      { value: "", label: translate("sidebar.markers.no-group") },
      ...groups.map((group) => ({ value: group.id, label: group.name })),
    ];

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

    const context = { positionedGlyph, skeletonData, groupOptions, labels };
    this._renderMarkerSection(this.rays, markers.filter(isRay), context);
    this._renderMarkerSection(
      this.dimensions,
      markers.filter((marker) => !isRay(marker)),
      context
    );
    this._renderGroupSection(groups, markers);
  }

  _renderMarkerSection(section, markers, context) {
    section.markers = markers;
    section.empty.hidden = markers.length > 0;
    // Not `hidden`: the table's own display rule outranks the hidden attribute.
    section.table.style.display = markers.length ? "" : "none";
    // The eye says what pressing it does: hide while anything shows, show once
    // everything is hidden.
    const allHidden = markers.length > 0 && markers.every((marker) => marker.hidden);
    section.eye.src = allHidden
      ? "/tabler-icons/eye-closed.svg"
      : "/tabler-icons/eye.svg";
    section.eye.setAttribute(
      "data-tooltip",
      translate(
        allHidden ? "sidebar.markers.show-section" : "sidebar.markers.hide-section"
      )
    );
    section.eye.disabled = markers.length === 0;
    section.trash.disabled = markers.length === 0;
    section.table.setRows(markers, (marker) => this._markerRow(marker, context), {
      rowId: (marker) => marker.id,
    });
  }

  // ID, Nodes, Value, Goal with the delta after it, Group, and the eye and trash.
  _markerRow(marker, { positionedGlyph, skeletonData, groupOptions, labels }) {
    const geometry = markerGeometry(positionedGlyph.glyph, marker, skeletonData);
    const hasTarget = marker.target !== undefined && marker.target !== null;
    // A stale marker reads broken in Value and carries no delta.
    const value = geometry.stale
      ? html.span({ class: "markers-broken" }, [translate("sidebar.markers.broken")])
      : geometry.distance === null
        ? "—"
        : String(round(geometry.distance, 1));
    const delta =
      !geometry.stale && geometry.distance !== null && hasTarget
        ? round(geometry.distance - marker.target, 1)
        : null;

    return tableRow(marker.id, [
      tableCell(labels.get(marker.id)),
      tableCell(describeEnds(marker, positionedGlyph.glyph.flattenedPath)),
      tableCell(value, { align: "right" }),
      tableCell(
        html.div({ class: "markers-goal-cell" }, [
          editableCell({
            type: "number",
            value: hasTarget ? marker.target : "",
            allowEmpty: true,
            className: "markers-goal",
            title: translate("sidebar.markers.target"),
            onCommit: (target) =>
              setMarkerTarget(this.sceneController, marker.id, target ?? undefined),
          }),
          delta === null
            ? null
            : html.span({ class: "markers-delta" }, [signed(delta)]),
        ])
      ),
      tableCell(
        selectCell({
          value: marker.groupId || "",
          options: groupOptions,
          className: "markers-group-select",
          onChange: (groupId) => this.assignGroup(marker.id, groupId || undefined),
        })
      ),
      actionsCell([
        rowAction({
          src: marker.hidden ? "/tabler-icons/eye-closed.svg" : "/tabler-icons/eye.svg",
          tooltip: translate(
            marker.hidden
              ? "sidebar.markers.show-marker"
              : "sidebar.markers.hide-marker"
          ),
          tooltipPosition: "left",
          // A hidden marker's closed eye is a state, so it stays readable.
          reveal: marker.hidden ? "always" : "dim",
          onClick: () => this.setMarkerVisible(marker.id, !!marker.hidden),
        }),
        rowAction({
          src: "/tabler-icons/trash.svg",
          tooltip: translate("sidebar.markers.delete-marker"),
          tooltipPosition: "left",
          onClick: () => this.deleteMarker(marker.id),
        }),
      ]),
    ]);
  }

  // Groups carry visibility and a name, nothing else. Deleting one leaves its markers
  // in place and ungrouped.
  _renderGroupSection(groups, markers) {
    const section = this.groups;
    section.groups = groups;
    section.empty.hidden = groups.length > 0;
    section.table.style.display = groups.length ? "" : "none";
    section.table.setRows(
      groups,
      (group) => {
        const members = markers.filter((marker) => marker.groupId === group.id);
        const hiddenCount = members.filter((marker) => marker.hidden).length;
        const visible = group.visible !== false;
        // The eye is an on-state icon button: lit while the group shows.
        const eye = rowAction({
          src: visible ? "/tabler-icons/eye.svg" : "/tabler-icons/eye-closed.svg",
          tooltip: translate(
            visible ? "sidebar.markers.hide-group" : "sidebar.markers.show-group"
          ),
          tooltipPosition: "left",
          reveal: "always",
          onClick: () => setGroupVisible(this.sceneController, group.id, !visible),
        });
        eye.on = visible;
        return tableRow(group.id, [
          tableCell(
            editableCell({
              value: group.name,
              onCommit: (name) => this.renameGroup(group.id, name),
            })
          ),
          tableCell(
            hiddenCount
              ? `${members.length} · ${hiddenCount} hidden`
              : `${members.length}`,
            { align: "right" }
          ),
          actionsCell([
            eye,
            rowAction({
              src: "/tabler-icons/trash.svg",
              tooltip: translate("sidebar.markers.delete-group"),
              tooltipPosition: "left",
              onClick: () => this.deleteGroup(group.id),
            }),
          ]),
        ]);
      },
      { rowId: (group) => group.id }
    );
  }

  _section(kind) {
    return kind === "rays" ? this.rays : this.dimensions;
  }

  // Panel-side commands, for whatever calls them: the context menu, a button row, or a
  // test. They exist so nothing outside this file needs to know the write path.
  async toggleSectionVisible(kind) {
    const markers = this._section(kind).markers;
    if (!markers.length) {
      return;
    }
    const allHidden = markers.every((marker) => marker.hidden);
    await setMarkersVisible(
      this.sceneController,
      markers.map((marker) => marker.id),
      allHidden
    );
  }

  // Erasing a section cannot be seen coming, so it takes two presses. The first press
  // arms and shows a tooltip; the second, within the lapse, erases that section only.
  // The arming lapses on its own, so a stray press never leaves a live delete sitting
  // under the cursor.
  async pressEraseSection(kind, anchor) {
    if (this._eraseArmed === kind) {
      this._disarmErase();
      await this.eraseSection(kind);
      return;
    }
    this._disarmErase();
    this._eraseArmed = kind;
    this._hideEraseTooltip = showArmedTooltip(
      anchor,
      translate("sidebar.markers.erase-section-armed")
    );
    this._eraseTimer = setTimeout(() => this._disarmErase(), ERASE_ARMED_MILLISECONDS);
  }

  _disarmErase() {
    clearTimeout(this._eraseTimer);
    this._eraseTimer = null;
    this._eraseArmed = null;
    this._hideEraseTooltip?.();
    this._hideEraseTooltip = null;
  }

  async eraseSection(kind) {
    const markers = this._section(kind).markers;
    if (!markers.length) {
      return;
    }
    await deleteMarkers(
      this.sceneController,
      markers.map((marker) => marker.id),
      kind === "rays" ? "Delete Rays" : "Delete Dimensions"
    );
  }

  async deleteMarker(id) {
    await deleteMarkers(this.sceneController, [id]);
  }

  async setMarkerVisible(id, visible) {
    await setMarkerVisible(this.sceneController, id, visible);
  }

  async _createNextGroup() {
    await this.createGroup(
      `${translate("sidebar.markers.group")} ${this.groups.groups.length + 1}`
    );
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

customElements.define("panel-markers", MarkersPanel);
