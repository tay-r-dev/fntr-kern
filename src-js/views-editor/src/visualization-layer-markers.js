import { markerGeometry } from "@fontra/core/marker-measure.js";
import { markerKind } from "@fontra/core/marker-model.js";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { parseSelection, round } from "@fontra/core/utils.ts";
import * as vector from "@fontra/core/vector.js";
import { getVisibleMarkers } from "./marker-editing.js";
import {
  fillCircle,
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

// Every marker of one kind in the current glyph, with its geometry already derived and
// its state known. Each layer walks this for its own kind. A ruler's layer passes the
// side-bearing lines its spans are measured against.
export function* eachMarker(positionedGlyph, model, kind, geometryOptions = {}) {
  const layerGlyph = getEditLayerGlyph(positionedGlyph, model);
  const skeletonData = getSkeletonData(layerGlyph);
  const selected = markerIdsIn(model.selection);
  const hovered = markerIdsIn(model.hoverSelection);
  for (const marker of getVisibleMarkers(layerGlyph)) {
    if (markerKind(marker) !== kind) {
      continue;
    }
    yield {
      marker,
      geometry: markerGeometry(
        positionedGlyph.glyph,
        marker,
        skeletonData,
        geometryOptions
      ),
      isSelected: selected.has(String(marker.id)),
      isHovered: hovered.has(String(marker.id)),
    };
  }
}

// The grip a hand can find. Hover puts a ring around it, selection fills it: a marker
// that gives no sign of being under the cursor cannot be aimed at, and a marker that
// gives no sign of being selected cannot be deleted with any confidence.
export function drawGrips(context, parameters, grips, isSelected, isHovered, color) {
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

// The number, the delta from a target where one is set, and the angle the marker
// measures in. A ray with no measurement draws no number and still reads its angle:
// the ray never left the black, which is not staleness and must not be greyed as though
// it were.
function drawReadout(context, parameters, at, geometry, marker) {
  const parts = [];
  if (geometry.distance !== null) {
    parts.push(String(round(geometry.distance, 1)));
    if (marker.target !== undefined && marker.target !== null) {
      const delta = round(geometry.distance - marker.target, 1);
      parts.push(`${delta >= 0 ? "+" : ""}${delta}`);
    }
  }
  if (geometry.angle !== null && geometry.angle !== undefined) {
    parts.push(`${round(geometry.angle, 1)}°`);
  }
  if (!parts.length) {
    return;
  }
  drawPill(context, parameters, at, parts);
}

// The label every marker and ruler readout draws through: Figma's label/simple
// (typeCAD, node 333:17292). A fully rounded pill 18 high with 8 of padding each side,
// a hairline border and a one-pixel drop shadow; its values in Martian Mono at 9, the
// heading/h5 face, separated by a small grey bullet with 3 either side. All of these
// are screen pixels: the layer's screen parameters scale them to the zoom.
//
// `parts` is one value or several. `inverse` swaps fill and text, which is how a ruler
// tells a span in the white from a span in the black.
export function drawPill(context, parameters, at, parts, { inverse = false } = {}) {
  const values = (Array.isArray(parts) ? parts : [parts]).filter(
    (part) => part !== undefined && part !== null && part !== ""
  );
  if (!values.length) {
    return;
  }
  const valueFont = `400 ${parameters.labelFontSize}px ${LABEL_FONT_FAMILY}`;
  const separatorFont = `400 ${parameters.labelSeparatorSize}px ${LABEL_FONT_FAMILY}`;

  context.save();
  context.scale(1, -1);
  context.textBaseline = "middle";
  context.textAlign = "left";

  // Martian Mono's tracking is -3 per cent, in both sizes.
  const setFont = (font, size) => {
    context.font = font;
    context.fontStretch = "semi-condensed";
    context.letterSpacing = `${-0.03 * size}px`;
  };
  const items = [];
  values.forEach((value, i) => {
    if (i) {
      items.push({ text: LABEL_SEPARATOR, separator: true });
    }
    items.push({ text: String(value), separator: false });
  });
  for (const item of items) {
    if (item.separator) {
      setFont(separatorFont, parameters.labelSeparatorSize);
    } else {
      setFont(valueFont, parameters.labelFontSize);
    }
    item.width = context.measureText(item.text).width;
  }
  const gap = parameters.labelGap;
  const contentWidth =
    items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
  const width = contentWidth + 2 * parameters.labelPaddingX;
  const height = parameters.labelHeight;
  const left = at.x - width / 2;
  const top = -at.y - height / 2;

  const fill = inverse ? parameters.labelTextColor : parameters.labelFillColor;
  const ink = inverse ? parameters.labelFillColor : parameters.labelTextColor;

  // A shadow is set in device pixels and ignores the transform, so it is one device
  // pixel's worth of the screen at every zoom.
  const pixel = window.devicePixelRatio || 1;
  blurBehind(context, left, top, width, height, LABEL_BACKDROP_BLUR * pixel);
  context.shadowColor = LABEL_SHADOW_COLOR;
  context.shadowOffsetY = pixel;
  context.shadowBlur = pixel;
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(left, top, width, height, height / 2);
  context.fill();
  context.shadowColor = "transparent";

  // The outline runs outside the pill, so it adds to the pill's size rather than
  // eating into its fill.
  const border = parameters.labelBorderWidth;
  context.lineWidth = border;
  context.strokeStyle = parameters.labelBorderColor;
  context.beginPath();
  context.roundRect(
    left - border / 2,
    top - border / 2,
    width + border,
    height + border,
    (height + border) / 2
  );
  context.stroke();

  let x = left + parameters.labelPaddingX;
  for (const item of items) {
    if (item.separator) {
      setFont(separatorFont, parameters.labelSeparatorSize);
      context.fillStyle = parameters.labelSeparatorColor;
    } else {
      setFont(valueFont, parameters.labelFontSize);
      context.fillStyle = ink;
    }
    context.fillText(item.text, x, -at.y);
    x += item.width + gap;
  }
  context.restore();
}

// Figma's background blur: whatever is already drawn under the pill, blurred, inside
// the pill's shape. A canvas cannot blur what lies behind a shape, so the pixels under
// it are copied back onto themselves through a blur filter, clipped to the pill. The
// copy is only of the pill's own box, in device pixels, with room for the blur to reach
// in from outside it. `radius` is in device pixels.
function blurBehind(context, left, top, width, height, radius) {
  if (!("filter" in context)) {
    return;
  }
  const m = context.getTransform();
  const corners = [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const reach = Math.ceil(radius * 3);
  const canvas = context.canvas;
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - reach);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - reach);
  const x1 = Math.min(
    canvas.width,
    Math.ceil(Math.max(...corners.map((c) => c.x))) + reach
  );
  const y1 = Math.min(
    canvas.height,
    Math.ceil(Math.max(...corners.map((c) => c.y))) + reach
  );
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  context.save();
  context.beginPath();
  context.roundRect(left, top, width, height, height / 2);
  context.clip();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = `blur(${radius}px)`;
  context.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  context.restore();
}

// The label's measurements, in screen pixels, and its colours. Every layer that draws a
// label spreads these into its own definition.
const LABEL_FONT_FAMILY = "fontra-ui-mono, fontra-ui-regular, monospace";
const LABEL_SEPARATOR = "•";
const LABEL_SHADOW_COLOR = "rgba(0, 0, 0, 0.2)";
// Figma's background blur, in CSS pixels.
const LABEL_BACKDROP_BLUR = 2;

export const LABEL_SCREEN_PARAMETERS = {
  labelFontSize: 9,
  labelSeparatorSize: 7,
  labelGap: 3,
  labelPaddingX: 8,
  labelHeight: 18,
  labelBorderWidth: 1,
};

export const LABEL_COLORS = {
  labelFillColor: "#FFFFFF",
  labelTextColor: "#303030",
  labelSeparatorColor: "#B4B4B4",
  labelBorderColor: "#1515150D",
};

export const LABEL_COLORS_DARK_MODE = {
  labelFillColor: "#303030",
  labelTextColor: "#F7F7F7",
  labelSeparatorColor: "#B4B4B4",
  labelBorderColor: "#1515150D",
};

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
    model,
    "ray"
  )) {
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
    drawReadout(context, parameters, midpoint, geometry, marker);
  }
}

function drawMarkerDimensions(context, positionedGlyph, parameters, model, controller) {
  for (const { marker, geometry, isSelected, isHovered } of eachMarker(
    positionedGlyph,
    model,
    "dimension"
  )) {
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
    drawReadout(context, parameters, midpoint, geometry, marker);
  }
}

// A curvature marker: a dot on the outline, the radius drawn to the centre of the circle
// that fits the curve there, that circle faintly, and the radius and curvature on a
// pill. A straight has no centre, so it draws its dot and reads an endless radius.
function drawMarkerCurvatures(context, positionedGlyph, parameters, model, controller) {
  for (const { marker, geometry, isSelected, isHovered } of eachMarker(
    positionedGlyph,
    model,
    "curvature"
  )) {
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
    const color = isSelected ? parameters.selectedColor : parameters.strokeColor;
    drawCurvatureGeometry(context, parameters, geometry, color, isSelected);
    drawGrips(context, parameters, geometry.grips, isSelected, isHovered, color);
    drawPill(
      context,
      parameters,
      curvatureReadoutPlace(geometry, parameters),
      curvatureReadout(geometry)
    );
  }
}

export function drawCurvatureGeometry(context, parameters, geometry, color, bold) {
  context.lineWidth = bold ? parameters.strokeWidth * 2 : parameters.strokeWidth;
  context.strokeStyle = color;
  const { point, center, radius } = geometry;
  if (!center || radius > CURVATURE_CIRCLE_LIMIT) {
    return;
  }
  strokeLine(context, point.x, point.y, center.x, center.y);
  context.save();
  context.globalAlpha *= 0.35;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, 2 * Math.PI);
  context.stroke();
  context.restore();
}

// The pill sits beside the dot on the far side from the centre, so it covers neither
// the radius line nor the curve's inside.
export function curvatureReadoutPlace(geometry, parameters) {
  const { point, center } = geometry;
  const clearance = parameters.labelHeight * 1.5;
  if (!center) {
    return { x: point.x, y: point.y + clearance };
  }
  const away = vector.normalizeVector(vector.subVectors(point, center));
  return vector.addVectors(point, vector.mulVectorScalar(away, clearance));
}

export function curvatureReadout(geometry) {
  const radius = Number.isFinite(geometry.radius) ? round(geometry.radius, 1) : "∞";
  const curvature = geometry.curvature ? geometry.curvature.toPrecision(4) : "0";
  return [`r ${radius}`, `κ ${curvature}`];
}

// Past this radius, in font units, the circle is drawn no more: it runs off far beyond
// the glyph and says nothing a nearly straight line does not.
const CURVATURE_CIRCLE_LIMIT = 3000;

const MARKER_COLORS = {
  colors: {
    strokeColor: "#08AD",
    selectedColor: "#06CF",
    staleColor: "#0BBC",
    staleLinkColor: "#0BB6",
    ...LABEL_COLORS,
  },
  colorsDarkMode: {
    strokeColor: "#6BFD",
    selectedColor: "#9EFF",
    staleColor: "#4CCC",
    staleLinkColor: "#4CC6",
    ...LABEL_COLORS_DARK_MODE,
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
    gripRadius: 4,
    hoverRingGap: 3,
    arrowSize: 7,
    ...LABEL_SCREEN_PARAMETERS,
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
    gripRadius: 4,
    hoverRingGap: 3,
    arrowSize: 7,
    ...LABEL_SCREEN_PARAMETERS,
  },
  ...MARKER_COLORS,
  draw: drawMarkerDimensions,
});

registerVisualizationLayerDefinition({
  identifier: "fontra.markers.curvature",
  name: "sidebar.user-settings.glyph.markers.curvature",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 611,
  screenParameters: {
    strokeWidth: 1,
    gripRadius: 4,
    hoverRingGap: 3,
    ...LABEL_SCREEN_PARAMETERS,
  },
  ...MARKER_COLORS,
  draw: drawMarkerCurvatures,
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
  if (preview.curvature) {
    drawCurvatureGeometry(
      context,
      parameters,
      preview.curvature,
      parameters.previewColor
    );
    drawPill(
      context,
      parameters,
      curvatureReadoutPlace(preview.curvature, parameters),
      curvatureReadout(preview.curvature)
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
  screenParameters: {
    strokeWidth: 1,
    gripRadius: 4,
    arrowSize: 7,
    ...LABEL_SCREEN_PARAMETERS,
  },
  colors: { previewColor: "#08A8", ...LABEL_COLORS },
  colorsDarkMode: { previewColor: "#6BFA", ...LABEL_COLORS_DARK_MODE },
  draw: drawPlacementPreview,
});
