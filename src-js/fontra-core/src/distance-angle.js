// Distance and Angle plugin for Fontra
// Ported from Glyphs plugin "Show Distance And Angle"

// Import necessary functions from vector.js for the new functions
import { applicationSettingsController } from "./application-settings.js";
import {
  drawLabel,
  drawPlaque,
  LABEL_TUNING,
  measureLabelAlpha,
  measureLabelFontSize,
  setLabelFont,
  setMeasureLabelFont,
} from "./canvas-labels.js";

// The measurement labels' face: Martian Mono, the pill's (canvas-labels.js). A name
// calculateBadgeDimensions recognises, so it measures in the face it will draw in.
const LABEL_MEASURE_FAMILY = "label";
import {
  calculateControlHandlePoint,
  calculateTunniPoint,
} from "./tunni-calculations.js";
import { distance } from "./vector.js";

// Color constants for distance-angle visualization
export const DISTANCE_ANGLE_COLOR = "rgba(0, 153, 255, 0.75)"; // Similar to Glyphs plugin color
export const DISTANCE_ANGLE_BADGE_COLOR = "rgba(0, 153, 255, 0.75)"; // Blue color
export const DISTANCE_ANGLE_TEXT_COLOR = "white";
export const DISTANCE_ANGLE_BADGE_PADDING = 4;
export const DISTANCE_ANGLE_BADGE_RADIUS = 5;
export const DISTANCE_ANGLE_FONT_SIZE = 7;

// Color constants for off-curve distance visualization
export const OFFCURVE_DISTANCE_COLOR = "rgba(0, 200, 0, 0.75)"; // Green color
export const OFFCURVE_DISTANCE_BADGE_COLOR = "rgba(0, 200, 0, 0.75)";
export const OFFCURVE_DISTANCE_TEXT_COLOR = "white";
export const OFFCURVE_DISTANCE_BADGE_PADDING = 4;
export const OFFCURVE_DISTANCE_BADGE_RADIUS = 5;
export const OFFCURVE_DISTANCE_FONT_SIZE = 7;

// Calculate unit vector from point B to point A
export function unitVectorFromTo(pointB, pointA) {
  let dx = pointA.x - pointB.x;
  let dy = pointA.y - pointB.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return { x: dx / length, y: dy / length };
}
// Calculate distance and angle between two points
export function calculateDistanceAndAngle(point1, point2) {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;

  // Calculate distance
  const distance = Math.hypot(dx, dy);

  // New algorithm: Identify bottom point and calculate angle from horizontal baseline
  // Determine which point is lower (has smaller y-coordinate)
  const bottomPoint = point1.y <= point2.y ? point1 : point2;
  const topPoint = point1.y <= point2.y ? point2 : point1;

  // Calculate dx and dy relative to the bottom point as origin
  const relDx = topPoint.x - bottomPoint.x;
  const relDy = topPoint.y - bottomPoint.y;

  // Calculate angle from horizontal baseline through bottom point
  let rads = Math.atan2(relDy, relDx);
  let degs = rads * (180 / Math.PI);

  // Ensure angle is always between 0 and 90 degrees
  degs = Math.abs(degs);
  if (degs > 90) {
    degs = 180 - degs;
  }

  return {
    distance: distance,
    angle: degs,
  };
}

// Calculate Manhattan distance between two points
export function calculateManhattanDistance(point1, point2) {
  const dx = Math.abs(point2.x - point1.x);
  const dy = Math.abs(point2.y - point1.y);
  return dx + dy;
}

export function calculateProjectedDistanceComponents(point1, point2) {
  return {
    dx: Math.abs(point2.x - point1.x),
    dy: Math.abs(point2.y - point1.y),
  };
}

let measuringContext = null;

// Calculate the dimensions needed for the info badge. One canvas measures them all.
// The measurement labels are measured at the tuned measure size and scaled, which is
// how they are drawn (setMeasureLabelFont): one font string at every zoom.
export function calculateBadgeDimensions(text, fontSize, fontFamily = "sans-serif") {
  measuringContext ??= document.createElement("canvas").getContext("2d");
  const context = measuringContext;
  let widthScale = 1;
  if (fontFamily === LABEL_MEASURE_FAMILY) {
    setLabelFont(context, LABEL_TUNING.measureSize);
    widthScale = fontSize / LABEL_TUNING.measureSize;
  } else {
    context.font = `${fontSize}px ${fontFamily}`;
  }

  const lines = text.split("\n");
  let maxWidth = 0;

  for (const line of lines) {
    const metrics = context.measureText(line);
    maxWidth = Math.max(maxWidth, metrics.width * widthScale);
  }

  const width = maxWidth + DISTANCE_ANGLE_BADGE_PADDING * 2;
  const height = lines.length * fontSize + DISTANCE_ANGLE_BADGE_PADDING * 2;

  return {
    width: width,
    height: height,
    radius: DISTANCE_ANGLE_BADGE_RADIUS,
  };
}

// Calculate the position for the info badge
export function calculateBadgePosition(midPoint, unitVector, badgeWidth, badgeHeight) {
  // Position the badge's center at the midpoint of the line
  // No offset is applied - the badge will be centered on the line

  // Return the top-left corner position for drawing
  return {
    x: midPoint.x - badgeWidth / 2,
    y: midPoint.y - badgeHeight / 2,
  };
}

// Format distance and angle values for display
export function formatDistanceAndAngle(distance, angle) {
  return `${distance.toFixed(1)}\n${angle.toFixed(1)}°`;
}

export function calculateHandleMeasure(segmentPoints, hoveredHandleSide) {
  if (!segmentPoints || segmentPoints.length !== 4) {
    return null;
  }
  if (hoveredHandleSide !== "start" && hoveredHandleSide !== "end") {
    return null;
  }

  const [onStart, offStart, offEnd, onEnd] = segmentPoints;
  const anchorPoint = hoveredHandleSide === "start" ? onStart : onEnd;
  const handlePoint = hoveredHandleSide === "start" ? offStart : offEnd;
  const { distance: handleDistance, angle } = calculateDistanceAndAngle(
    anchorPoint,
    handlePoint
  );

  // Per-handle tension: the ratio of this handle's length to the distance from its
  // anchor to the Tunni point. This is handle-specific (start and end differ on an
  // unbalanced curve), matching the per-handle values in the Point labels overlay.
  // Falls back to the midpoint control-handle point when the true intersection is
  // undefined (parallel handles), consistent with drawPointLabels.
  const tunniPoint =
    calculateTunniPoint(segmentPoints) || calculateControlHandlePoint(segmentPoints);
  const anchorToTunni = tunniPoint ? distance(anchorPoint, tunniPoint) : 0;
  const tension = anchorToTunni > 0 ? handleDistance / anchorToTunni : null;

  return {
    distance: handleDistance,
    angle,
    tension: Number.isFinite(tension) ? tension : null,
  };
}

// Calculate angle for off-curve points relative to X-axis
export function calculateOffCurveAngle(offCurvePoint, onCurvePoint) {
  // Calculate dx and dy relative to the on-curve point
  const dx = offCurvePoint.x - onCurvePoint.x;
  const dy = offCurvePoint.y - onCurvePoint.y;

  // Calculate angle from horizontal baseline
  let rads = Math.atan2(dy, dx);
  let degs = rads * (180 / Math.PI);

  // Ensure angle is always between 0 and 90 degrees
  degs = Math.abs(degs);
  if (degs > 90) {
    degs = 180 - degs;
  }

  return degs;
}

// Format distance and angle values for display
export function formatDistanceAngle(distance, angle) {
  return `${distance.toFixed(1)} / ${angle.toFixed(1)}°`;
}

// Format distance, tension and angle values for display
export function formatDistanceTensionAngle(distance, tension, angle) {
  return `${distance.toFixed(1)}\n${tension.toFixed(2)}\n${angle.toFixed(1)}°`;
}

// Select the correct off-curve point for Tunni tension calculation
// For a curve segment from onCurvePointA to onCurvePointB with off-curve points,
// we want to select the off-curve point that continues the curve in the correct direction
function selectCorrectOffCurvePoint(
  path,
  nextPointIndex,
  nextPointConfig,
  currentPointIndex
) {
  // If there's only one off-curve point, use it
  if (nextPointConfig.offCurvePoints.length === 1) {
    return nextPointConfig.offCurvePoints[0];
  }

  // If there are two off-curve points, we need to determine which one is correct
  if (nextPointConfig.offCurvePoints.length === 2) {
    // Get the contour information
    const [contourIndex, contourPointIndex] =
      path.getContourAndPointIndex(nextPointIndex);
    const contourInfo = path.contourInfo[contourIndex];
    const startPoint =
      contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
    const endPoint = contourInfo.endPoint;
    const numPoints = endPoint - startPoint + 1;

    // Get the indices of the two off-curve points
    const offCurvePoint1 = nextPointConfig.offCurvePoints[0];
    const offCurvePoint2 = nextPointConfig.offCurvePoints[1];

    // Find the indices of these off-curve points in the path
    let offCurveIndex1 = -1;
    let offCurveIndex2 = -1;

    for (let i = 0; i < numPoints; i++) {
      const actualPointIndex = startPoint + i;
      const point = path.getPoint(actualPointIndex);

      if (point && point.x === offCurvePoint1.x && point.y === offCurvePoint1.y) {
        offCurveIndex1 = actualPointIndex;
      }

      if (point && point.x === offCurvePoint2.x && point.y === offCurvePoint2.y) {
        offCurveIndex2 = actualPointIndex;
      }
    }

    // If we couldn't find the indices, default to the first one
    if (offCurveIndex1 === -1 || offCurveIndex2 === -1) {
      return nextPointConfig.offCurvePoints[0];
    }

    // For tension calculation, we want the off-curve point that is connected to the NEXT on-curve point
    // In a Bezier curve, the off-curve point that comes BEFORE the on-curve point in the path
    // is the one that controls the curve segment ending at that on-curve point

    // The correct off-curve point is the one that comes immediately before the next on-curve point
    // in the path sequence (accounting for contour direction)

    if (contourInfo.isClosed) {
      // For closed contours, find which off-curve point is immediately before the next on-curve point
      const normalizedNextIndex = (nextPointIndex - startPoint + numPoints) % numPoints;
      const normalizedOffCurve1 = (offCurveIndex1 - startPoint + numPoints) % numPoints;
      const normalizedOffCurve2 = (offCurveIndex2 - startPoint + numPoints) % numPoints;

      // The correct off-curve point is the one that comes right before the on-curve point
      // when moving backward in the path
      const dist1 = (normalizedNextIndex - normalizedOffCurve1 + numPoints) % numPoints;
      const dist2 = (normalizedNextIndex - normalizedOffCurve2 + numPoints) % numPoints;

      // Return the off-curve point that is closer when moving backward
      // (i.e., the one that would be encountered first when moving counter-clockwise)
      return dist1 <= dist2 ? offCurvePoint1 : offCurvePoint2;
    } else {
      // For open contours, the correct off-curve point is the one that comes before
      // the next on-curve point in the forward direction
      if (offCurveIndex1 < nextPointIndex && offCurveIndex2 < nextPointIndex) {
        // Both are before the next point, choose the one closer to it
        return offCurveIndex1 > offCurveIndex2 ? offCurvePoint1 : offCurvePoint2;
      } else if (offCurveIndex1 < nextPointIndex) {
        return offCurvePoint1;
      } else if (offCurveIndex2 < nextPointIndex) {
        return offCurvePoint2;
      } else {
        // Neither is before the next point, this shouldn't happen in a valid curve
        // Default to the first one
        return nextPointConfig.offCurvePoints[0];
      }
    }
  }

  // Default case - return the first off-curve point
  return nextPointConfig.offCurvePoints[0];
}
// Format Manhattan distance for display
export function formatManhattanDistance(distance) {
  return `${distance.toFixed(1)}`;
}

// Check if a point is an on-curve point with specific configurations
export function checkPointConfiguration(path, pointIndex) {
  // Get the point
  const point = path.getPoint(pointIndex);
  if (!point) {
    return null;
  }

  // Check if it's an on-curve point
  const pointType = path.pointTypes[pointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
  if (pointType !== 0) {
    // VarPackedPath.ON_CURVE
    return null;
  }

  // Get contour information
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  const contourInfo = path.contourInfo[contourIndex];
  const startPoint =
    contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
  const endPoint = contourInfo.endPoint;
  const numPoints = endPoint - startPoint + 1;

  // Get neighboring points
  let prevPointIndex, nextPointIndex;
  if (contourInfo.isClosed) {
    prevPointIndex = startPoint + ((contourPointIndex - 1 + numPoints) % numPoints);
    nextPointIndex = startPoint + ((contourPointIndex + 1) % numPoints);
  } else {
    prevPointIndex = contourPointIndex > 0 ? pointIndex - 1 : null;
    nextPointIndex = contourPointIndex < numPoints - 1 ? pointIndex + 1 : null;
  }

  const prevPoint = prevPointIndex !== null ? path.getPoint(prevPointIndex) : null;
  const nextPoint = nextPointIndex !== null ? path.getPoint(nextPointIndex) : null;

  const prevPointType =
    prevPointIndex !== null ? path.pointTypes[prevPointIndex] & 0x07 : null;
  const nextPointType =
    nextPointIndex !== null ? path.pointTypes[nextPointIndex] & 0x07 : null;

  // Check for smooth point with two off-curve points
  if ((path.pointTypes[pointIndex] & 0x08) !== 0) {
    // VarPackedPath.SMOOTH_FLAG
    // Smooth point - check if both neighbors are off-curve points
    if (prevPoint && nextPoint && prevPointType !== 0 && nextPointType !== 0) {
      // Both are off-curve
      return {
        type: "smooth",
        point: point,
        offCurvePoints: [prevPoint, nextPoint],
      };
    }
  }

  // Check for any type of point with only one off-curve point
  const offCurvePoints = [];
  if (prevPoint && prevPointType !== 0) {
    // Prev is off-curve
    offCurvePoints.push(prevPoint);
  }
  if (nextPoint && nextPointType !== 0) {
    // Next is off-curve
    offCurvePoints.push(nextPoint);
  }

  if (offCurvePoints.length === 1) {
    return {
      type: "single",
      point: point,
      offCurvePoints: offCurvePoints,
    };
  }

  // Check for two off-curve points (corner point with two handles)
  if (offCurvePoints.length === 2) {
    return {
      type: "corner",
      point: point,
      offCurvePoints: offCurvePoints,
    };
  }

  return null;
}

// Calculate distances from the selected on-curve point to its associated off-curve points
export function calculateDistancesToOffCurvePoints(onCurvePoint, offCurvePoints) {
  return offCurvePoints.map((offCurvePoint) => {
    const dx = offCurvePoint.x - onCurvePoint.x;
    const dy = offCurvePoint.y - onCurvePoint.y;
    const distance = Math.hypot(dx, dy);
    return {
      point: offCurvePoint,
      distance: distance,
    };
  });
}

// Check if an off-curve point is associated with an eligible on-curve point
export function checkOffCurvePointConfiguration(path, pointIndex) {
  // Get the point
  const point = path.getPoint(pointIndex);
  if (!point) {
    return null;
  }

  // Check if it's an off-curve point
  const pointType = path.pointTypes[pointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
  if (pointType === 0) {
    // VarPackedPath.ON_CURVE
    return null;
  }

  // Get contour information
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  const contourInfo = path.contourInfo[contourIndex];
  const startPoint =
    contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
  const endPoint = contourInfo.endPoint;
  const numPoints = endPoint - startPoint + 1;

  // Get neighboring points
  let prevPointIndex, nextPointIndex;
  if (contourInfo.isClosed) {
    prevPointIndex = startPoint + ((contourPointIndex - 1 + numPoints) % numPoints);
    nextPointIndex = startPoint + ((contourPointIndex + 1) % numPoints);
  } else {
    prevPointIndex = contourPointIndex > 0 ? pointIndex - 1 : null;
    nextPointIndex = contourPointIndex < numPoints - 1 ? pointIndex + 1 : null;
  }

  const prevPoint = prevPointIndex !== null ? path.getPoint(prevPointIndex) : null;
  const nextPoint = nextPointIndex !== null ? path.getPoint(nextPointIndex) : null;

  const prevPointType =
    prevPointIndex !== null ? path.pointTypes[prevPointIndex] & 0x07 : null;
  const nextPointType =
    nextPointIndex !== null ? path.pointTypes[nextPointIndex] & 0x07 : null;

  // Check if either neighbor is an on-curve point that is eligible
  let onCurvePoint = null;
  if (prevPoint && prevPointType === 0) {
    // VarPackedPath.ON_CURVE
    onCurvePoint = prevPoint;
  } else if (nextPoint && nextPointType === 0) {
    // VarPackedPath.ON_CURVE
    onCurvePoint = nextPoint;
  }

  // If we found an on-curve neighbor, check if it's eligible
  if (onCurvePoint) {
    // Check if the on-curve point is eligible by using the existing checkPointConfiguration function
    // but we need to get its index first
    let onCurvePointIndex = null;
    if (prevPoint && prevPointType === 0) {
      onCurvePointIndex = prevPointIndex;
    } else if (nextPoint && nextPointType === 0) {
      onCurvePointIndex = nextPointIndex;
    }

    if (onCurvePointIndex !== null) {
      const onCurveConfig = checkPointConfiguration(path, onCurvePointIndex);
      if (onCurveConfig) {
        // Return the configuration with the on-curve point and this off-curve point
        return {
          type: "offcurve",
          point: onCurvePoint,
          offCurvePoints: [point],
        };
      }
    }
  }

  return null;
}

// Calculate distances from a selected on-curve point to its associated off-curve points
// or from a selected off-curve point to its associated on-curve point
export function calculateDistancesFromPoint(pointIndex, path) {
  // First check if it's a valid on-curve point with associated off-curve points
  let pointConfig = checkPointConfiguration(path, pointIndex);

  // If not, check if it's an off-curve point associated with an eligible on-curve point
  if (!pointConfig) {
    pointConfig = checkOffCurvePointConfiguration(path, pointIndex);
  }

  // If the point is not a valid point with associated points, return null
  if (!pointConfig) {
    return null;
  }

  // Calculate distances to the associated points
  const distances = calculateDistancesToOffCurvePoints(
    pointConfig.point,
    pointConfig.offCurvePoints
  );

  // Return the point configuration type and the calculated distances
  return {
    type: pointConfig.type,
    point: pointConfig.point,
    distances: distances,
  };
}

// Draw a line between two points
export function drawLine(context, point1, point2, strokeWidth, color) {
  context.strokeStyle = color;
  context.lineWidth = strokeWidth;
  strokeLine(context, point1.x, point1.y, point2.x, point2.y);
}

// Draw a rounded rectangle badge
export function drawBadge(context, x, y, width, height, radius, color) {
  context.fillStyle = color;

  // Draw rounded rectangle
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
}

// Draw text at specified position
export function drawText(context, text, x, y, color, fontSize) {
  context.save();
  context.fillStyle = color;
  context.font = `${fontSize}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.scale(1, -1);

  const lines = text.split("\n");
  const lineHeight = fontSize;
  const totalHeight = lines.length * lineHeight;

  // Draw each line centered
  for (let i = 0; i < lines.length; i++) {
    const lineY = -y - totalHeight / 2 + (i + 0.5) * lineHeight;
    context.fillText(lines[i], x, lineY);
  }

  context.restore();
}

// Draw distance and angle visualization
export function drawDistanceAngleVisualization(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  // Get the selected points
  const { point: selectedPointIndices } = parseSelection(model.selection);

  // We need exactly two points to show distance and angle
  if (!selectedPointIndices || selectedPointIndices.length !== 2) {
    return;
  }

  // Get the actual points from the path
  const path = positionedGlyph.glyph.path;
  const point1 = path.getPoint(selectedPointIndices[0]);
  const point2 = path.getPoint(selectedPointIndices[1]);

  if (!point1 || !point2) {
    return;
  }

  // Draw line between points
  drawLine(context, point1, point2, parameters.strokeWidth, parameters.strokeColor);

  // Calculate distance and angle
  const { distance, angle } = calculateDistanceAndAngle(point1, point2);

  // Format text for display
  const text = formatDistanceAndAngle(distance, angle);

  // Calculate midpoint
  const midPoint = {
    x: (point1.x + point2.x) / 2,
    y: (point1.y + point2.y) / 2,
  };

  // Calculate badge dimensions
  const badgeDimensions = calculateBadgeDimensions(text, DISTANCE_ANGLE_FONT_SIZE);

  // Calculate unit vector perpendicular to the line
  const unitVector = unitVectorFromTo(point1, point2);

  // Calculate badge position
  const badgePosition = calculateBadgePosition(
    midPoint,
    { x: -unitVector.y, y: unitVector.x },
    badgeDimensions.width,
    badgeDimensions.height
  );

  // Draw badge
  drawBadge(
    context,
    badgePosition.x,
    badgePosition.y,
    badgeDimensions.width,
    badgeDimensions.height,
    DISTANCE_ANGLE_BADGE_RADIUS,
    DISTANCE_ANGLE_BADGE_COLOR
  );

  // Draw text
  drawText(
    context,
    text,
    badgePosition.x + badgeDimensions.width / 2,
    badgePosition.y + badgeDimensions.height / 2,
    DISTANCE_ANGLE_TEXT_COLOR,
    DISTANCE_ANGLE_FONT_SIZE
  );
}
// Draw Manhattan distance visualization
export function drawManhattanDistanceVisualization(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  // Get the selected points
  const { point: selectedPointIndices } = parseSelection(model.selection);

  // We need exactly two points to show Manhattan distance
  if (!selectedPointIndices || selectedPointIndices.length !== 2) {
    return;
  }

  // Get the actual points from the path
  const path = positionedGlyph.glyph.path;
  const point1 = path.getPoint(selectedPointIndices[0]);
  const point2 = path.getPoint(selectedPointIndices[1]);

  if (!point1 || !point2) {
    return;
  }

  // Calculate dx and dy as absolute differences
  const dx = Math.abs(point2.x - point1.x);
  const dy = Math.abs(point2.y - point1.y);

  // Check if either dx or dy is zero (meaning points are aligned)
  if (dx === 0 || dy === 0) {
    // Points are aligned, show only the direct distance
    const distance = Math.hypot(dx, dy);

    // Draw line between points
    drawLine(context, point1, point2, parameters.strokeWidth, parameters.strokeColor);

    // Format text for display
    const text = formatManhattanDistance(distance);

    // Calculate midpoint
    const midPoint = {
      x: (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
    };

    // Calculate badge dimensions
    const badgeDimensions = calculateBadgeDimensions(text, DISTANCE_ANGLE_FONT_SIZE);

    // Calculate unit vector perpendicular to the line
    const unitVector = unitVectorFromTo(point1, point2);

    // Calculate badge position
    const badgePosition = calculateBadgePosition(
      midPoint,
      { x: -unitVector.y, y: unitVector.x },
      badgeDimensions.width,
      badgeDimensions.height
    );

    // Draw badge
    drawBadge(
      context,
      badgePosition.x,
      badgePosition.y,
      badgeDimensions.width,
      badgeDimensions.height,
      DISTANCE_ANGLE_BADGE_RADIUS,
      DISTANCE_ANGLE_BADGE_COLOR
    );

    // Draw text
    drawText(
      context,
      text,
      badgePosition.x + badgeDimensions.width / 2,
      badgePosition.y + badgeDimensions.height / 2,
      DISTANCE_ANGLE_TEXT_COLOR,
      DISTANCE_ANGLE_FONT_SIZE
    );

    return;
  }

  // Points are not aligned, show the Manhattan visualization with separate X and Y measurements
  // Calculate Manhattan distance
  const manhattanDistance = calculateManhattanDistance(point1, point2);

  // Create the corner point for the right angle path (horizontal first, then vertical)
  const cornerPoint = { x: point2.x, y: point1.y };

  // Draw the horizontal line from point1 to cornerPoint
  drawLine(
    context,
    point1,
    cornerPoint,
    parameters.strokeWidth,
    parameters.strokeColor
  );

  // Draw the vertical line from cornerPoint to point2
  drawLine(
    context,
    cornerPoint,
    point2,
    parameters.strokeWidth,
    parameters.strokeColor
  );

  // Format text for separate measurements
  const dxText = dx.toFixed(1);
  const dyText = dy.toFixed(1);

  // Calculate midpoint of horizontal segment for dx badge positioning
  const hMidPoint = {
    x: (point1.x + cornerPoint.x) / 2,
    y: (point1.y + cornerPoint.y) / 2,
  };

  // Calculate midpoint of vertical segment for dy badge positioning
  const vMidPoint = {
    x: (cornerPoint.x + point2.x) / 2,
    y: (cornerPoint.y + point2.y) / 2,
  };

  // Calculate badge dimensions for each text
  const dxBadgeDimensions = calculateBadgeDimensions(dxText, DISTANCE_ANGLE_FONT_SIZE);
  const dyBadgeDimensions = calculateBadgeDimensions(dyText, DISTANCE_ANGLE_FONT_SIZE);

  // Calculate unit vectors for badge positioning
  // For horizontal segment, perpendicular vector points vertically
  const hUnitVector = { x: 0, y: 1 };
  // For vertical segment, perpendicular vector points horizontally
  const vUnitVector = { x: 1, y: 0 };

  // Calculate badge positions
  const dxBadgePosition = calculateBadgePosition(
    hMidPoint,
    hUnitVector,
    dxBadgeDimensions.width,
    dxBadgeDimensions.height
  );

  const dyBadgePosition = calculateBadgePosition(
    vMidPoint,
    vUnitVector,
    dyBadgeDimensions.width,
    dyBadgeDimensions.height
  );

  // Draw badges
  drawBadge(
    context,
    dxBadgePosition.x,
    dxBadgePosition.y,
    dxBadgeDimensions.width,
    dxBadgeDimensions.height,
    DISTANCE_ANGLE_BADGE_RADIUS,
    DISTANCE_ANGLE_BADGE_COLOR
  );
  drawBadge(
    context,
    dyBadgePosition.x,
    dyBadgePosition.y,
    dyBadgeDimensions.width,
    dyBadgeDimensions.height,
    DISTANCE_ANGLE_BADGE_RADIUS,
    DISTANCE_ANGLE_BADGE_COLOR
  );

  // Draw text
  drawText(
    context,
    dxText,
    dxBadgePosition.x + dxBadgeDimensions.width / 2,
    dxBadgePosition.y + dxBadgeDimensions.height / 2,
    DISTANCE_ANGLE_TEXT_COLOR,
    DISTANCE_ANGLE_FONT_SIZE
  );
  drawText(
    context,
    dyText,
    dyBadgePosition.x + dyBadgeDimensions.width / 2,
    dyBadgePosition.y + dyBadgeDimensions.height / 2,
    DISTANCE_ANGLE_TEXT_COLOR,
    DISTANCE_ANGLE_FONT_SIZE
  );
}

// Draw off-curve distance visualization
export function drawOffCurveDistanceVisualization(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  // Get the selected points
  const { point: selectedPointIndices } = parseSelection(model.selection);

  // We need at least one point to show off-curve distances
  if (!selectedPointIndices || selectedPointIndices.length === 0) {
    return;
  }

  // Get the path
  const path = positionedGlyph.glyph.path;

  // Group selected off-curve points by their associated on-curve points
  const offCurveGroups = new Map(); // Map of on-curve point index -> array of off-curve points

  // Process each selected point to identify off-curve points and their associated on-curve points
  for (const pointIndex of selectedPointIndices) {
    // First check if this is an off-curve point
    const pointType = path.pointTypes[pointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
    // Skip if it's not an off-curve point
    if (pointType === 0) {
      // VarPackedPath.ON_CURVE
      continue;
    }

    // Find the associated on-curve point for this off-curve point
    const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
    const contourInfo = path.contourInfo[contourIndex];
    const startPoint =
      contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
    const endPoint = contourInfo.endPoint;
    const numPoints = endPoint - startPoint + 1;

    // Get neighboring points
    let prevPointIndex, nextPointIndex;
    if (contourInfo.isClosed) {
      prevPointIndex = startPoint + ((contourPointIndex - 1 + numPoints) % numPoints);
      nextPointIndex = startPoint + ((contourPointIndex + 1) % numPoints);
    } else {
      prevPointIndex = contourPointIndex > 0 ? pointIndex - 1 : null;
      nextPointIndex = contourPointIndex < numPoints - 1 ? pointIndex + 1 : null;
    }

    // Check if either neighbor is an on-curve point
    let onCurvePointIndex = null;
    if (prevPointIndex !== null) {
      const prevPointType = path.pointTypes[prevPointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
      if (prevPointType === 0) {
        // VarPackedPath.ON_CURVE
        onCurvePointIndex = prevPointIndex;
      }
    }

    if (onCurvePointIndex === null && nextPointIndex !== null) {
      const nextPointType = path.pointTypes[nextPointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
      if (nextPointType === 0) {
        // VarPackedPath.ON_CURVE
        onCurvePointIndex = nextPointIndex;
      }
    }

    // If we found an associated on-curve point, group this off-curve point with it
    if (onCurvePointIndex !== null) {
      if (!offCurveGroups.has(onCurvePointIndex)) {
        offCurveGroups.set(onCurvePointIndex, []);
      }
      offCurveGroups.get(onCurvePointIndex).push({
        index: pointIndex,
        point: path.getPoint(pointIndex),
      });
    }
  }

  // Process each group of off-curve points
  for (const [onCurvePointIndex, offCurvePoints] of offCurveGroups.entries()) {
    const onCurvePoint = path.getPoint(onCurvePointIndex);

    // Get the next on-curve point for tension calculation
    let nextPoint = null;
    let nextPointIndex = null;
    const [contourIndex, contourPointIndex] =
      path.getContourAndPointIndex(onCurvePointIndex);
    const contourInfo = path.contourInfo[contourIndex];
    const startPoint =
      contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
    const endPoint = contourInfo.endPoint;
    const numPoints = endPoint - startPoint + 1;

    // Get next on-curve point index
    if (contourInfo.isClosed) {
      // For closed contours, search for the next on-curve point
      let searchIndex = (contourPointIndex + 1) % numPoints;
      while (searchIndex !== contourPointIndex) {
        // Avoid infinite loop
        const actualPointIndex = startPoint + searchIndex;
        const pointType = path.pointTypes[actualPointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
        if (pointType === 0) {
          // VarPackedPath.ON_CURVE
          nextPointIndex = actualPointIndex;
          break;
        }
        searchIndex = (searchIndex + 1) % numPoints;
      }
    } else {
      // For open contours, search forward for the next on-curve point
      for (let i = contourPointIndex + 1; i < numPoints; i++) {
        const actualPointIndex = startPoint + i;
        const pointType = path.pointTypes[actualPointIndex] & 0x07; // VarPackedPath.POINT_TYPE_MASK
        if (pointType === 0) {
          // VarPackedPath.ON_CURVE
          nextPointIndex = actualPointIndex;
          break;
        }
      }
    }

    nextPoint = nextPointIndex !== null ? path.getPoint(nextPointIndex) : null;

    // Process each off-curve point in this group
    for (const offCurvePointData of offCurvePoints) {
      const offCurvePoint = offCurvePointData.point;
      const offCurvePointIndex = offCurvePointData.index;

      // Calculate distance from on-curve point to off-curve point
      const dx = offCurvePoint.x - onCurvePoint.x;
      const dy = offCurvePoint.y - onCurvePoint.y;
      const distance = Math.hypot(dx, dy);

      // Calculate angle for the off-curve point
      let angle = 0;

      if (nextPoint && nextPointIndex !== null) {
        // Calculate angle for the off-curve point
        angle = calculateOffCurveAngle(offCurvePoint, onCurvePoint);
      }

      // Draw line between points
      drawLine(
        context,
        onCurvePoint,
        offCurvePoint,
        parameters.strokeWidth,
        parameters.strokeColor
      );

      // Format text for display with distance and angle
      const text = formatDistanceAngle(distance, angle);

      // Calculate midpoint
      const midPoint = {
        x: (onCurvePoint.x + offCurvePoint.x) / 2,
        y: (onCurvePoint.y + offCurvePoint.y) / 2,
      };

      // Calculate unit vector perpendicular to the line
      const unitVector = unitVectorFromTo(onCurvePoint, offCurvePoint);

      // Calculate perpendicular vector (rotated 90 degrees counter-clockwise)
      const perpVector = { x: -unitVector.y, y: unitVector.x };

      // Ensure consistent positioning above the line
      // Due to the context.scale(1, -1) transformation, "above" means positive y values
      const textOffset = 8; // pixels offset from the line
      const consistentPerpVector =
        perpVector.y >= 0
          ? perpVector
          : {
              x: -perpVector.x,
              y: -perpVector.y,
            };

      // Position text consistently above the line using the consistent perpendicular vector
      const textPosition = {
        x: midPoint.x + consistentPerpVector.x * textOffset,
        y: midPoint.y + consistentPerpVector.y * textOffset,
      };

      // Draw text without badge
      context.save();
      context.fillStyle = "rgba(26, 82, 26, 1)";
      context.font = `${OFFCURVE_DISTANCE_FONT_SIZE}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "alphabetic"; // Align baseline with the line
      context.scale(1, -1);

      // Apply -1% tracking (letter spacing)
      // Note: letterSpacing might not be supported in all browsers, but we'll try to use it
      // As a fallback, we can use canvas's built-in letter spacing if available
      if (context.letterSpacing !== undefined) {
        context.letterSpacing = "-0.11px"; // -1% of font size 11
      }

      // Draw the text with proper positioning
      context.fillText(text, textPosition.x, -textPosition.y);
      context.restore();
    }
  }
}

// Drawing helper functions (needed for the visualization functions)
export function strokeLine(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function parseSelection(selection) {
  const result = {};
  for (const item of selection || []) {
    const [type, index] = item.split("/");
    if (type) {
      if (!result[type]) {
        result[type] = [];
      }
      result[type].push(parseInt(index) || index);
    }
  }
  return result;
}
// Helper functions needed for drawTunniHandleDistance
// Note: This function is already exported elsewhere, so we'll remove this duplicate

function drawRoundRect(context, x, y, width, height, radii) {
  // older versions of Safari don't support roundRect,
  // so we use rect instead
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radii);
  } else {
    context.rect(x, y, width, height);
  }
  context.fill();
}

/**
 * Draw Tunni handle tension visualization
 * @param {CanvasRenderingContext2D} context - The canvas context
 * @param {Object} positionedGlyph - The positioned glyph
 * @param {Object} parameters - Visualization parameters
 * @param {Object} model - The model
 * @param {Object} controller - The controller
 */

// One line of point-label text, in the same face, size and left-aligned baseline
// the handle badges use, at a glyph-space position a caller has already offset.
// The y flip is local: the canvas is upside down for text.
export function drawPointStyleLabel(context, x, y, text, color) {
  const size = measureLabelFontSize(context);
  context.save();
  context.globalAlpha *= measureLabelAlpha(context);
  context.scale(1, -1);
  const k = setMeasureLabelFont(context, size);
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(String(text), x / k, -y / k);
  context.restore();
}

// Distance/tension/angle badges for one cubic segment's two handles.
// Shared by the path "Point labels" layer and the skeleton point labels layer.
export function drawCubicHandleLabelPair(context, points, show = {}) {
  const showDistance = show.distance ?? true;
  const showTension = show.tension ?? true;
  const showAngle = show.angle ?? true;
  const [p1, p2, p3, p4] = points;

  // Calculate Tunni point for visualization (keep midpoint)
  const visualPt = calculateControlHandlePoint(points);

  // Calculate true Tunni point for tension calculations
  const truePt = calculateTunniPoint(points);

  // Calculate tensions using the true intersection point (with fallback to midpoint)
  const tensionPt1 = truePt || visualPt;
  const tensionPt2 = truePt || visualPt;
  const tension1 = distance(p1, p2) / distance(p1, tensionPt1); // tension for p2
  const tension2 = distance(p4, p3) / distance(p4, tensionPt2); // tension for p3

  // Calculate distances from on-curve to off-curve points
  const dist1 = distance(p1, p2); // distance for p2
  const dist2 = distance(p4, p3); // distance for p3

  // Calculate angles for off-curve points
  const angle1 = calculateOffCurveAngle(p2, p1); // angle for p2
  const angle2 = calculateOffCurveAngle(p3, p4); // angle for p3

  const visibleComponents = [];
  if (showDistance) visibleComponents.push(dist1.toFixed(1));
  if (showTension) visibleComponents.push(tension1.toFixed(2));
  if (showAngle) visibleComponents.push(`${angle1.toFixed(1)}°`);
  const text1 = visibleComponents.join("\n");

  // Same logic for text2
  const visibleComponents2 = [];
  if (showDistance) visibleComponents2.push(dist2.toFixed(1));
  if (showTension) visibleComponents2.push(tension2.toFixed(2));
  if (showAngle) visibleComponents2.push(`${angle2.toFixed(1)}°`);
  const text2 = visibleComponents2.join("\n");

  drawHandleLabel(context, p2, p1, visibleComponents, HANDLE_LABEL_COLOR);
  drawHandleLabel(context, p3, p4, visibleComponents2, HANDLE_LABEL_COLOR);
}

// grey/solid/3: lighter than the near-black the labels had.
const HANDLE_LABEL_COLOR = "#565656";

// One handle's measurement lines, centred over the handle and stacked beyond its
// tip: above a handle that points up from its on-curve point, below one that points
// down. The size is 6 font units by default, never under the tuned minimum on
// screen (measureLabelFontSize); the gap and line spacing grow with it.
// One screen pixel in the context's current units.
function screenPixel(context) {
  const m = context.getTransform();
  return (globalThis.devicePixelRatio || 1) / Math.hypot(m.a, m.b);
}

export function drawHandleLabel(context, handle, onCurve, lines, color) {
  if (!lines.length) {
    return;
  }
  const size = measureLabelFontSize(context);
  // The Figma label's 12 over 9 line, and two screen pixels more between values.
  const lineHeight = size * 1.33 + 2 * screenPixel(context);
  const gap = size * 1.2;
  const blockHeight = lines.length * lineHeight;
  const up = handle.y >= onCurve.y;
  // Screen y (down) of the block's top.
  const top = up ? -handle.y - gap - blockHeight : -handle.y + gap;
  context.save();
  context.globalAlpha *= measureLabelAlpha(context);
  context.fillStyle = color;
  context.scale(1, -1);
  const k = setMeasureLabelFont(context, size);
  // Left-aligned lines, the block as a whole centred on the handle.
  const width = Math.max(...lines.map((line) => context.measureText(line).width));
  context.textAlign = "left";
  context.textBaseline = "middle";
  lines.forEach((line, i) => {
    context.fillText(
      line,
      handle.x / k - width / 2,
      (top + (i + 0.5) * lineHeight) / k
    );
  });
  context.restore();
}

// `hiddenContourIndices` names contours whose handles are not control surfaces
// right now, so their labels are not drawn either. Null means every contour is
// labelled, which is the plain case.
export function drawPointLabels(
  context,
  positionedGlyph,
  parameters,
  model,
  controller,
  hiddenContourIndices = null
) {
  const path = positionedGlyph.glyph.path;

  // Which label kinds to draw: the single persisted store the Measurements
  // accordion checkboxes write (ticket 28), not the unpersisted scene settings.
  const settings = applicationSettingsController.model;
  const showDistance = settings.showLabelsDistance ?? true;
  const showTension = settings.showLabelsTension ?? true;
  const showAngle = settings.showLabelsAngle ?? false;

  // Save context state
  context.save();

  // Iterate through all contours
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    if (hiddenContourIndices?.has(contourIndex)) {
      continue;
    }
    // Iterate through all segments in the contour
    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      // Check if it's a cubic segment (4 points)
      if (segment.points.length === 4) {
        // Check if it's a cubic segment with two off-curve control points
        const pointTypes = segment.parentPointIndices.map(
          (index) => path.pointTypes[index]
        );

        // Both control points must be cubic (type 2)
        if (pointTypes[1] === 2 && pointTypes[2] === 2) {
          try {
            drawCubicHandleLabelPair(context, segment.points, {
              distance: showDistance,
              tension: showTension,
              angle: showAngle,
            });
          } catch (error) {
            // Skip segments where tension calculation fails
            console.warn("Failed to calculate handle tensions:", error);
          }
        }
      }
    }
  }

  // Now also handle off-curve points connected to on-curve points (for distance and angle only)
  // Iterate through all points in the path
  for (let pointIndex = 0; pointIndex < path.numPoints; pointIndex++) {
    const pointType = path.pointTypes[pointIndex];

    if (hiddenContourIndices?.has(path.getContourIndex(pointIndex))) {
      continue;
    }

    // Check if this is an off-curve point
    if (pointType !== 0) {
      // Not an on-curve point
      const offCurvePoint = path.getPoint(pointIndex);

      // Check if this point was already processed as part of a cubic segment
      // We need to check if this point is part of any cubic segment to avoid duplication
      let isPartOfCubicSegment = false;

      // Iterate through all contours to check if this point is part of a cubic segment
      for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
        for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
          if (segment.points.length === 4) {
            // Check if it's a cubic segment (two off-curve points)
            const pointTypes = segment.parentPointIndices.map(
              (index) => path.pointTypes[index]
            );

            if (pointTypes[1] === 2 && pointTypes[2] === 2) {
              // Both are cubic control points
              // Check if our current pointIndex matches either of the control points in this segment
              if (
                segment.parentPointIndices[1] === pointIndex ||
                segment.parentPointIndices[2] === pointIndex
              ) {
                isPartOfCubicSegment = true;
                break;
              }
            }
          }
        }
        if (isPartOfCubicSegment) {
          break;
        }
      }

      // Skip if this point was already processed as part of a cubic segment
      if (isPartOfCubicSegment) {
        continue;
      }

      // Get contour information
      const [contourIndex, contourPointIndex] =
        path.getContourAndPointIndex(pointIndex);
      const contourInfo = path.contourInfo[contourIndex];
      const startPoint =
        contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
      const endPoint = contourInfo.endPoint;
      const numPoints = endPoint - startPoint + 1;

      // Get neighboring points
      let prevPointIndex, nextPointIndex;
      if (contourInfo.isClosed) {
        prevPointIndex = startPoint + ((contourPointIndex - 1 + numPoints) % numPoints);
        nextPointIndex = startPoint + ((contourPointIndex + 1) % numPoints);
      } else {
        prevPointIndex = contourPointIndex > 0 ? pointIndex - 1 : -1;
        nextPointIndex = contourPointIndex < numPoints - 1 ? pointIndex + 1 : -1;
      }

      const prevPoint = prevPointIndex >= 0 ? path.getPoint(prevPointIndex) : null;
      const nextPoint = nextPointIndex >= 0 ? path.getPoint(nextPointIndex) : null;

      const prevPointType = prevPointIndex >= 0 ? path.pointTypes[prevPointIndex] : -1;
      const nextPointType = nextPointIndex >= 0 ? path.pointTypes[nextPointIndex] : -1;

      // Check if either neighbor is an on-curve point
      let onCurvePoint = null;
      let onCurveIndex = -1;

      if (prevPoint && prevPointType === 0) {
        // Previous is on-curve
        onCurvePoint = prevPoint;
        onCurveIndex = prevPointIndex;
      } else if (nextPoint && nextPointType === 0) {
        // Next is on-curve
        onCurvePoint = nextPoint;
        onCurveIndex = nextPointIndex;
      }

      // If we found an on-curve neighbor, calculate and display distance and angle only
      if (onCurvePoint && onCurveIndex >= 0) {
        try {
          // Calculate distance from on-curve to off-curve point
          const dist = distance(onCurvePoint, offCurvePoint);

          // Calculate angle for off-curve point relative to on-curve point
          const angle = calculateOffCurveAngle(offCurvePoint, onCurvePoint);

          // For off-curve points not part of cubic segments, we'll only show distance and angle (no tension)
          // Format text for display - distance, angle (top to bottom) based on visibility settings
          const visibleComponentsOff = [];
          if (showDistance) visibleComponentsOff.push(dist.toFixed(1));
          // No tension for off-curve points not part of cubic segments
          if (showAngle) visibleComponentsOff.push(`${angle.toFixed(1)}°`);
          const text = visibleComponentsOff.join("\n");

          // Calculate badge dimensions for the label
          const sizeOff = measureLabelFontSize(context);
          const badgeDimensionsOff = calculateBadgeDimensions(
            text,
            sizeOff,
            LABEL_MEASURE_FAMILY
          );

          // Calculate unit vector from on-curve to off-curve point for label positioning
          const unitVectorOff = unitVectorFromTo(onCurvePoint, offCurvePoint);

          // Calculate badge position and shift to the right of the off-curve point
          const badgePositionOff = calculateBadgePosition(
            { x: offCurvePoint.x + (8 * sizeOff) / 6, y: offCurvePoint.y }, // Shift to the right
            { x: -unitVectorOff.y, y: unitVectorOff.x },
            badgeDimensionsOff.width,
            badgeDimensionsOff.height
          );

          // Draw text with distance, angle (top to bottom)
          context.save();
          context.globalAlpha *= measureLabelAlpha(context);
          context.fillStyle = "rgba(44, 28, 44, 1)"; // New text color
          const k = setMeasureLabelFont(context, sizeOff);
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.scale(1, -1);

          // Split the text into lines and draw each line
          const linesOff = text.split("\n");
          const lineHeightOff = sizeOff;
          const totalHeightOff = linesOff.length * lineHeightOff;
          const startYOff =
            -(badgePositionOff.y + badgeDimensionsOff.height / 2) -
            totalHeightOff / 2 +
            lineHeightOff / 2;

          for (let i = 0; i < linesOff.length; i++) {
            context.fillText(
              linesOff[i],
              badgePositionOff.x / k,
              (startYOff + i * lineHeightOff) / k
            );
          }

          context.restore();
        } catch (error) {
          // Skip if calculation fails
          console.warn("Failed to calculate off-curve distance/angle:", error);
        }
      }
    }
  }

  // Restore context state
  context.restore();
}

// The distances Q reads from a selection's box `a` to a hovered box `b`, the way Figma
// measures between two layers. A point is a box of no size.
//
//   Apart along x, overlapping along y (side by side): the one gap across, drawn
//     through the middle of the height they share.
//   Apart along both: the gap across and the gap up, drawn from the middle of the
//     selection, each with a guide running on to the hovered box's edge.
//   Overlapping along both (one inside the other, or crossing): the distance from
//     each of the selection's edges to the hovered box's same edge, leaving out an
//     edge they share.
//
// Each measure is {p1, p2, value, guide?}.
export function boxDistanceMeasures(a, b) {
  const overlapsX = Math.max(a.xMin, b.xMin) <= Math.min(a.xMax, b.xMax);
  const overlapsY = Math.max(a.yMin, b.yMin) <= Math.min(a.yMax, b.yMax);
  const centerX = (a.xMin + a.xMax) / 2;
  const centerY = (a.yMin + a.yMax) / 2;
  const measures = [];

  if (overlapsX && overlapsY) {
    const edge = (p1, p2, value) => {
      if (value > BOX_EDGE_EPSILON) {
        measures.push({ p1, p2, value });
      }
    };
    for (const key of ["xMin", "xMax"]) {
      const [x1, x2] = [Math.min(a[key], b[key]), Math.max(a[key], b[key])];
      edge({ x: x1, y: centerY }, { x: x2, y: centerY }, x2 - x1);
    }
    for (const key of ["yMin", "yMax"]) {
      const [y1, y2] = [Math.min(a[key], b[key]), Math.max(a[key], b[key])];
      edge({ x: centerX, y: y1 }, { x: centerX, y: y2 }, y2 - y1);
    }
    return measures;
  }

  if (!overlapsX) {
    const bIsRight = b.xMin >= a.xMax;
    const [x1, x2] = bIsRight ? [a.xMax, b.xMin] : [b.xMax, a.xMin];
    const edgeX = bIsRight ? b.xMin : b.xMax;
    const measure = {
      p1: { x: x1, y: 0 },
      p2: { x: x2, y: 0 },
      value: x2 - x1,
    };
    if (overlapsY) {
      const y = (Math.max(a.yMin, b.yMin) + Math.min(a.yMax, b.yMax)) / 2;
      measure.p1.y = measure.p2.y = y;
    } else {
      measure.p1.y = measure.p2.y = centerY;
      measure.guide = {
        p1: { x: edgeX, y: centerY },
        p2: { x: edgeX, y: b.yMin > centerY ? b.yMin : b.yMax },
      };
    }
    measures.push(measure);
  }

  if (!overlapsY) {
    const bIsAbove = b.yMin >= a.yMax;
    const [y1, y2] = bIsAbove ? [a.yMax, b.yMin] : [b.yMax, a.yMin];
    const edgeY = bIsAbove ? b.yMin : b.yMax;
    const measure = {
      p1: { x: 0, y: y1 },
      p2: { x: 0, y: y2 },
      value: y2 - y1,
    };
    if (overlapsX) {
      const x = (Math.max(a.xMin, b.xMin) + Math.min(a.xMax, b.xMax)) / 2;
      measure.p1.x = measure.p2.x = x;
    } else {
      measure.p1.x = measure.p2.x = centerX;
      measure.guide = {
        p1: { x: centerX, y: edgeY },
        p2: { x: b.xMin > centerX ? b.xMin : b.xMax, y: edgeY },
      };
    }
    measures.push(measure);
  }
  return measures;
}

const BOX_EDGE_EPSILON = 0.05;

export function drawMeasureOverlay(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  if (!model.measureMode) return;

  const {
    measureHoverSegment,
    measureHoverHandle,
    measureHoverPoints,
    measureHoverSkeletonRib,
    measureHoverSelectionDistance,
    measureShowDirect,
  } = model;

  // Figma's measure: from the selection to what is hovered. Under Alt, from one
  // selected point to a hovered point, direct with its angle; otherwise the gaps
  // between the two boxes, each on its pill, with a guide where a gap is measured
  // beside the hovered box rather than against it.
  if (measureHoverSelectionDistance) {
    const color = parameters.pathColor;
    const { selectionBox, hoveredBox, direct } = measureHoverSelectionDistance;
    // A contour or a component is measured by its box, which is nowhere on screen,
    // so the box is drawn thin. A point is its own box and needs none.
    if (hoveredBox.xMax > hoveredBox.xMin || hoveredBox.yMax > hoveredBox.yMin) {
      context.save();
      context.strokeStyle = color;
      context.lineWidth = parameters.strokeWidth;
      context.setLineDash([]);
      context.strokeRect(
        hoveredBox.xMin,
        hoveredBox.yMin,
        hoveredBox.xMax - hoveredBox.xMin,
        hoveredBox.yMax - hoveredBox.yMin
      );
      context.restore();
    }
    if (measureShowDirect && direct) {
      const { distance: dist, angle } = calculateDistanceAndAngle(direct.p1, direct.p2);
      drawMeasureLine(
        context,
        direct.p1,
        direct.p2,
        [dist.toFixed(1), `${angle.toFixed(1)}°`],
        color,
        parameters
      );
      return;
    }
    for (const measure of boxDistanceMeasures(selectionBox, hoveredBox)) {
      if (measure.guide) {
        drawMeasureGuideLine(
          context,
          measure.guide.p1,
          measure.guide.p2,
          color,
          parameters
        );
      }
      drawMeasureLine(
        context,
        measure.p1,
        measure.p2,
        measure.value.toFixed(1),
        color,
        parameters
      );
    }
    return;
  }

  if (measureHoverHandle) {
    const { p1, p2, type } = measureHoverHandle;
    const segmentColor =
      type === "skeleton" ? parameters.skeletonColor : parameters.pathColor;
    const tensionContext = measureHoverHandle.tensionContext;
    const handleMeasure = calculateHandleMeasure(
      tensionContext?.segmentPoints,
      tensionContext?.hoveredHandleSide
    );
    const fallbackMeasure = calculateDistanceAndAngle(p2, p1);
    const dist = handleMeasure?.distance ?? fallbackMeasure.distance;
    const angle = handleMeasure?.angle ?? fallbackMeasure.angle;
    const tension = handleMeasure?.tension ?? null;
    const tensionText = tension == null ? "n/a" : tension.toFixed(2);
    drawMeasureGuideLine(context, p2, p1, segmentColor, parameters);
    // label/Q, type=handle: which handle and where, then its length, tension and angle.
    drawPlaque(
      context,
      parameters,
      p1,
      {
        header: {
          left: String(measureHoverHandle.pointNumber ?? ""),
          right: [Math.round(p1.x), Math.round(p1.y)],
        },
        rows: [
          { icon: "distance", value: dist.toFixed(1) },
          { icon: "tension", value: tensionText },
          { icon: "angle", value: `${angle.toFixed(1)}°`, tracking: true },
        ],
      },
      { onIconLoad: () => controller?.requestUpdate?.() }
    );
    return;
  }

  if (measureHoverSkeletonRib) {
    const { p1, p2, width, sideWidths, tangentialShift } = measureHoverSkeletonRib;
    const segmentColor = parameters.skeletonColor;
    drawMeasureGuideLine(context, p1, p2, segmentColor, parameters);
    // label/Q, type=rib: the stroke's width with its left/right distribution under it,
    // then how far the rib end slides along the stroke.
    drawPlaque(
      context,
      parameters,
      p2,
      ribPlaque({ width, sideWidths, tangentialShift }),
      { onIconLoad: () => controller?.requestUpdate?.() }
    );
    return;
  }

  if (measureHoverSegment || measureHoverPoints) {
    const { p1, p2, type } = measureHoverSegment || measureHoverPoints;
    const segmentColor =
      type === "skeleton" ? parameters.skeletonColor : parameters.pathColor;
    if (measureShowDirect) {
      const { distance: dist, angle } = calculateDistanceAndAngle(p1, p2);
      drawMeasureLine(
        context,
        p1,
        p2,
        [dist.toFixed(1), `${angle.toFixed(1)}°`],
        segmentColor,
        parameters
      );
    } else {
      const { dx, dy } = calculateProjectedDistanceComponents(p1, p2);
      const cornerPoint = { x: p2.x, y: p1.y };
      if (dx > 0.5) {
        drawMeasureLine(
          context,
          p1,
          cornerPoint,
          dx.toFixed(1),
          segmentColor,
          parameters
        );
      }
      if (dy > 0.5) {
        drawMeasureLine(
          context,
          cornerPoint,
          p2,
          dy.toFixed(1),
          segmentColor,
          parameters
        );
      }
    }
  }
}

function drawMeasureLine(context, p1, p2, label, color, parameters) {
  context.strokeStyle = color;
  context.lineWidth = parameters.strokeWidth;
  context.setLineDash(parameters.dashPattern);
  strokeLine(context, p1.x, p1.y, p2.x, p2.y);
  context.setLineDash([]);

  // The number sits on label/simple, the pill every marker reads on, at the middle of
  // its line. `label` is one value or several (distance and angle under Alt).
  drawLabel(context, parameters, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, label);
}

function drawMeasureGuideLine(context, p1, p2, color, parameters) {
  context.strokeStyle = color;
  context.lineWidth = parameters.strokeWidth;
  context.setLineDash(parameters.dashPattern);
  strokeLine(context, p1.x, p1.y, p2.x, p2.y);
  context.setLineDash([]);
}

// What a Tunni gizmo moves on each of its handles, its length and its tension, as
// the plain lines drawHandleLabel stacks by the handle.
export function handleGizmoLines({ distance, tension }) {
  return [distance.toFixed(1), tension == null ? "n/a" : tension.toFixed(2)];
}

// label/Q, type=rib, in its three states. Default, on hover: the stroke's width with
// its left/right distribution under it, then how far the rib end slides along the
// stroke. "adjusting width", while a drag changes the width: the width alone.
// "shifting", while a drag slides the rib end: the shift alone. The hover plaque and
// the drag plaques are built here and nowhere else, so they cannot read differently.
export function ribPlaque({ width, sideWidths, tangentialShift }, state = "default") {
  const widthRow = {
    icon: "width",
    value: width.toFixed(1),
    sub: [sideWidths.left.toFixed(1), sideWidths.right.toFixed(1)],
  };
  const shiftRow = {
    icon: "tangentialShift",
    value: (tangentialShift ?? 0).toFixed(2),
  };
  const rows =
    state === "adjusting width"
      ? [widthRow]
      : state === "shifting"
        ? [shiftRow]
        : [widthRow, shiftRow];
  return { rows };
}

// Transient readout drawn while a rib or Tunni control is being adjusted. The
// scene model decides whether anything applies (including suppressing the Tunni
// readout when the native point labels are on); this is render-only.
export function drawDragReadout(
  context,
  positionedGlyph,
  parameters,
  model,
  controller
) {
  for (const readout of model.getDragReadouts?.(positionedGlyph) || []) {
    const color =
      readout.kind === "skeleton" ? parameters.skeletonColor : parameters.pathColor;
    if (readout.handleLines) {
      drawHandleLabel(context, readout, readout.onCurve, readout.handleLines, color);
      continue;
    }
    // A readout that carries a plaque draws label/Q; the rest keep the plain box.
    if (readout.plaque) {
      drawPlaque(context, parameters, readout, readout.plaque, {
        onIconLoad: () => controller?.requestUpdate?.(),
      });
      continue;
    }
    drawMeasureLabel(context, readout.x, readout.y, readout.label, color, parameters, {
      offsetY: 8,
      alignBottom: true,
    });
  }
}

function drawMeasureLabel(context, x, y, label, color, parameters, options = {}) {
  const offsetY = options.offsetY ?? 15;
  const alignBottom = options.alignBottom ?? false;

  context.save();
  context.scale(1, -1);
  setLabelFont(context, parameters.fontSize);
  context.textAlign = "center";
  context.textBaseline = "middle";

  const lines = String(label).split("\n");
  const lineHeight = parameters.fontSize + 2;
  const totalHeight = lines.length * lineHeight;
  let textWidth = 0;
  for (const line of lines) {
    textWidth = Math.max(textWidth, context.measureText(line).width);
  }

  const padding = 4;
  const labelY = alignBottom ? -y - offsetY - totalHeight / 2 : -y - offsetY;
  const bgX = x - textWidth / 2 - padding;
  const bgY = labelY - totalHeight / 2 - padding;
  const bgW = textWidth + padding * 2;
  const bgH = totalHeight + padding * 2;

  context.beginPath();
  context.roundRect(bgX, bgY, bgW, bgH, 3);
  context.fillStyle = parameters.textBgColor;
  context.fill();
  context.strokeStyle = parameters.textBorderColor;
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = parameters.textColor;
  for (let i = 0; i < lines.length; i++) {
    const lineY = labelY + (i - (lines.length - 1) / 2) * lineHeight;
    context.fillText(lines[i], x, lineY);
  }
  context.restore();
}
