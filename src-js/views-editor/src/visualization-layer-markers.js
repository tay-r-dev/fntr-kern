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

function selectedMarkerIds(model) {
  const ids = new Set();
  for (const source of [model.selection, model.hoverSelection]) {
    const parsed = parseSelection(source || []);
    for (const id of parsed.marker || []) {
      ids.add(String(id));
    }
    for (const key of parsed.markerEnd || []) {
      ids.add(String(key).split("/")[0]);
    }
  }
  return ids;
}

// Every marker of the current glyph, with its geometry already derived. Both layers walk
// this and draw only their own kind.
function* eachMarker(positionedGlyph, model) {
  const layerGlyph = getEditLayerGlyph(positionedGlyph, model);
  const skeletonData = getSkeletonData(layerGlyph);
  const selected = selectedMarkerIds(model);
  for (const marker of getVisibleMarkers(layerGlyph)) {
    yield {
      marker,
      geometry: markerGeometry(positionedGlyph.glyph, marker, skeletonData),
      isSelected: selected.has(String(marker.id)),
    };
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
  for (const { marker, geometry, isSelected } of eachMarker(positionedGlyph, model)) {
    if (geometry.stale) {
      drawStaleMarker(context, parameters, geometry);
      continue;
    }
    if (!geometry.isRay) {
      continue;
    }

    const { anchorPoint, farPoint, secondFarPoint } = geometry;
    context.lineWidth = isSelected
      ? parameters.strokeWidth * 2
      : parameters.strokeWidth;
    context.strokeStyle = parameters.strokeColor;
    context.fillStyle = parameters.strokeColor;

    const tips = [farPoint, secondFarPoint].filter((point) => point);
    for (const tip of tips) {
      strokeLine(context, anchorPoint.x, anchorPoint.y, tip.x, tip.y);
      const direction = vector.normalizeVector(vector.subVectors(tip, anchorPoint));
      drawArrowHead(context, tip, direction, parameters.arrowSize);
    }
    fillCircle(context, anchorPoint.x, anchorPoint.y, parameters.anchorRadius);

    const midpoint = tips.length
      ? vector.addVectors(
          anchorPoint,
          vector.mulVectorScalar(vector.subVectors(tips[0], anchorPoint), 0.5)
        )
      : anchorPoint;
    drawReadout(context, parameters, midpoint, geometry, marker, false);
  }
}

// A stale marker keeps its id, its target and its group, and is listed as broken in the
// panel. On canvas it is a grey dot at the last place its anchor is known to have been,
// so it can be found and re-anchored rather than hunted for. Where even that is unknown
// it draws nothing, and the panel is the only way to it.
function drawStaleMarker(context, parameters, geometry) {
  context.fillStyle = parameters.staleBlobColor;
  for (const point of geometry.points || []) {
    fillCircle(context, point.x, point.y, parameters.anchorRadius);
  }
}

function drawMarkerDimensions(context, positionedGlyph, parameters, model, controller) {
  for (const { marker, geometry, isSelected } of eachMarker(positionedGlyph, model)) {
    if (geometry.stale || geometry.isRay) {
      continue;
    }
    const [p1, p2] = geometry.points;
    const along = vector.normalizeVector(vector.subVectors(p2, p1));
    const out = vector.mulVectorScalar(
      { x: -along.y, y: along.x },
      parameters.witnessGap
    );

    context.lineWidth = isSelected
      ? parameters.strokeWidth * 2
      : parameters.strokeWidth;
    context.strokeStyle = parameters.strokeColor;
    context.fillStyle = parameters.strokeColor;

    // Extension lines out to the measured line, then the measured line itself, in the
    // AutoCAD idiom: the number sits clear of the geometry it measures.
    for (const point of [p1, p2]) {
      strokeLine(context, point.x, point.y, point.x + out.x, point.y + out.y);
    }
    const q1 = vector.addVectors(p1, out);
    const q2 = vector.addVectors(p2, out);
    strokeLine(context, q1.x, q1.y, q2.x, q2.y);
    drawArrowHead(context, q1, vector.mulVectorScalar(along, -1), parameters.arrowSize);
    drawArrowHead(context, q2, along, parameters.arrowSize);

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
    blobColor: "#FFFB",
    textColor: "#000B",
    staleBlobColor: "#8888",
    staleTextColor: "#000B",
  },
  colorsDarkMode: {
    strokeColor: "#6BFD",
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
    anchorRadius: 3,
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
    arrowSize: 7,
    witnessGap: 24,
  },
  ...MARKER_COLORS,
  draw: drawMarkerDimensions,
});
