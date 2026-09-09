import { markerGeometry } from "@fontra/core/marker-measure.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { parseSelection, round } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { getVisibleMarkers } from "./marker-editing.js";
import {
  fillCircle,
  fillPill,
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

// Two layers, because a ray and a dimension read differently on screen even though the
// data behind them is one object. A designer switches off the one they are not reading.

const RAYS_IDENTIFIER = "fontra.markers.rays";
const DIMENSIONS_IDENTIFIER = "fontra.markers.dimensions";

function getEditLayerGlyph(positionedGlyph, model) {
  const editLayerName =
    model.sceneSettings?.editLayerName || positionedGlyph.glyph?.layerName;
  return (
    (editLayerName &&
      positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph) ||
    positionedGlyph.glyph
  );
}

function markerIdsIn(selection) {
  const ids = new Set();
  const parsed = parseSelection(selection || []);
  for (const id of parsed.marker || []) {
    ids.add(String(id));
  }
  for (const key of parsed.markerEnd || []) {
    ids.add(String(key).split("/")[0]);
  }
  return ids;
}

// Every marker of the current glyph, with its geometry already derived and its state
// known. Both layers walk this and draw only their own kind.
function* eachMarker(positionedGlyph, model) {
  const layerGlyph = getEditLayerGlyph(positionedGlyph, model);
  const skeletonData = getSkeletonData(layerGlyph);
  const selected = markerIdsIn(model.selection);
  const hovered = markerIdsIn(model.hoverSelection);
  for (const marker of getVisibleMarkers(layerGlyph)) {
    yield {
      marker,
      geometry: markerGeometry(positionedGlyph.glyph, marker, skeletonData),
      isSelected: selected.has(String(marker.id)),
      isHovered: hovered.has(String(marker.id)),
    };
  }
}

// The grip a hand can find. Hover puts a ring around it, selection fills it: a marker
// that gives no sign of being under the cursor cannot be aimed at, and a marker that
// gives no sign of being selected cannot be deleted with any confidence.
function drawGrips(context, parameters, grips, isSelected, isHovered, color) {
  for (const grip of grips) {
    if (isHovered) {
      context.strokeStyle = color;
      context.lineWidth = parameters.strokeWidth;
      context.beginPath();
      context.arc(
        grip.point.x,
        grip.point.y,
        parameters.gripRadius + parameters.hoverRingGap,
        0,
        2 * Math.PI
      );
      context.stroke();
    }
    context.fillStyle = color;
    fillCircle(
      context,
      grip.point.x,
      grip.point.y,
      isSelected ? parameters.gripRadius * 1.6 : parameters.gripRadius
    );
  }
}

// The number, and beside it the delta from a target where one is set. A marker with no
// measurement draws its anchor and no number: the ray never left the black, which is not
// staleness and must not be greyed as though it were.
function drawReadout(context, parameters, at, geometry, marker, greyed) {
  if (geometry.distance === null) {
    return;
  }
  let text = String(round(geometry.distance, 1));
  if (marker.target !== undefined && marker.target !== null) {
    const delta = round(geometry.distance - marker.target, 1);
    text += `  ${delta >= 0 ? "+" : ""}${delta}`;
  }

  context.font = `bold ${parameters.fontSize}px fontra-ui-regular, sans-serif`;
  context.textAlign = "center";
  context.scale(1, -1);
  const width = context.measureText(text).width;
  context.fillStyle = greyed ? parameters.staleBlobColor : parameters.blobColor;
  fillPill(
    context,
    at.x,
    -at.y,
    width + parameters.fontSize,
    parameters.fontSize * 1.3
  );
  context.fillStyle = greyed ? parameters.staleTextColor : parameters.textColor;
  context.fillText(text, at.x, -at.y + parameters.fontSize * 0.33);
  context.scale(1, -1);
}

function drawArrowHead(context, at, direction, size) {
  const back = vector.mulVectorScalar(direction, -size);
  const side = vector.mulVectorScalar({ x: -direction.y, y: direction.x }, size * 0.4);
  context.beginPath();
  context.moveTo(at.x, at.y);
  context.lineTo(at.x + back.x + side.x, at.y + back.y + side.y);
  context.lineTo(at.x + back.x - side.x, at.y + back.y - side.y);
  context.closePath();
  context.fill();
}

function drawMarkerRays(context, positionedGlyph, parameters, model, controller) {
  for (const { marker, geometry, isSelected, isHovered } of eachMarker(
    positionedGlyph,
    model
  )) {
    if (!geometry.isRay) {
      continue;
    }
    // A stale ray is a plain dot and no arrow: there is no direction to believe in and
    // no number to report. It is still grabbable, and dragging it onto a segment is
    // what repairs it.
    if (geometry.stale) {
      drawGrips(
        context,
        parameters,
        geometry.grips,
        isSelected,
        isHovered,
        parameters.staleColor
      );
      continue;
    }

    const { anchorPoint, farPoint, secondFarPoint } = geometry;
    const color = isSelected ? parameters.selectedColor : parameters.strokeColor;
    context.lineWidth = isSelected
      ? parameters.strokeWidth * 2
      : parameters.strokeWidth;
    context.strokeStyle = color;
    context.fillStyle = color;

    const tips = [farPoint, secondFarPoint].filter((point) => point);
    for (const tip of tips) {
      strokeLine(context, anchorPoint.x, anchorPoint.y, tip.x, tip.y);
      const direction = vector.normalizeVector(vector.subVectors(tip, anchorPoint));
      drawArrowHead(context, tip, direction, parameters.arrowSize);
    }
    // A ray reads as a dot that throws an arrow. Only the anchor gets a dot: a dot on
    // the far tip sits on top of the arrow head and hides the very thing that says which
    // way the ray runs. The far tips stay grabbable -- what is dropped here is the
    // drawing of them, not the grip.
    drawGrips(
      context,
      parameters,
      geometry.grips.slice(0, 1),
      isSelected,
      isHovered,
      color
    );

    const midpoint = tips.length
      ? vector.addVectors(
          anchorPoint,
          vector.mulVectorScalar(vector.subVectors(tips[0], anchorPoint), 0.5)
        )
      : anchorPoint;
    drawReadout(context, parameters, midpoint, geometry, marker, false);
  }
}

function drawMarkerDimensions(context, positionedGlyph, parameters, model, controller) {
  for (const { marker, geometry, isSelected, isHovered } of eachMarker(
    positionedGlyph,
    model
  )) {
    if (geometry.isRay) {
      continue;
    }
    if (geometry.stale) {
      // A faint line between the two ends, which is what tells a broken dimension apart
      // from a broken ray on sight: a ray is one dot and nothing else, a dimension is
      // two dots that still belong to each other. It is drawn faint because it measures
      // nothing -- the number it would carry is exactly what must not be trusted.
      if (geometry.points.length === 2) {
        context.strokeStyle = parameters.staleLinkColor;
        context.lineWidth = parameters.strokeWidth;
        const [a, b] = geometry.points;
        strokeLine(context, a.x, a.y, b.x, b.y);
      }
      drawGrips(
        context,
        parameters,
        geometry.grips,
        isSelected,
        isHovered,
        parameters.staleColor
      );
      continue;
    }
    const [p1, p2] = geometry.points;
    const [q1, q2] = geometry.arrows;
    const along = geometry.along;
    const color = isSelected ? parameters.selectedColor : parameters.strokeColor;

    context.lineWidth = isSelected
      ? parameters.strokeWidth * 2
      : parameters.strokeWidth;
    context.strokeStyle = color;
    context.fillStyle = color;

    // Extension lines out to the measured line, then the measured line itself, in the
    // AutoCAD idiom: the number sits clear of the geometry it measures. The arrows are
    // where the grips are, which is why the offset is derived once, in the geometry.
    strokeLine(context, p1.x, p1.y, q1.x, q1.y);
    strokeLine(context, p2.x, p2.y, q2.x, q2.y);
    strokeLine(context, q1.x, q1.y, q2.x, q2.y);
    drawArrowHead(context, q1, vector.mulVectorScalar(along, -1), parameters.arrowSize);
    drawArrowHead(context, q2, along, parameters.arrowSize);
    drawGrips(context, parameters, geometry.grips, isSelected, isHovered, color);

    const midpoint = vector.addVectors(
      q1,
      vector.mulVectorScalar(vector.subVectors(q2, q1), 0.5)
    );
    drawReadout(context, parameters, midpoint, geometry, marker, false);
  }
}

const MARKER_COLORS = {
  colors: {
    strokeColor: "#08AD",
    selectedColor: "#06CF",
    staleColor: "#0BBC",
    staleLinkColor: "#0BB6",
    blobColor: "#FFFB",
    textColor: "#000B",
    staleBlobColor: "#8888",
    staleTextColor: "#000B",
  },
  colorsDarkMode: {
    strokeColor: "#6BFD",
    selectedColor: "#9EFF",
    staleColor: "#4CCC",
    staleLinkColor: "#4CC6",
    blobColor: "#444B",
    textColor: "#FFFB",
    staleBlobColor: "#8888",
    staleTextColor: "#FFFB",
  },
};

registerVisualizationLayerDefinition({
  identifier: RAYS_IDENTIFIER,
  name: "sidebar.user-settings.glyph.markers.rays",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 610,
  screenParameters: {
    strokeWidth: 1,
    fontSize: 12,
    gripRadius: 4,
    hoverRingGap: 3,
    arrowSize: 7,
  },
  ...MARKER_COLORS,
  draw: drawMarkerRays,
});

registerVisualizationLayerDefinition({
  identifier: DIMENSIONS_IDENTIFIER,
  name: "sidebar.user-settings.glyph.markers.dimensions",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 611,
  screenParameters: {
    strokeWidth: 1,
    fontSize: 12,
    gripRadius: 4,
    hoverRingGap: 3,
    arrowSize: 7,
  },
  ...MARKER_COLORS,
  draw: drawMarkerDimensions,
});

// What a click would place, drawn while the marker tool hovers a contour. Without it the
// tool gives no sign of what it is aiming at, and a placement is a guess.
const PLACEMENT_PREVIEW_IDENTIFIER = "fontra.markers.placement";

let thePlacementPreview = null;

export function setMarkerPlacementPreview(preview) {
  thePlacementPreview = preview;
}

function drawPlacementPreview(context, positionedGlyph, parameters, model, controller) {
  const preview = thePlacementPreview;
  if (!preview) {
    return;
  }
  context.strokeStyle = parameters.previewColor;
  context.fillStyle = parameters.previewColor;
  context.lineWidth = parameters.strokeWidth;
  // Two tips where the stroke is measured both ways, which is what a double-sided
  // centerline reports.
  for (const tip of [preview.farPoint, preview.secondFarPoint].filter((p) => p)) {
    strokeLine(context, preview.point.x, preview.point.y, tip.x, tip.y);
    drawArrowHead(
      context,
      tip,
      vector.normalizeVector(vector.subVectors(tip, preview.point)),
      parameters.arrowSize
    );
  }
  fillCircle(context, preview.point.x, preview.point.y, parameters.gripRadius);
}

registerVisualizationLayerDefinition({
  identifier: PLACEMENT_PREVIEW_IDENTIFIER,
  name: "sidebar.user-settings.glyph.markers.placement",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: false,
  defaultOn: true,
  zIndex: 612,
  screenParameters: { strokeWidth: 1, gripRadius: 4, arrowSize: 7 },
  colors: { previewColor: "#08A8" },
  colorsDarkMode: { previewColor: "#6BFA" },
  draw: drawPlacementPreview,
});
