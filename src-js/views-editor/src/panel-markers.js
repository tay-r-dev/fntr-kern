import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { markerGeometry } from "@fontra/core/marker-measure.js";
import {
  getMarkerGroups,
  getMarkers,
  markerKind,
  skeletonPointNumber,
} from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { round, throttleCalls } from "@fontra/core/utils.ts";
import {
  disarmOnClickAway,
  showArmedTooltip,
} from "@fontra/web-components/armed-tooltip.js";
import {
  actionsCell,
  additionalText,
  editableCell,
  rowAction,
  selectCell,
  tableCell,
  tableRow,
} from "@fontra/web-components/data-table.js"; // for <data-table>, tickets 62, 63, 66
import "@fontra/web-components/icon-button.js"; // for <icon-button>, tickets 64, 65
import "@fontra/web-components/text-button.js";
import {
  Accordion,
  persistAccordionOpenState,
  restoreAccordionOpenState,
} from "@fontra/web-components/ui-accordion.js";
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
import { rulerExtraLines } from "./edit-tools-power-ruler.js";
import Panel from "./panel.js";

// The panel reads; every write goes through marker-editing.js. It never touches the
// stored section itself.
//
// UI-REFACTOR.md §7: Rays and Dimensions are shared tables (tickets 62, 63), each under
// a heading with an eye and a two-press trash for that section alone (64, 65). Groups
// are a third table: name, count, eye and trash (66).

// How long a section trash stays armed, in milliseconds.
const ERASE_ARMED_MILLISECONDS = 4000;

// The sections' open items are kept under this prefix (ui-accordion.js).
const ACCORDION_OPEN_STORAGE_PREFIX = "fontra-markers-accordion-open.";

// The Measurements card (Figma 4118:11629): a switch accordion with a
// section per marker kind, its eye and trash in the header over a table, and
// the groups table.
const MARKERS_PANEL_STYLES = `
  .markers-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .markers-heading-actions {
    display: flex;
    gap: 2px;
  }

  .markers-broken {
    color: var(--fontra-red-color, #c00);
  }
`;

// The columns, by the shared table rule: a column of numbers fits four
// digits in its box or its head; the names are dragged to fit, the values
// take what is left, and the actions hug their buttons.
// Dragged columns keep their widths in a narrow panel: the table scrolls
// sideways instead.
const ID_COLUMN = { width: 96, minWidth: 32, noShrink: true };
const VALUE_COLUMN = { minWidth: 48, stretch: true };
const NUMBER_COLUMN = { fitText: "0000", align: "right" };
// Goal can be turned off from the table head's menu (right-click).
const GOAL_COLUMN = { key: "goal", hideable: true, fitText: "0000", fitField: true };
const GROUP_COLUMN = { width: 56, minWidth: 40, noShrink: true };
const ACTIONS_COLUMN = { label: "", hug: true };

export default class MarkersPanel extends Panel {
  identifier = "markers";
  iconPath = "ruler-measure";
  tabLabel = "measure";

  constructor(editorController) {
    super(editorController);
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;
    this._appendStyle(MARKERS_PANEL_STYLES);

    // Which section trash is armed (a section name), its lapse timer and the
    // tooltip it shows.
    this._eraseArmed = null;
    this._eraseTimer = null;
    this._hideEraseTooltip = null;

    const column = (key, extra) => ({
      label: translate(`sidebar.markers.column.${key}`),
      ...extra,
    });
    const measuredColumns = [
      column("id", ID_COLUMN),
      column("value", VALUE_COLUMN),
      column("goal", GOAL_COLUMN),
      column("group", GROUP_COLUMN),
      ACTIONS_COLUMN,
    ];
    this.noGlyphNote = html.div({ class: "card-note" }, [
      translate("sidebar.markers.no-glyph"),
    ]);
    this.rays = this._buildMarkerSection(
      "rays",
      "sidebar.markers.rays",
      measuredColumns
    );
    this.dimensions = this._buildMarkerSection(
      "dimensions",
      "sidebar.markers.dimensions",
      measuredColumns
    );
    this.rulers = this._buildMarkerSection("rulers", "sidebar.markers.rulers", [
      column("id", ID_COLUMN),
      column("value", VALUE_COLUMN),
      column("angle", NUMBER_COLUMN),
      column("goal", GOAL_COLUMN),
      column("group", GROUP_COLUMN),
      ACTIONS_COLUMN,
    ]);
    this.curvatures = this._buildMarkerSection(
      "curvatures",
      "sidebar.markers.curvatures",
      measuredColumns
    );
    this.groups = this._buildGroupSection();
    this.accordion = new Accordion();
    this.accordion.setAttribute("switch", "");
    this.accordion.items = restoreAccordionOpenState(
      [this.rays, this.dimensions, this.rulers, this.curvatures, this.groups].map(
        (section) => section.item
      ),
      ACCORDION_OPEN_STORAGE_PREFIX
    );
    persistAccordionOpenState(this.accordion, ACCORDION_OPEN_STORAGE_PREFIX);
    this.contentElement.appendChild(
      html.div({ class: "card-column panel-section--flex" }, [
        html.div({ class: "card" }, [
          html.div({ class: "card-heading" }, [
            translate("sidebar.markers.measurements"),
          ]),
          this.noGlyphNote,
          this.accordion,
        ]),
      ])
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

  // A table of the card: look "select", its height dragged by the grip and its
  // name and value columns by their edges, both kept per section.
  _buildTable(kind, columns) {
    const table = html.createDomElement("data-table");
    table.look = "select";
    table.columns = columns;
    table.columnWidthsStorageKey = `fontra-markers-${kind}-column-widths`;
    table.hiddenColumnsStorageKey = `fontra-markers-${kind}-hidden-columns`;
    table.resizable = true;
    table.minHeight = 48;
    table.style.setProperty("--data-table-height", "72px");
    table.heightStorageKey = `fontra-markers-${kind}-height`;
    return table;
  }

  // A section: an accordion item with its eye and trash in the header, a note
  // when empty, and the table.
  _buildMarkerSection(kind, labelKey, columns) {
    const eye = html.createDomElement("icon-button", {
      "src": "eye",
      "data-tooltipposition": "left",
    });
    eye.onclick = () => this.toggleSectionVisible(kind);
    const trash = html.createDomElement("icon-button", {
      "src": "delete",
      "data-tooltip": translate("sidebar.markers.erase-section"),
      "data-tooltipposition": "left",
    });
    trash.onclick = (event) => this.pressEraseSection(kind, event.currentTarget);
    const table = this._buildTable(kind, columns);
    const empty = html.div({ class: "card-note" }, [translate("sidebar.markers.none")]);
    const item = {
      id: kind,
      label: translate(labelKey),
      open: true,
      content: html.div({ class: "markers-section" }, [empty, table]),
      auxiliaryHeaderElement: html.div({ class: "markers-heading-actions" }, [
        eye,
        trash,
      ]),
    };
    return { item, eye, trash, table, empty, markers: [] };
  }

  _buildGroupSection() {
    const table = this._buildTable("groups", [
      {
        label: translate("sidebar.markers.column.name"),
        width: 120,
        minWidth: 40,
        noShrink: true,
      },
      {
        label: translate("sidebar.markers.column.type"),
        fitText: longest(MARKER_KINDS.map((kind) => kindName(kind))),
      },
      { label: translate("sidebar.markers.column.count"), ...NUMBER_COLUMN },
      ACTIONS_COLUMN,
    ]);
    const empty = html.div({ class: "card-note" }, [
      translate("sidebar.markers.no-groups"),
    ]);
    const item = {
      id: "groups",
      label: translate("sidebar.markers.groups"),
      open: true,
      content: html.div({ class: "markers-section" }, [
        empty,
        table,
        html.div({ class: "button-row" }, [
          // button/text, size S (Figma 414:31310).
          html.createDomElement("text-button", {
            label: translate("sidebar.markers.new-group"),
            size: "S",
            onclick: () => this._createNextGroup(),
          }),
        ]),
      ]),
    };
    return { item, table, empty, groups: [] };
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
    this.accordion.hidden = !positionedGlyph;
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
    const ofKind = (kind) => markers.filter((marker) => markerKind(marker) === kind);
    this._renderMarkerSection(this.rays, ofKind("ray"), context);
    this._renderMarkerSection(this.dimensions, ofKind("dimension"), context);
    this._renderMarkerSection(this.rulers, ofKind("ruler"), context, (marker) =>
      this._rulerRow(marker, context)
    );
    this._renderMarkerSection(this.curvatures, ofKind("curvature"), context, (marker) =>
      this._curvatureRow(marker, context)
    );
    this._renderGroupSection(groups, markers);
  }

  _renderMarkerSection(section, markers, context, makeRow = undefined) {
    section.markers = markers;
    section.empty.hidden = markers.length > 0;
    // Not `hidden`: the table's own display rule outranks the hidden attribute.
    section.table.style.display = markers.length ? "" : "none";
    // The eye says what pressing it does: hide while anything shows, show once
    // everything is hidden.
    const allHidden = markers.length > 0 && markers.every((marker) => marker.hidden);
    section.eye.src = allHidden ? "eye-closed" : "eye";
    section.eye.setAttribute(
      "data-tooltip",
      translate(
        allHidden ? "sidebar.markers.show-section" : "sidebar.markers.hide-section"
      )
    );
    section.eye.disabled = markers.length === 0;
    section.trash.disabled = markers.length === 0;
    const row = makeRow || ((marker) => this._markerRow(marker, context));
    section.table.setRows(markers, row, {
      rowId: (marker) => marker.id,
    });
  }

  // ID with its nodes after it, the value with its delta and angle after it, Goal,
  // Group, and the eye and trash.
  _markerRow(marker, { positionedGlyph, skeletonData, groupOptions, labels }) {
    const geometry = markerGeometry(positionedGlyph.glyph, marker, skeletonData);
    const hasTarget = marker.target !== undefined && marker.target !== null;
    // A stale marker reads broken in Value and carries no delta.
    const value = geometry.stale
      ? html.span({ class: "markers-broken" }, [translate("sidebar.markers.broken")])
      : geometry.distance === null
        ? "—"
        : String(round(geometry.distance, 1));
    // The angle the marker measures in. A ray that measures nothing still has one.
    const angle =
      geometry.stale || geometry.angle === null || geometry.angle === undefined
        ? null
        : `${round(geometry.angle, 1)}°`;
    const delta =
      !geometry.stale && geometry.distance !== null && hasTarget
        ? round(geometry.distance - marker.target, 1)
        : null;
    return tableRow(marker.id, [
      this._idCell(marker, labels, positionedGlyph, skeletonData),
      tableCell([value, afterValue(delta, angle)]),
      this._goalCell(marker),
      ...this._groupAndActionCells(marker, groupOptions),
    ]);
  }

  // The marker's name, and the points it holds on to after it.
  _idCell(marker, labels, positionedGlyph, skeletonData) {
    return tableCell([
      labels.get(marker.id),
      additionalText(
        describeEnds(marker, positionedGlyph.glyph.flattenedPath, skeletonData)
      ),
    ]);
  }

  _goalCell(marker) {
    const hasTarget = marker.target !== undefined && marker.target !== null;
    return tableCell(
      editableCell({
        type: "number",
        value: hasTarget ? marker.target : "",
        allowEmpty: true,
        title: translate("sidebar.markers.target"),
        onCommit: (target) =>
          setMarkerTarget(this.sceneController, marker.id, target ?? undefined),
      })
    );
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
        const kinds = new Set(members.map((marker) => markerKind(marker)));
        const visible = group.visible !== false;
        // The eye is an on-state icon button: lit while the group shows.
        const eye = rowAction({
          src: visible ? "eye" : "eye-closed",
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
          // The kind of marker it holds, or mixed.
          tableCell(
            kinds.size === 0
              ? "—"
              : kinds.size === 1
                ? kindName([...kinds][0])
                : translate("sidebar.markers.kind.mixed")
          ),
          tableCell([
            String(members.length),
            hiddenCount
              ? additionalText(`${hiddenCount} ${translate("sidebar.markers.hidden")}`)
              : null,
          ]),
          actionsCell([
            eye,
            rowAction({
              src: "delete",
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
    return this[kind];
  }

  // ID, the spans the ruler crosses in order along its line, its angle, Goal,
  // Group, and the eye and trash. The spans are read with the side-bearing lines
  // the canvas draws, so the table and the canvas give the same numbers.
  _rulerRow(marker, { positionedGlyph, skeletonData, groupOptions, labels }) {
    const geometry = markerGeometry(positionedGlyph.glyph, marker, skeletonData, {
      extraLines: rulerExtraLines(this.editorController, positionedGlyph.glyph),
    });
    const spans = geometry.measurePoints
      .filter((span) => span.distance >= 0.1)
      .map((span) => String(round(span.distance, 1)));
    return tableRow(marker.id, [
      tableCell(labels.get(marker.id)),
      tableCell(spans.length ? spans.join(" • ") : "—"),
      tableCell(`${round(geometry.angle, 1)}°`, { align: "right" }),
      this._goalCell(marker),
      ...this._groupAndActionCells(marker, groupOptions),
    ]);
  }

  // ID with its nodes, the curvature with its delta and the radius after it,
  // Goal, Group, and the eye and trash. A straight reads an endless radius and
  // no curvature.
  _curvatureRow(marker, { positionedGlyph, skeletonData, groupOptions, labels }) {
    const geometry = markerGeometry(positionedGlyph.glyph, marker, skeletonData);
    const hasTarget = marker.target !== undefined && marker.target !== null;
    const value = geometry.stale
      ? html.span({ class: "markers-broken" }, [translate("sidebar.markers.broken")])
      : formatCurvature(geometry.curvature);
    const delta =
      !geometry.stale && hasTarget
        ? Number(((geometry.curvature || 0) - marker.target).toPrecision(4))
        : null;
    return tableRow(marker.id, [
      this._idCell(marker, labels, positionedGlyph, skeletonData),
      tableCell([
        value,
        afterValue(delta, geometry.stale ? null : formatRadius(geometry.radius)),
      ]),
      this._goalCell(marker),
      ...this._groupAndActionCells(marker, groupOptions),
    ]);
  }

  _groupAndActionCells(marker, groupOptions) {
    return [
      tableCell(
        selectCell({
          value: marker.groupId || "",
          options: groupOptions,
          onChange: (groupId) => this.assignGroup(marker.id, groupId || undefined),
        })
      ),
      actionsCell([
        rowAction({
          src: marker.hidden ? "eye-closed" : "eye",
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
          src: "delete",
          tooltip: translate("sidebar.markers.delete-marker"),
          tooltipPosition: "left",
          onClick: () => this.deleteMarker(marker.id),
        }),
      ]),
    ];
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
  // The arming lapses on its own, or with a press anywhere else, so a stray press never
  // leaves a live delete sitting under the cursor.
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
    disarmOnClickAway(anchor, () => this._disarmErase());
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
      ERASE_UNDO_LABELS[kind]
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

const ERASE_UNDO_LABELS = {
  rays: "Delete Rays",
  dimensions: "Delete Dimensions",
  rulers: "Delete Rulers",
  curvatures: "Delete Curvature Markers",
};

// A radius is a length and reads in font units; a straight has none.
export function formatRadius(radius) {
  return Number.isFinite(radius) ? String(round(radius, 1)) : "∞";
}

// A curvature is one over a length, so in font units it is a small number: four
// significant digits say what a designer can act on.
export function formatCurvature(curvature) {
  return curvature ? curvature.toPrecision(4) : "0";
}

// What the marker is holding on to, named by the POINT it sits on. A segment number is
// an artefact of how the outline is stored and means nothing to a person; the point at
// the near end of that segment is something you can see and click. Points are numbered
// as the canvas labels them: an outline point by its number in the whole glyph (no
// contour number -- it is unique already), a skeleton point by its own run, after "R.".
function describeEnds(marker, path, skeletonData) {
  const parts = (marker.ends || [])
    .filter((end) => end.kind !== "cast")
    .map((end) => {
      switch (end.kind) {
        case "pathSegment":
          return pointNameOfSegment(path, end);
        case "pathPoint":
          return pathPointName(path, end.contourIndex, end.pointIndex);
        case "skeletonPoint": {
          const number = skeletonPointNumber(skeletonData, end.contourId, end.pointId);
          return number == null
            ? translate("sidebar.markers.broken")
            : translate("sidebar.markers.on-skeleton", number);
        }
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
    return "?";
  }
  // The walk hands back point numbers counted across the whole path, as the canvas
  // numbers them.
  const first = segment.pointIndices[0];
  const last = segment.pointIndices.at(-1);
  // A ray on an on-curve point is stored as a segment's end, but it sits on the point,
  // so it is named by the point. Named by the segment, a ray moved onto a corner read as
  // though it had gone to some segment instead.
  if (end.t === 0) {
    return `${first}`;
  }
  if (end.t === 1) {
    return `${last}`;
  }
  return `${first}-${last}`;
}

// An outline point by its number in the whole glyph, as the canvas labels it.
function pathPointName(path, contourIndex, pointIndex) {
  if (!path || contourIndex < 0 || contourIndex >= path.numContours) {
    return translate("sidebar.markers.broken");
  }
  return `${path.getAbsolutePointIndex(contourIndex, pointIndex)}`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

// What follows a value in its cell, lighter: the delta to the goal in
// brackets, then the angle or radius.
function afterValue(delta, extra) {
  const parts = [delta === null ? null : `(${signed(delta)})`, extra].filter(
    (part) => part != null
  );
  return parts.length ? additionalText(parts.join(" ")) : null;
}

const MARKER_KINDS = ["ray", "dimension", "ruler", "curvature"];

function kindName(kind) {
  return translate(`sidebar.markers.kind.${kind}`);
}

function longest(texts) {
  return texts.reduce((a, b) => (b.length > a.length ? b : a), "");
}

customElements.define("panel-markers", MarkersPanel);
