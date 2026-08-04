import { Bezier } from "bezier-js";
import { buildHandleDomain } from "./natural-handle-solver.js";
import { offsetCubicSide } from "./offset-cubic.js";
import { buildSerifTerminal, computeSerifFrame } from "./serif-geometry.js";
import {
  CAP_POINT_FIELDS,
  CORNER_POINT_FIELDS,
  DEFAULT_SKELETON_WIDTH,
  collectSerifTerminals,
  collectTiedRibGroups,
  getEffectiveNormal,
  isStraightControlledSmoothPoint,
  meanHalfWidth,
  normalizeSkeletonData,
  straightSegmentNormal,
} from "./skeleton-model.js";
import { packContour } from "./var-path.js";
import * as vector from "./vector.js";

const DEFAULT_WIDTH = DEFAULT_SKELETON_WIDTH;
const DEFAULT_CAP_RADIUS_RATIO = 1 / 8;
const MAX_CAP_RADIUS_RATIO = 1 / 4;
const DEFAULT_CAP_TENSION = 0.55;
const DEFAULT_CAP_ANGLE = 0;
const MAX_CAP_ANGLE = 85;
const DEFAULT_CAP_BALL_RATIO = 1.25;
const MIN_CAP_BALL_RATIO = 0.5;
const MAX_CAP_BALL_RATIO = 3;
const DEFAULT_CAP_BALL_SIDE = "auto";
// Ball shape: 0 = round ball, 1 = fully teardrop. Shape stretches the ball's
// along-stroke radius BACKWARD by up to this multiple of the lateral radius —
// never forward, since the ball's forward extreme is pinned to the terminal.
// The swell therefore merges into the outer edge over a longer, tapering run
// instead of just growing.
const DEFAULT_CAP_BALL_SHAPE = 0;
const MAX_CAP_BALL_SHAPE = 1;
const BALL_SHAPE_ELONGATION = 1.4;
// Drop-cap neck tension may run well past 1 for an extra-soft waist (the panel
// exposes up to 300%); other cap styles keep their own [0, 1] range.
const MAX_CAP_TENSION_DROP = 3;
// Drop-cap neck: capTension pulls the inner trim back by up to this fraction of
// the ball radius (softening the notch into a concave curve); the neck cubic's
// handles are this fraction of the neck chord.
const NECK_PULLBACK_FACTOR = 0.6;
const NECK_HANDLE_FRACTION = 0.45;
// How far (radians of ball sweep) the neck may back the ball attachment off.
const MAX_NECK_ARC_BACKOFF = 0.6;
// Cubic pieces the ball arc is always emitted in, whatever the sweep.
const DROP_CAP_ARC_PIECES = 4;
const DEFAULT_CORNER_ROUNDNESS = 0;
const DEFAULT_CORNER_ASYMMETRY = 0;
const MIN_CORNER_TRIM = 0.5;
const MAX_CORNER_TRIM_RATIO = 0.5;
const MAX_HANDLE_TRIM_RATIO = 0.99;
const DEFAULT_CORNER_RADIUS_BOOST = 1;
const MIN_CORNER_RADIUS_BOOST = 0.1;
const MAX_CORNER_RADIUS_BOOST = 4;

export function generateFromSkeleton(skeletonData, options = {}) {
  const normalized = normalizeSkeletonData(skeletonData);
  const generatorInput = canonicalToGeneratorInput(normalized);
  const generated = generateContoursFromGeneratorInput(generatorInput, options);
  return {
    contours: generated.contours,
    provenance: generated.provenance,
  };
}

export function generateContoursFromSkeleton(skeletonData) {
  return generateFromSkeleton(skeletonData).contours;
}

function generateContoursFromGeneratorInput(generatorInput, options = {}) {
  if (!generatorInput?.contours?.length) {
    return { contours: [], provenance: [] };
  }
  const contours = [];
  const provenance = [];
  for (
    let contourIndex = 0;
    contourIndex < generatorInput.contours.length;
    contourIndex++
  ) {
    const skeletonContour = generatorInput.contours[contourIndex];
    if (skeletonContour.points.length < 2) {
      continue;
    }
    const generatedContours = generateOutlineFromSkeletonContour(skeletonContour, {
      contourIndex,
      skeletonContourId: skeletonContour.id,
      serifUnitsMode: options.serifUnitsMode ?? "absolute",
      removeCollapsedPoints: options.removeCollapsedPoints === true,
    });
    for (const generatedContour of generatedContours) {
      const generatedContourIndex = contours.length;
      annotateGeneratedContourProvenance(generatedContour, skeletonContour);
      publishConstructionAxes(generatedContour);
      contours.push(generatedContour);
      provenance.push({
        skeletonContourId: skeletonContour.id,
        generatedContourIndex,
        pointMap: generatedContour.points.map((point) => point._provenance || null),
      });
      stripPointProvenance(generatedContour);
    }
  }
  return { contours, provenance };
}

function stripPointProvenance(contour) {
  for (const point of contour.points) {
    delete point._provenance;
    delete point._axis;
    delete point._constructionAnchor;
    delete point._handleNudge;
    delete point._authoredAdjustment;
  }
}

// Every generated handle is stamped at emission with the unit direction it was
// constructed on. Colinearity may then rotate it, keeping its length but not its
// direction, so the drawn handle no longer says which axis its length was
// measured along. Publish that axis rather than leave readers to estimate it
// back out of the rounded position (R-D).
function publishConstructionAxes(contour) {
  for (const point of contour.points) {
    if (!point._axis || !point._provenance) {
      continue;
    }
    point._provenance = {
      ...point._provenance,
      constructionAxis: { x: point._axis.x, y: point._axis.y },
    };
  }
}

function annotateGeneratedContourProvenance(contour, skeletonContour) {
  const sourcePoints = skeletonContour.points.filter((point) => !point.type);
  if (!sourcePoints.length) {
    return;
  }
  const lastSourceIndex = sourcePoints.length - 1;
  let cubicRole = "out";
  for (let i = 0; i < contour.points.length; i++) {
    const point = contour.points[i];
    if (point._provenance) {
      continue;
    }
    const sourceIndex =
      contour.points.length <= 1
        ? 0
        : Math.round((i / (contour.points.length - 1)) * lastSourceIndex);
    const sourcePoint = sourcePoints[Math.min(sourceIndex, lastSourceIndex)];
    if (point.type === "cubic" || point.type === "quad") {
      point._provenance = generatedHandle(
        point,
        sourcePoint,
        null,
        cubicRole
      )._provenance;
      cubicRole = cubicRole === "out" ? "in" : "out";
    } else {
      point._provenance = generatedOnCurve(point, sourcePoint, null)._provenance;
    }
  }
}

function withProvenance(point, sourcePoint, side, role, nudge = null) {
  if (!sourcePoint?._sourcePointId) {
    return point;
  }
  const provenance = {
    skeletonPointId: sourcePoint._sourcePointId,
    side,
    role,
  };
  if (
    role === "onCurve" &&
    nudge &&
    (Math.abs(nudge.x) > 1e-9 || Math.abs(nudge.y) > 1e-9)
  ) {
    provenance.nudge = { x: nudge.x, y: nudge.y };
  }
  return {
    ...point,
    _provenance: provenance,
  };
}

function generatedOnCurve(basePoint, sourcePoint, side, nudge = null) {
  return withProvenance(basePoint, sourcePoint, side, "onCurve", nudge);
}

function generatedHandle(basePoint, sourcePoint, side, role) {
  return withProvenance(basePoint, sourcePoint, side, role);
}

function canonicalToGeneratorInput(skeletonData) {
  return {
    contours: skeletonData.contours.map((contour) => ({
      id: contour.id,
      isClosed: contour.closed,
      defaultWidth: contour.defaultWidth ?? DEFAULT_SKELETON_WIDTH,
      singleSided: contour.singleSided !== null,
      singleSidedDirection: contour.singleSided || "left",
      capStyle: contour.capStyle || "butt",
      capBallRatio: contour.capBallRatio,
      capBallShape: contour.capBallShape,
      capBallSide: contour.capBallSide,
      serif: contour.serif ?? null,
      reversed: contour.reversed === true,
      cornerTrimRatio: contour.cornerTrimRatio,
      cornerRadiusBoost: contour.cornerRadiusBoost,
      points: contour.points.map(canonicalPointToGeneratorPoint),
    })),
  };
}

function canonicalPointToGeneratorPoint(point) {
  const generatorPoint = {
    id: point.id,
    x: point.x,
    y: point.y,
    smooth: point.smooth === true,
    _sourcePointId: point.id,
  };
  if (point.type) {
    generatorPoint.type = point.type;
    return generatorPoint;
  }
  generatorPoint.leftWidth = point.width?.left ?? DEFAULT_SKELETON_WIDTH / 2;
  generatorPoint.rightWidth = point.width?.right ?? DEFAULT_SKELETON_WIDTH / 2;
  generatorPoint.widthTied = point.width?.tied !== false;
  generatorPoint.leftNudge = point.nudge?.left ?? 0;
  generatorPoint.rightNudge = point.nudge?.right ?? 0;
  generatorPoint.leftHandleNudge = point.handleNudge?.left ?? 0;
  generatorPoint.rightHandleNudge = point.handleNudge?.right ?? 0;
  // The rib angle lock has to be copied across explicitly like every other
  // per-point field: the generator never sees the canonical shape (§7).
  generatorPoint.ribAngleLock = point.ribAngleLock ?? null;
  // Serif parameters travel as one object. Like ribAngleLock, they have to be
  // copied across explicitly: the generator never sees the canonical shape, and
  // a field that is not copied here fails silently rather than throwing.
  generatorPoint.serif = point.serif ?? null;
  generatorPoint.leftLocked = point.locked?.left === true;
  generatorPoint.rightLocked = point.locked?.right === true;
  // The pinned segment tension for the segment STARTING here, per side. Null
  // where the segment is unpinned, which is not the same as zero.
  generatorPoint.leftSegmentCurvature = point.segmentCurvature?.left ?? null;
  generatorPoint.rightSegmentCurvature = point.segmentCurvature?.right ?? null;
  for (const field of [
    "capStyle",
    "capBallSide",
    ...CAP_POINT_FIELDS,
    ...CORNER_POINT_FIELDS,
  ]) {
    if (point[field] !== null && point[field] !== undefined) {
      generatorPoint[field] = point[field];
    }
  }
  copyHandleOffsetsToGenerator(
    generatorPoint,
    "left",
    point.handleOffsets?.leftIn,
    "In"
  );
  copyHandleOffsetsToGenerator(
    generatorPoint,
    "left",
    point.handleOffsets?.leftOut,
    "Out"
  );
  copyHandleOffsetsToGenerator(
    generatorPoint,
    "right",
    point.handleOffsets?.rightIn,
    "In"
  );
  copyHandleOffsetsToGenerator(
    generatorPoint,
    "right",
    point.handleOffsets?.rightOut,
    "Out"
  );
  return generatorPoint;
}

function copyHandleOffsetsToGenerator(generatorPoint, side, offset, inOut) {
  if (!offset) {
    return;
  }
  const prefix = `${side}Handle${inOut}`;
  generatorPoint[`${prefix}OffsetX`] = offset.x ?? 0;
  generatorPoint[`${prefix}OffsetY`] = offset.y ?? 0;
  generatorPoint[`${prefix}Detached`] = offset.detached === true;
}

function clampCornerTrimRatio(value) {
  if (!Number.isFinite(value)) {
    return MAX_CORNER_TRIM_RATIO;
  }
  return Math.min(Math.max(value, 0.05), 0.99);
}

function clampCornerRadiusBoost(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CORNER_RADIUS_BOOST;
  }
  return Math.min(Math.max(value, MIN_CORNER_RADIUS_BOOST), MAX_CORNER_RADIUS_BOOST);
}

/**
 * Get the width for a point, with support for asymmetric left/right widths.
 * @param {Object} point - The skeleton point
 * @param {number} defaultWidth - Fallback width if point has no width
 * @param {string|null} side - "left", "right", or null for symmetric width
 * @returns {number} The width for this point (full width, not half)
 */
export function getPointWidth(point, defaultWidth, side = null) {
  if (side === "left" && point.leftWidth !== undefined) {
    return point.leftWidth * 2; // leftWidth stores half-width, return full width
  }
  if (side === "right" && point.rightWidth !== undefined) {
    return point.rightWidth * 2; // rightWidth stores half-width, return full width
  }
  if (point.width !== undefined) {
    return point.width;
  }
  return defaultWidth;
}

/**
 * Get the half-width for a specific side of a point.
 * @param {Object} point - The skeleton point
 * @param {number} defaultWidth - Fallback width if point has no width
 * @param {string} side - "left" or "right"
 * @returns {number} The half-width for this side
 */
export function getPointHalfWidth(point, defaultWidth, side) {
  if (side === "left" && point.leftWidth !== undefined) {
    return point.leftWidth;
  }
  if (side === "right" && point.rightWidth !== undefined) {
    return point.rightWidth;
  }
  if (point.width !== undefined) {
    return point.width / 2;
  }
  return defaultWidth / 2;
}

function clampCornerRoundness(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CORNER_ROUNDNESS;
  }
  return Math.min(Math.max(value, 0), 1);
}

function getCornerRoundness(point) {
  return clampCornerRoundness(point?.cornerRoundness ?? DEFAULT_CORNER_ROUNDNESS);
}

function clampCornerAsymmetry(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CORNER_ASYMMETRY;
  }
  return Math.min(Math.max(value, -1), 1);
}

function getCornerAsymmetry(point) {
  return clampCornerAsymmetry(point?.cornerAsymmetry ?? DEFAULT_CORNER_ASYMMETRY);
}

// Forward provenance for a generated point: which skeleton point/side/role it
// was emitted for. Attached at emission, carried through the post-processing
// stages (which spread or mutate points in place), collected into the
// generated[].pointMap and stripped from the output points. Points that get
// replaced by later stages (corner rounding, caps) simply lose provenance and
// fall back to the side-less annotator — they are not editable targets.
function pointProvenance(sourcePoint, side, role, nudge = null) {
  if (!sourcePoint?._sourcePointId || (side !== "left" && side !== "right")) {
    return undefined;
  }
  const provenance = { skeletonPointId: sourcePoint._sourcePointId, side, role };
  if (
    role === "onCurve" &&
    nudge &&
    (Math.abs(nudge.x) > 1e-9 || Math.abs(nudge.y) > 1e-9)
  ) {
    provenance.nudge = { x: nudge.x, y: nudge.y };
  }
  return provenance;
}

function buildGeneratedOnCurve(
  basePoint,
  smooth,
  skeletonPoint,
  halfWidth,
  cornerRoundBaseOverride = undefined,
  side = null,
  nudge = null,
  constructionAnchor = null
) {
  const generatedPoint = {
    x: basePoint.x,
    y: basePoint.y,
    smooth,
  };
  const provenance = pointProvenance(skeletonPoint, side, "onCurve", nudge);
  if (provenance) {
    generatedPoint._provenance = provenance;
  }
  if (provenance?.nudge && constructionAnchor) {
    generatedPoint._constructionAnchor = {
      x: constructionAnchor.x,
      y: constructionAnchor.y,
    };
  }
  const cornerRoundness = getCornerRoundness(skeletonPoint);
  const cornerAsymmetry = getCornerAsymmetry(skeletonPoint);
  const cornerReach = skeletonPoint?.cornerReach;
  const roundnessStrength = skeletonPoint?.roundnessStrength;
  const cornerRoundBase = Math.max(0, cornerRoundBaseOverride ?? halfWidth ?? 0);
  if (cornerRoundness > 0 && cornerRoundBase >= 0.5) {
    generatedPoint.cornerRoundness = cornerRoundness;
    generatedPoint.cornerRoundBase = cornerRoundBase;
  }
  if (cornerAsymmetry !== 0) {
    generatedPoint.cornerAsymmetry = cornerAsymmetry;
  }
  if (Number.isFinite(cornerReach)) {
    generatedPoint.cornerReach = cornerReach;
  }
  if (Number.isFinite(roundnessStrength)) {
    generatedPoint.roundnessStrength = roundnessStrength;
  }
  return generatedPoint;
}

function stripCornerRoundMetadata(points) {
  return points.map((point) => {
    if (!point || point.type) {
      return point;
    }
    if (
      point.cornerRoundness === undefined &&
      point.cornerRoundBase === undefined &&
      point.cornerAsymmetry === undefined &&
      point.cornerReach === undefined &&
      point.roundnessStrength === undefined
    ) {
      return point;
    }
    const {
      cornerRoundness: _cornerRoundness,
      cornerRoundBase: _cornerRoundBase,
      cornerAsymmetry: _cornerAsymmetry,
      cornerReach: _cornerReach,
      roundnessStrength: _roundnessStrength,
      ...rest
    } = point;
    return rest;
  });
}

function removeCollapsedOutlinePoints(points, tolerance = 0.5) {
  const kept = [];
  for (const point of points) {
    if (point.type) {
      kept.push(point);
      continue;
    }
    const previous = [...kept].reverse().find((candidate) => !candidate.type);
    if (
      previous &&
      Math.abs(previous.x - point.x) <= tolerance &&
      Math.abs(previous.y - point.y) <= tolerance
    ) {
      while (kept.length && kept[kept.length - 1].type) kept.pop();
      continue;
    }
    kept.push(point);
  }
  return kept;
}

/**
 * The displacement a nudge applies at a rib point: along the tangent
 * (perpendicular to the normal), or zero when the nudge does not apply.
 *
 * This is an on-curve emission translation, never an input to construction.
 * Ordinary Z-mode carry is tracked independently by
 * ribHandleNudgeDisplacement; default and Alt drags change only this value.
 * @param {Object} skeletonPoint - The skeleton point (may have nudge values)
 * @param {Object} normal - The normal vector at this point
 * @param {string} side - "left" or "right"
 * @param {number} halfWidth - The half-width for this side (no nudge if near 0)
 * @returns {Object} Displacement {x, y}
 */
function ribNudgeDisplacement(skeletonPoint, normal, side, halfWidth) {
  const none = { x: 0, y: 0 };
  // Don't apply nudge if width is near 0 (single-sided mode - this side matches skeleton)
  if (halfWidth !== undefined && halfWidth < 0.5) {
    return none;
  }

  // A locked side keeps its stored nudge but does not apply it.
  const lockedKey = side === "left" ? "leftLocked" : "rightLocked";
  if (skeletonPoint?.[lockedKey]) {
    return none;
  }

  const nudgeKey = side === "left" ? "leftNudge" : "rightNudge";
  const nudge = skeletonPoint[nudgeKey];

  if (nudge === undefined || nudge === 0) {
    return none;
  }

  // Tangent is perpendicular to normal (rotate 90 CCW)
  const tangent = { x: -normal.y, y: normal.x };
  return { x: tangent.x * nudge, y: tangent.y * nudge };
}

// The portion of an on-curve nudge accumulated by ordinary Z-mode drags.
// Default gizmo and Alt drags leave this scalar unchanged, so their on-curves
// move independently while any earlier carried handle position is preserved.
function ribHandleNudgeDisplacement(skeletonPoint, normal, side, halfWidth) {
  const none = { x: 0, y: 0 };
  if (halfWidth !== undefined && halfWidth < 0.5) {
    return none;
  }
  const lockedKey = side === "left" ? "leftLocked" : "rightLocked";
  if (skeletonPoint?.[lockedKey]) {
    return none;
  }
  const nudgeKey = side === "left" ? "leftHandleNudge" : "rightHandleNudge";
  const nudge = skeletonPoint[nudgeKey];
  if (!nudge) {
    return none;
  }
  const tangent = { x: -normal.y, y: normal.x };
  return { x: tangent.x * nudge, y: tangent.y * nudge };
}

function translateRibPoint(point, displacement) {
  if (!displacement.x && !displacement.y) {
    return point;
  }
  return {
    ...point,
    x: Math.round(point.x + displacement.x),
    y: Math.round(point.y + displacement.y),
  };
}

/**
 * Apply nudge offset to a rib point position.
 * @param {Object} ribPoint - The rib point {x, y} to modify
 * @param {Object} skeletonPoint - The skeleton point (may have nudge values)
 * @param {Object} normal - The normal vector at this point
 * @param {string} side - "left" or "right"
 * @param {number} halfWidth - The half-width for this side (don't apply nudge if near 0)
 * @returns {Object} Modified rib point {x, y}
 */
/**
 * Get the skeleton handle direction for a given segment endpoint.
 * @param {Object} segment - The segment containing the on-curve point
 * @param {string} position - "start" or "end" (which end of segment)
 * @param {string} handleType - "in" or "out" (which direction from on-curve)
 * @returns {Object|null} Normalized direction vector {x, y} or null if no handle
 */
function getSkeletonHandleDirection(segment, position, handleType) {
  if (segment.controlPoints.length === 0) {
    // Line segment - no handles
    return null;
  }

  let onCurvePoint, controlPoint;

  if (position === "start" && handleType === "out") {
    // Outgoing handle from start = first control point
    onCurvePoint = segment.startPoint;
    controlPoint = segment.controlPoints[0];
  } else if (position === "end" && handleType === "in") {
    // Incoming handle to end = last control point
    onCurvePoint = segment.endPoint;
    controlPoint = segment.controlPoints[segment.controlPoints.length - 1];
  } else {
    // Other combinations not handled here (would need previous/next segment)
    return null;
  }

  if (!controlPoint) return null;

  const dir = {
    x: controlPoint.x - onCurvePoint.x,
    y: controlPoint.y - onCurvePoint.y,
  };
  const length = Math.hypot(dir.x, dir.y);

  if (length < 0.001) return null;

  const normalized = { x: dir.x / length, y: dir.y / length };
  return normalized;
}

// Resolve a stored generated-handle adjustment into one glyph-space vector.
// Attached adjustments are consumed inside offsetCubicSide before the pin;
// detached adjustments remain absolute relative to the construction rib point.
function getGeneratedHandleAdjustment(
  skeletonPoint,
  skeletonHandleDir,
  side,
  handleType
) {
  // A locked side keeps its stored handle offsets but does not apply them.
  const lockedKey = side === "left" ? "leftLocked" : "rightLocked";
  if (skeletonPoint?.[lockedKey]) {
    return null;
  }

  const keyPrefix = `${side}Handle${handleType === "in" ? "In" : "Out"}`;

  // Check if this handle is detached (absolute positioning relative to the
  // rib point). The flag is per handle (per side+role), matching the
  // canonical handleOffsets model — NOT the donor's per-side key.
  const isDetached = skeletonPoint[`${keyPrefix}Detached`] === true;

  // 2D offset keys (new format for precise interpolation)
  const offsetKeyX = `${keyPrefix}OffsetX`;
  const offsetKeyY = `${keyPrefix}OffsetY`;

  // Legacy 1D offset key (backwards compatibility)
  const offset1DKey =
    side === "left"
      ? handleType === "in"
        ? "leftHandleInOffset"
        : "leftHandleOutOffset"
      : handleType === "in"
        ? "rightHandleInOffset"
        : "rightHandleOutOffset";

  const offset2DX = skeletonPoint[offsetKeyX];
  const offset2DY = skeletonPoint[offsetKeyY];
  const offset1D = skeletonPoint[offset1DKey];

  if (offset2DX !== undefined || offset2DY !== undefined) {
    return {
      x: offset2DX || 0,
      y: offset2DY || 0,
      detached: isDetached,
    };
  }

  if (offset1D !== undefined && offset1D !== 0) {
    return {
      x: skeletonHandleDir.x * offset1D,
      y: skeletonHandleDir.y * offset1D,
      detached: false,
    };
  }

  return null;
}

function collectSerifAuthoredHandles(segments, isClosed, startCapStyle, endCapStyle) {
  const keys = new Set();
  if (isClosed || !segments.length) return keys;
  const claim = (segment) => {
    for (const side of ["left", "right"]) {
      if (segment.startPoint?.id !== undefined)
        keys.add(`${segment.startPoint.id}/${side}/out`);
      if (segment.endPoint?.id !== undefined)
        keys.add(`${segment.endPoint.id}/${side}/in`);
    }
  };
  if (startCapStyle === "serif") claim(segments[0]);
  if (endCapStyle === "serif") claim(segments[segments.length - 1]);
  return keys;
}

function applySerifAuthoredHandles(sidePoints, side, authoredKeys) {
  if (!authoredKeys?.size) return sidePoints;
  const points = [...sidePoints];
  const isOffCurve = (point) => !!point?.type;
  const nearestOnCurve = (from, step) => {
    for (let index = from; index >= 0 && index < points.length; index += step) {
      if (!isOffCurve(points[index])) return index;
    }
    return -1;
  };
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const provenance = point?._provenance;
    if (
      !isOffCurve(point) ||
      provenance?.side !== side ||
      !authoredKeys.has(`${provenance.skeletonPointId}/${side}/${provenance.role}`) ||
      !point._axis
    )
      continue;
    const anchorIndex =
      index > 0 && !isOffCurve(points[index - 1])
        ? index - 1
        : index + 1 < points.length && !isOffCurve(points[index + 1])
          ? index + 1
          : -1;
    if (anchorIndex < 0) continue;
    const farIndex =
      anchorIndex < index
        ? nearestOnCurve(index + 1, 1)
        : nearestOnCurve(index - 1, -1);
    if (farIndex < 0) continue;
    const farHandleIndex = anchorIndex < index ? farIndex - 1 : farIndex + 1;
    const anchor = points[anchorIndex];
    const far = points[farIndex];
    const axis = point._axis;
    const farAxis = points[farHandleIndex]?._axis;
    if (!farAxis) continue;
    const domain = buildHandleDomain(anchor, far, axis, farAxis);
    const authoredProvenance = {
      ...provenance,
      authoredAxis: { x: axis.x, y: axis.y },
    };
    const adjustment = point._authoredAdjustment;
    if (!adjustment) {
      points[index] = { ...point, _provenance: authoredProvenance };
      continue;
    }
    const baseLength = adjustment.detached
      ? 0
      : (point.x - anchor.x) * axis.x + (point.y - anchor.y) * axis.y;
    const adjustmentLength = Math.hypot(adjustment.x || 0, adjustment.y || 0);
    const adjustmentSign =
      (adjustment.x || 0) * axis.x + (adjustment.y || 0) * axis.y < 0 ? -1 : 1;
    const requested = baseLength + adjustmentSign * adjustmentLength;
    const clamped =
      Math.min(
        Math.max(requested / domain.startReach, domain.minStartTension),
        domain.maxStartTension
      ) * domain.startReach;
    points[index] = {
      ...point,
      x: Math.round(anchor.x + axis.x * clamped),
      y: Math.round(anchor.y + axis.y * clamped),
      _provenance: authoredProvenance,
    };
  }
  return points;
}

const SKELETON_DEBUG_PREFIX = "[SKELETON GEN DEBUG]";

/**
 * The axis two generated handles were constructed on, when both descend from
 * the same skeleton point and so share that point's handle axis.
 *
 * Returns a unit vector pointing from the shared on-curve point towards the
 * incoming handle, or null when the handles don't carry a locked axis (caps,
 * line-segment ribs, corner-rounding output) or don't belong to the same
 * skeleton point. Callers fall back to their own direction estimate then.
 *
 * The two stored axes are nominally antiparallel — the skeleton point is
 * smooth, so its own handles are colinear. They are averaged with equal
 * weight rather than by length: the result must not depend on handle length,
 * because rib width changes handle length.
 * @param {Object} inHandle - The off-curve point before the on-curve point
 * @param {Object} outHandle - The off-curve point after it
 * @returns {Object|null} Unit direction {x, y} towards inHandle, or null
 */
function sharedLockedAxis(inHandle, outHandle) {
  const axisIn = inHandle?._axis;
  const axisOut = outHandle?._axis;
  if (!axisIn || !axisOut) return null;

  const ownerIn = inHandle._provenance?.skeletonPointId;
  const ownerOut = outHandle._provenance?.skeletonPointId;
  if (ownerIn === undefined || ownerIn !== ownerOut) return null;

  // Antiparallel by construction, so subtract to average.
  const axis = { x: axisIn.x - axisOut.x, y: axisIn.y - axisOut.y };
  if (Math.hypot(axis.x, axis.y) < 0.001) {
    // The two axes point the same way: the skeleton handles are not colinear
    // at a point flagged smooth. Leave this to the length-weighted fallback.
    return null;
  }
  return vector.normalizeVector(axis);
}

/**
 * Enforce colinearity for smooth points in a contour.
 * For each on-curve smooth point with two adjacent off-curve handles,
 * adjusts the handles to be colinear while preserving their lengths.
 * Also handles smooth points with linear segments (on-curve neighbors),
 * maintaining the pivot behavior where the smooth point acts as a pivot
 * for the linear segment's direction.
 * @param {Array} points - Array of contour points
 * @param {boolean} isClosed - Whether the contour is closed
 * @returns {Array} - Modified points array
 */
function enforceSmoothColinearity(points, isClosed, options = {}) {
  const {
    includeLinearNeighborCases = true,
    maxHandleRotationDeg = 60,
    minReliableHandleLength = 0.75,
  } = options;
  if (!points || points.length < 2) return points;

  const numPoints = points.length;
  const hasRotationLimit =
    Number.isFinite(maxHandleRotationDeg) && maxHandleRotationDeg < 179.999;
  const maxRotationCos = hasRotationLimit
    ? Math.cos((Math.max(0, maxHandleRotationDeg) * Math.PI) / 180)
    : -1;

  // Process all smooth points
  for (let i = 0; i < numPoints; i++) {
    const point = points[i];

    // Only process on-curve smooth points
    if (point.type || !point.smooth) continue;
    if (point.skipColinear) continue;
    // Smooth generated handles live around the construction rib point. The
    // rendered on-curve may have a nudge that is deliberately absent from the
    // handles, so recover the construction anchor before enforcing the axis.
    // A Z-normal handleNudge remains visible as changed lengths from this same
    // anchor; default and Alt drags leave the handles untouched.
    const smoothAnchor = point._constructionAnchor || point;

    // Find adjacent points (could be on-curve or off-curve)
    const prevIdx = (i - 1 + numPoints) % numPoints;
    const nextIdx = (i + 1) % numPoints;

    // For open contours, handle endpoints specially
    if (!isClosed && (i === 0 || i === numPoints - 1)) {
      continue; // Skip endpoint smooth points for now, as they don't have two neighbors
    }

    const prevPoint = points[prevIdx];
    const nextPoint = points[nextIdx];

    // Determine the type of each neighbor
    const prevIsOnCurve = !prevPoint?.type;
    const nextIsOnCurve = !nextPoint?.type;

    // Case 1: Both neighbors are off-curve (traditional smooth curve behavior)
    if (!prevIsOnCurve && !nextIsOnCurve) {
      // Traditional colinearity enforcement for smooth point between two off-curve handles
      const vecIn = {
        x: prevPoint.x - smoothAnchor.x,
        y: prevPoint.y - smoothAnchor.y,
      };
      const vecOut = {
        x: nextPoint.x - smoothAnchor.x,
        y: nextPoint.y - smoothAnchor.y,
      };

      const lenIn = Math.hypot(vecIn.x, vecIn.y);
      const lenOut = Math.hypot(vecOut.x, vecOut.y);

      // Both handles descend from the same skeleton point and were constructed
      // on that point's own handle axis, which is stored on each of them. Use
      // it directly.
      //
      // Deriving the axis from the rounded positions instead — and weighting by
      // handle length, as the fallback below does — makes the shared axis move
      // whenever rib width moves, because width changes the lengths. Measured
      // at 1.1 deg mean and 12.5 deg worst per single unit of width.
      //
      // Written unrounded, like the fallback below: re-snapping to the grid
      // here would undo the colinearity just established, and worst on short
      // handles, where a unit of rounding is a large angle.
      const lockedAxis = sharedLockedAxis(prevPoint, nextPoint);
      if (lockedAxis && lenIn >= 0.001 && lenOut >= 0.001) {
        points[prevIdx] = {
          ...prevPoint,
          x: smoothAnchor.x + lockedAxis.x * lenIn,
          y: smoothAnchor.y + lockedAxis.y * lenIn,
        };
        points[nextIdx] = {
          ...nextPoint,
          x: smoothAnchor.x - lockedAxis.x * lenOut,
          y: smoothAnchor.y - lockedAxis.y * lenOut,
        };
        continue;
      }

      // Skip if handles are too short
      if (lenIn >= 0.001 && lenOut >= 0.001) {
        // Normalize directions
        const dirIn = { x: vecIn.x / lenIn, y: vecIn.y / lenIn };
        const dirOut = { x: vecOut.x / lenOut, y: vecOut.y / lenOut };

        // Near-zero handles are numerically unstable: don't let them rotate long handles.
        const inIsTiny = lenIn < minReliableHandleLength;
        const outIsTiny = lenOut < minReliableHandleLength;
        if (inIsTiny || outIsTiny) {
          // Near-zero handles are too noisy for direction enforcement.
          // Leave them untouched to avoid accidental flips.
          continue;
        }

        // Use length-weighted direction so long handles dominate and short handles
        // don't cause direction flips when they approach zero length.
        const avgDir = vector.normalizeVector({
          x: dirIn.x * lenIn - dirOut.x * lenOut,
          y: dirIn.y * lenIn - dirOut.y * lenOut,
        });

        // If directions are nearly opposite (already colinear), skip
        const dot = dirIn.x * dirOut.x + dirIn.y * dirOut.y;
        if (dot > -0.999) {
          // Not nearly opposite
          // If avgDir is zero (handles point same direction), use perpendicular
          if (Math.hypot(avgDir.x, avgDir.y) >= 0.001) {
            // Avoid large handle flips: only enforce when required rotation is bounded.
            const prevTargetAlignment = dirIn.x * avgDir.x + dirIn.y * avgDir.y;
            const nextTargetAlignment = -dirOut.x * avgDir.x - dirOut.y * avgDir.y;
            if (
              hasRotationLimit &&
              (prevTargetAlignment < maxRotationCos ||
                nextTargetAlignment < maxRotationCos)
            ) {
              continue;
            }

            // Adjust handle positions to be colinear through the on-curve point
            points[prevIdx] = {
              ...prevPoint,
              x: smoothAnchor.x + avgDir.x * lenIn,
              y: smoothAnchor.y + avgDir.y * lenIn,
            };

            points[nextIdx] = {
              ...nextPoint,
              x: smoothAnchor.x - avgDir.x * lenOut,
              y: smoothAnchor.y - avgDir.y * lenOut,
            };
          }
        }
      }
    }
    // Case 2: One neighbor is on-curve (linear segment) and one is off-curve (smooth-linear transition)
    else if (includeLinearNeighborCases && prevIsOnCurve && !nextIsOnCurve) {
      // Smooth point with linear segment before and curve after
      // The smooth point should act as a pivot: the off-curve handle should be collinear
      // with the linear segment, extending its direction
      const linearVec = {
        x: smoothAnchor.x - prevPoint.x,
        y: smoothAnchor.y - prevPoint.y,
      }; // Vector from prev linear point to smooth point
      const linearLen = Math.hypot(linearVec.x, linearVec.y);
      if (!(linearLen > 0.001)) {
        continue;
      }
      const linearDir = vector.normalizeVector(linearVec);

      const curveVec = {
        x: nextPoint.x - smoothAnchor.x,
        y: nextPoint.y - smoothAnchor.y,
      }; // Vector from smooth point to off-curve
      const curveLength = Math.hypot(curveVec.x, curveVec.y);

      if (curveLength >= 0.001) {
        // For smooth-linear transition, the off-curve should continue the linear direction
        // So the direction is the same as the linear segment direction
        const newDirectionX = linearDir.x;
        const newDirectionY = linearDir.y;

        // Calculate new position by extending the linear direction with the original handle length
        const newX = smoothAnchor.x + newDirectionX * curveLength;
        const newY = smoothAnchor.y + newDirectionY * curveLength;

        points[nextIdx] = {
          ...nextPoint,
          x: newX,
          y: newY,
        };
      }
    } else if (includeLinearNeighborCases && !prevIsOnCurve && nextIsOnCurve) {
      // Smooth point with curve before and linear segment after
      // The previous off-curve handle should be collinear with the next linear segment
      const linearVec = {
        x: nextPoint.x - smoothAnchor.x,
        y: nextPoint.y - smoothAnchor.y,
      }; // Vector from smooth point to next linear point
      const linearLen = Math.hypot(linearVec.x, linearVec.y);
      if (!(linearLen > 0.001)) {
        continue;
      }
      const linearDir = vector.normalizeVector(linearVec);

      const curveVec = {
        x: prevPoint.x - smoothAnchor.x,
        y: prevPoint.y - smoothAnchor.y,
      }; // Vector from smooth point to prev off-curve
      const curveLength = Math.hypot(curveVec.x, curveVec.y);

      if (curveLength >= 0.001) {
        // For linear-smooth transition, the off-curve should continue the linear direction backwards
        // So the direction is the opposite of the linear segment direction
        const newDirectionX = -linearDir.x;
        const newDirectionY = -linearDir.y;

        // Calculate new position by extending in the opposite linear direction with the original handle length
        const newX = smoothAnchor.x + newDirectionX * curveLength;
        const newY = smoothAnchor.y + newDirectionY * curveLength;

        points[prevIdx] = {
          ...prevPoint,
          x: newX,
          y: newY,
        };
      }
    }
    // Case 3: Both neighbors are on-curve (smooth point between two linear segments)
    else if (includeLinearNeighborCases && prevIsOnCurve && nextIsOnCurve) {
      // This case typically shouldn't happen in generated contours from skeleton,
      // but we handle it for completeness - smooth point between two linear segments
      // In this case, the smooth point should maintain angle bisector behavior
      const vecIn = { x: point.x - prevPoint.x, y: point.y - prevPoint.y };
      const vecOut = { x: nextPoint.x - point.x, y: nextPoint.y - point.y };

      // Normalize directions
      const dirIn = vector.normalizeVector(vecIn);
      const dirOut = vector.normalizeVector(vecOut);

      // Calculate angle bisector
      const bisector = vector.normalizeVector({
        x: dirIn.x + dirOut.x,
        y: dirIn.y + dirOut.y,
      });

      // The smooth point is already in the right position, just ensure it's marked as smooth
      points[i] = { ...point, smooth: true };
    }
  }

  // Ordinary Z-mode on-curve carry is an emission operation, like moving an
  // on-curve in a regular path. Apply it only after every construction-space
  // smoothing decision so the rendered handle receives exactly the same
  // rounded displacement as its rib point.
  for (const point of points) {
    if (!point?._handleNudge) continue;
    point.x += point._handleNudge.x;
    point.y += point._handleNudge.y;
  }

  return points;
}

/**
 * Aligns handle directions in generated contours to match the directions of skeleton handles.
 * @param {Array} points - Array of generated contour points
 * @param {Array} segments - Original skeleton segments
 * @param {boolean|null} isLeftSide - True for left side, false for right side, null for centerline (caps)
 * @returns {Array} - Points with aligned handle directions
 */

function getPrevIndex(points, index, isClosed) {
  if (!points.length) {
    return null;
  }
  if (index > 0) {
    return index - 1;
  }
  return isClosed ? points.length - 1 : null;
}

function getNextIndex(points, index, isClosed) {
  if (!points.length) {
    return null;
  }
  if (index < points.length - 1) {
    return index + 1;
  }
  return isClosed ? 0 : null;
}

function findPrevOnCurveIndex(points, index, isClosed) {
  let cursor = getPrevIndex(points, index, isClosed);
  if (cursor === null) {
    return null;
  }
  const visited = new Set();
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    if (!points[cursor]?.type) {
      return cursor;
    }
    cursor = getPrevIndex(points, cursor, isClosed);
  }
  return null;
}

function findNextOnCurveIndex(points, index, isClosed) {
  let cursor = getNextIndex(points, index, isClosed);
  if (cursor === null) {
    return null;
  }
  const visited = new Set();
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    if (!points[cursor]?.type) {
      return cursor;
    }
    cursor = getNextIndex(points, cursor, isClosed);
  }
  return null;
}

function roundSharpCornersOnSide(
  sidePoints,
  { isClosed, cornerTrimRatio, cornerRadiusBoost, side }
) {
  const points = sidePoints.map((point) => ({ ...point }));
  if (points.length < 3) {
    return points;
  }

  const cornerInfos = new Map();
  const onCurvePoints = [];

  for (let i = 0; i < points.length; i++) {
    const corner = points[i];
    if (!corner || corner.type) {
      continue;
    }
    onCurvePoints.push(corner);
    if (corner.smooth) {
      continue;
    }

    const baseRoundness = clampCornerRoundness(corner.cornerRoundness);
    const cornerAsymmetry = getCornerAsymmetry(corner);
    const effectiveCornerTrimRatio = clampCornerTrimRatio(
      Number.isFinite(corner.cornerReach) ? corner.cornerReach : cornerTrimRatio
    );
    const effectiveCornerRadiusBoost = clampCornerRadiusBoost(
      Number.isFinite(corner.roundnessStrength)
        ? corner.roundnessStrength
        : cornerRadiusBoost
    );
    let cornerRoundness = baseRoundness;
    if (cornerRoundness > 0 && side && cornerAsymmetry !== 0) {
      let scale = 1;
      if (side === "left" && cornerAsymmetry < 0) {
        scale = 1 + cornerAsymmetry;
      } else if (side === "right" && cornerAsymmetry > 0) {
        scale = 1 - cornerAsymmetry;
      }
      scale = Math.min(Math.max(scale, 0), 1);
      cornerRoundness = cornerRoundness * scale;
    }
    const cornerRoundBase = Math.max(0, corner.cornerRoundBase ?? 0);
    if (cornerRoundness <= 0 || cornerRoundBase < 0.5) {
      continue;
    }

    const prevOnIndex = findPrevOnCurveIndex(points, i, isClosed);
    const nextOnIndex = findNextOnCurveIndex(points, i, isClosed);
    if (prevOnIndex === null || nextOnIndex === null) {
      continue;
    }

    const prevNeighborIndex = getPrevIndex(points, i, isClosed);
    const nextNeighborIndex = getNextIndex(points, i, isClosed);
    const prevHandleIndex =
      prevNeighborIndex !== null && points[prevNeighborIndex]?.type
        ? prevNeighborIndex
        : null;
    const nextHandleIndex =
      nextNeighborIndex !== null && points[nextNeighborIndex]?.type
        ? nextNeighborIndex
        : null;

    const prevReference =
      prevHandleIndex !== null ? points[prevHandleIndex] : points[prevOnIndex];
    const nextReference =
      nextHandleIndex !== null ? points[nextHandleIndex] : points[nextOnIndex];
    if (!prevReference || !nextReference) {
      continue;
    }

    const dirInAway = vector.normalizeVector(vector.subVectors(prevReference, corner));
    const dirOutAway = vector.normalizeVector(vector.subVectors(nextReference, corner));
    if (
      !Number.isFinite(dirInAway.x) ||
      !Number.isFinite(dirInAway.y) ||
      !Number.isFinite(dirOutAway.x) ||
      !Number.isFinite(dirOutAway.y)
    ) {
      continue;
    }

    const betaCos = Math.min(Math.max(vector.dotVector(dirInAway, dirOutAway), -1), 1);
    const beta = Math.acos(betaCos);
    if (!(beta > 1e-4 && beta < Math.PI - 1e-4)) {
      continue;
    }
    const tanHalf = Math.tan(beta / 2);
    if (!(tanHalf > 1e-6)) {
      continue;
    }

    const distPrevOn = vector.distance(corner, points[prevOnIndex]);
    const distNextOn = vector.distance(corner, points[nextOnIndex]);
    const handleTrimRatio = MAX_HANDLE_TRIM_RATIO;
    const minTrim = 0;
    let maxTrimIn = distPrevOn * effectiveCornerTrimRatio;
    let maxTrimOut = distNextOn * effectiveCornerTrimRatio;

    if (prevHandleIndex !== null) {
      maxTrimIn = Math.min(
        maxTrimIn,
        vector.distance(corner, points[prevHandleIndex]) * handleTrimRatio
      );
    }
    if (nextHandleIndex !== null) {
      maxTrimOut = Math.min(
        maxTrimOut,
        vector.distance(corner, points[nextHandleIndex]) * handleTrimRatio
      );
    }

    const maxTrim = Math.min(maxTrimIn, maxTrimOut);
    if (!Number.isFinite(maxTrim) || maxTrim <= minTrim) {
      continue;
    }

    const roundnessRatio = Math.min(
      Math.max(cornerRoundness * effectiveCornerRadiusBoost, 0),
      1
    );
    if (!(roundnessRatio > 0)) {
      continue;
    }

    const trimIn = maxTrimIn * roundnessRatio;
    const trimOut = maxTrimOut * roundnessRatio;
    if (
      !Number.isFinite(trimIn) ||
      !Number.isFinite(trimOut) ||
      trimIn <= minTrim ||
      trimOut <= minTrim
    ) {
      continue;
    }

    const maxRadius = maxTrim * tanHalf;
    const radiusIn = trimIn * tanHalf;
    const radiusOut = trimOut * tanHalf;
    const kappa = (4 / 3) * Math.tan(beta / 4);
    const arcHandleLenIn =
      Number.isFinite(radiusIn) && Number.isFinite(kappa)
        ? Math.max(0, radiusIn * kappa)
        : 0;
    const arcHandleLenOut =
      Number.isFinite(radiusOut) && Number.isFinite(kappa)
        ? Math.max(0, radiusOut * kappa)
        : 0;
    const arcHandleLen = Math.max(arcHandleLenIn, arcHandleLenOut);

    cornerInfos.set(corner, {
      trimIn,
      trimOut,
      dirInAway,
      dirOutAway,
      arcHandleLen,
      prevHandlePoint: prevHandleIndex !== null ? points[prevHandleIndex] : null,
      nextHandlePoint: nextHandleIndex !== null ? points[nextHandleIndex] : null,
    });
  }

  if (cornerInfos.size > 1 && onCurvePoints.length > 1) {
    const limitSegmentTrims = (pointA, pointB) => {
      const infoA = cornerInfos.get(pointA);
      const infoB = cornerInfos.get(pointB);
      if (!infoA || !infoB) {
        return;
      }
      const minGap = 0;
      const dx = pointB.x - pointA.x;
      const dy = pointB.y - pointA.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 1e-6) {
        infoA.trim = 0;
        infoB.trim = 0;
        return;
      }

      const ux = dx / segLen;
      const uy = dy / segLen;
      const inter = vector.intersect(
        pointA,
        { x: pointA.x + infoA.dirOutAway.x, y: pointA.y + infoA.dirOutAway.y },
        pointB,
        { x: pointB.x + infoB.dirInAway.x, y: pointB.y + infoB.dirInAway.y }
      );
      if (
        inter &&
        Number.isFinite(inter.t1) &&
        Number.isFinite(inter.t2) &&
        inter.t1 >= 0 &&
        inter.t2 >= 0 &&
        inter.t1 <= infoA.trimOut + 1e-6 &&
        inter.t2 <= infoB.trimIn + 1e-6
      ) {
        infoA.trimOut = inter.t1;
        infoB.trimIn = inter.t2;
        return;
      }

      const kA = Math.max(0, infoA.dirOutAway.x * ux + infoA.dirOutAway.y * uy);
      const kB = Math.max(0, -infoB.dirInAway.x * ux - infoB.dirInAway.y * uy);
      if (!(kA > 0 || kB > 0)) {
        return;
      }

      const budget = Math.max(segLen - minGap, 0);
      const consA = kA * infoA.trimOut;
      const consB = kB * infoB.trimIn;
      const sum = consA + consB;
      if (sum <= budget) {
        return;
      }

      const scale = sum > 0 ? budget / sum : 0;
      infoA.trimOut *= scale;
      infoB.trimIn *= scale;
    };

    for (let i = 0; i < onCurvePoints.length - 1; i++) {
      limitSegmentTrims(onCurvePoints[i], onCurvePoints[i + 1]);
    }
    if (isClosed && onCurvePoints.length > 2) {
      limitSegmentTrims(onCurvePoints[onCurvePoints.length - 1], onCurvePoints[0]);
    }
  }

  let i = 0;
  while (i < points.length) {
    const corner = points[i];
    const cornerInfo = cornerInfos.get(corner);
    if (!cornerInfo) {
      i++;
      continue;
    }

    const trimIn = cornerInfo.trimIn;
    const trimOut = cornerInfo.trimOut;
    if (
      !Number.isFinite(trimIn) ||
      !Number.isFinite(trimOut) ||
      trimIn < 0 ||
      trimOut < 0
    ) {
      i++;
      continue;
    }

    const startPoint = {
      x: corner.x + cornerInfo.dirInAway.x * trimIn,
      y: corner.y + cornerInfo.dirInAway.y * trimIn,
      smooth: true,
    };
    const endPoint = {
      x: corner.x + cornerInfo.dirOutAway.x * trimOut,
      y: corner.y + cornerInfo.dirOutAway.y * trimOut,
      smooth: true,
    };

    const startTangent = {
      x: -cornerInfo.dirInAway.x,
      y: -cornerInfo.dirInAway.y,
    };
    const endTangent = {
      x: cornerInfo.dirOutAway.x,
      y: cornerInfo.dirOutAway.y,
    };
    let handleLengths = computeTunniHandleLengths(
      startPoint,
      startTangent,
      endPoint,
      { x: -endTangent.x, y: -endTangent.y },
      DEFAULT_CAP_TENSION
    );
    const chord = vector.distance(startPoint, endPoint);
    const fallbackLen = cornerInfo.arcHandleLen;
    if (
      (!(chord > 1e-3) ||
        !(handleLengths.startLen > 1e-3) ||
        !(handleLengths.endLen > 1e-3)) &&
      fallbackLen > 0
    ) {
      handleLengths = {
        startLen: fallbackLen,
        endLen: fallbackLen,
      };
    }

    const handleIn = {
      x: startPoint.x + startTangent.x * handleLengths.startLen,
      y: startPoint.y + startTangent.y * handleLengths.startLen,
      type: "cubic",
    };
    const handleOut = {
      x: endPoint.x - endTangent.x * handleLengths.endLen,
      y: endPoint.y - endTangent.y * handleLengths.endLen,
      type: "cubic",
    };

    const deltaIn = {
      x: startPoint.x - corner.x,
      y: startPoint.y - corner.y,
    };
    const deltaOut = {
      x: endPoint.x - corner.x,
      y: endPoint.y - corner.y,
    };

    if (cornerInfo.prevHandlePoint) {
      cornerInfo.prevHandlePoint.x += deltaIn.x;
      cornerInfo.prevHandlePoint.y += deltaIn.y;
    }
    if (cornerInfo.nextHandlePoint) {
      cornerInfo.nextHandlePoint.x += deltaOut.x;
      cornerInfo.nextHandlePoint.y += deltaOut.y;
    }

    points.splice(i, 1, startPoint, handleIn, handleOut, endPoint);
    i += 4;
  }

  return points;
}

/**
 * Generates closed outline contour(s) from a single skeleton contour.
 * @param {Object} skeletonContour - Single skeleton contour with points array
 * @returns {Array} Array of unpacked contours [{points: [...], isClosed: true}, ...]
 *   - For open skeleton: returns 1 contour (stroke with caps)
 *   - For closed skeleton: returns 2 contours (outer and inner)
 */
export function generateOutlineFromSkeletonContour(skeletonContour, options = {}) {
  const {
    points,
    isClosed,
    defaultWidth = DEFAULT_WIDTH,
    capStyle = "butt",
    reversed = false,
    singleSided = false,
    singleSidedDirection = "left",
    cornerTrimRatio = MAX_CORNER_TRIM_RATIO,
    cornerRadiusBoost = DEFAULT_CORNER_RADIUS_BOOST,
  } = skeletonContour;

  if (points.length < 2) {
    return [];
  }

  // Separate on-curve and off-curve points, build segments
  const segments = buildSegmentsFromPoints(points, isClosed);

  // If no valid segments (e.g., less than 2 on-curve points), return empty
  if (segments.length === 0) {
    return [];
  }

  // Generate left and right offset points
  const leftSide = [];
  const rightSide = [];

  const coupled = coupledHalfWidths(segments, isClosed, defaultWidth, capStyle);
  const firstOnCurvePoint = segments[0].startPoint;
  const lastOnCurvePoint = segments[segments.length - 1].endPoint;
  const startCapStyle = normalizeCapStyle(firstOnCurvePoint.capStyle ?? capStyle);
  const endCapStyle = normalizeCapStyle(lastOnCurvePoint.capStyle ?? capStyle);
  const authoredKeys = collectSerifAuthoredHandles(
    segments,
    isClosed,
    startCapStyle,
    endCapStyle
  );
  const resolveHalfWidth = (point, side) =>
    coupled.get(point)?.[side] ?? getPointHalfWidth(point, defaultWidth, side);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // For open skeletons, don't wrap around - first/last segments have no prev/next
    const prevSegment =
      isClosed || i > 0 ? segments[(i - 1 + segments.length) % segments.length] : null;
    const nextSegment =
      isClosed || i < segments.length - 1 ? segments[(i + 1) % segments.length] : null;

    const isFirstSegment = i === 0;
    const isLastSegment = i === segments.length - 1;

    // Get per-point widths for start and end of segment. Points whose ribs are
    // locked to a neighbour's take the shared value, so every segment touching
    // such a point places its rib in the same place.
    let startLeftHalfWidth = resolveHalfWidth(segment.startPoint, "left");
    let startRightHalfWidth = resolveHalfWidth(segment.startPoint, "right");
    let endLeftHalfWidth = resolveHalfWidth(segment.endPoint, "left");
    let endRightHalfWidth = resolveHalfWidth(segment.endPoint, "right");

    // Single-sided mode: redirect all width to one side
    if (singleSided) {
      const startTotal = startLeftHalfWidth + startRightHalfWidth;
      const endTotal = endLeftHalfWidth + endRightHalfWidth;

      if (singleSidedDirection === "left") {
        // All width goes to the left side
        startLeftHalfWidth = startTotal;
        startRightHalfWidth = 0;
        endLeftHalfWidth = endTotal;
        endRightHalfWidth = 0;
      } else {
        // All width goes to the right side
        startLeftHalfWidth = 0;
        startRightHalfWidth = startTotal;
        endLeftHalfWidth = 0;
        endRightHalfWidth = endTotal;
      }
    }

    const offsetPoints = generateOffsetPointsForSegment(
      segment,
      prevSegment,
      nextSegment,
      defaultWidth,
      isFirstSegment,
      isLastSegment,
      isClosed,
      capStyle,
      startLeftHalfWidth,
      startRightHalfWidth,
      endLeftHalfWidth,
      endRightHalfWidth,
      {
        contourIndex: options.contourIndex ?? null,
        segmentIndex: i,
      },
      singleSided,
      singleSidedDirection,
      authoredKeys
    );

    leftSide.push(...offsetPoints.left);
    rightSide.push(...offsetPoints.right);
  }

  let roundedLeftSide = roundSharpCornersOnSide(leftSide, {
    isClosed,
    cornerTrimRatio: clampCornerTrimRatio(options.cornerTrimRatio ?? cornerTrimRatio),
    cornerRadiusBoost: clampCornerRadiusBoost(
      options.cornerRadiusBoost ?? cornerRadiusBoost
    ),
    side: "left",
  });
  let roundedRightSide = roundSharpCornersOnSide(rightSide, {
    isClosed,
    cornerTrimRatio: clampCornerTrimRatio(options.cornerTrimRatio ?? cornerTrimRatio),
    cornerRadiusBoost: clampCornerRadiusBoost(
      options.cornerRadiusBoost ?? cornerRadiusBoost
    ),
    side: "right",
  });

  if (isClosed) {
    // For closed skeleton: TWO separate contours (outer and inner)
    // The inner contour needs to be reversed for correct winding direction
    // (outer = counter-clockwise, inner = clockwise for proper fill)
    const reversedRight = [...roundedRightSide].reverse();

    // DISABLED for performance testing - alignHandleDirections is O(n³)
    // const alignedLeftSide = alignHandleDirections(leftSide, segments, true);
    // const alignedRightSide = alignHandleDirections(reversedRight, segments, false);

    const leftContourPoints = enforceSmoothColinearity(
      stripCornerRoundMetadata(roundedLeftSide),
      true,
      {
        includeLinearNeighborCases: true,
        maxHandleRotationDeg: 60,
      }
    );
    const rightContourPoints = enforceSmoothColinearity(
      stripCornerRoundMetadata(reversedRight),
      true,
      {
        includeLinearNeighborCases: true,
        maxHandleRotationDeg: 60,
      }
    );

    let contours = [
      { points: leftContourPoints, isClosed: true },
      { points: rightContourPoints, isClosed: true },
    ];

    // Apply reverse if flag is set
    if (reversed) {
      contours = contours.map((c) => reverseContour(c));
    }

    return contours;
  } else {
    // For open skeleton: ONE contour with caps at ends
    // Get per-point widths for first and last on-curve points
    // Through the same resolver as every rib: an endpoint whose rib is tied to
    // its neighbour's draws at the shared width, and a cap built from the stored
    // one instead would sit off the end of the stroke it caps.
    let startCapLeftHW = resolveHalfWidth(firstOnCurvePoint, "left");
    let startCapRightHW = resolveHalfWidth(firstOnCurvePoint, "right");
    let endCapLeftHW = resolveHalfWidth(lastOnCurvePoint, "left");
    let endCapRightHW = resolveHalfWidth(lastOnCurvePoint, "right");

    // Single-sided mode: redirect all width to one side for caps too
    if (singleSided) {
      const startTotal = startCapLeftHW + startCapRightHW;
      const endTotal = endCapLeftHW + endCapRightHW;

      if (singleSidedDirection === "left") {
        startCapLeftHW = startTotal;
        startCapRightHW = 0;
        endCapLeftHW = endTotal;
        endCapRightHW = 0;
      } else {
        startCapLeftHW = 0;
        startCapRightHW = startTotal;
        endCapLeftHW = 0;
        endCapRightHW = endTotal;
      }
    }

    const startIsRound = startCapStyle === "round";
    const endIsRound = endCapStyle === "round";
    const startIsSquare = startCapStyle === "square";
    const endIsSquare = endCapStyle === "square";
    const startIsDrop = startCapStyle === "drop";
    const endIsDrop = endCapStyle === "drop";
    const startIsSerif = startCapStyle === "serif";
    const endIsSerif = endCapStyle === "serif";

    let startCap = [];
    let endCap = [];

    if (startIsRound) {
      const startTangent = getSegmentTangent(segments[0], "start");
      const leftStart = getFirstOnCurvePoint(roundedLeftSide);
      const rightStart = getFirstOnCurvePoint(roundedRightSide);
      if (leftStart && rightStart) {
        const capWidth = startCapLeftHW + startCapRightHW;
        const capRadiusRatio =
          firstOnCurvePoint.capRadiusRatio ??
          skeletonContour.capRadiusRatio ??
          DEFAULT_CAP_RADIUS_RATIO;
        const capTension =
          firstOnCurvePoint.capTension ??
          skeletonContour.capTension ??
          DEFAULT_CAP_TENSION;
        const frame = getRoundCapFrame({
          endpointTangent: startTangent,
          capRadiusRatio,
          capWidth,
          position: "start",
        });
        const rightNext = getNextOnCurvePoint(roundedRightSide, 0);
        const leftNext = getNextOnCurvePoint(roundedLeftSide, 0);
        const rightChordDirection = rightNext
          ? vector.normalizeVector(vector.subVectors(rightStart, rightNext))
          : frame.capTangent;
        const leftChordDirection = leftNext
          ? vector.normalizeVector(vector.subVectors(leftStart, leftNext))
          : frame.capTangent;
        const rightSplit = splitTerminalSideForRoundCap(
          roundedRightSide,
          "start",
          frame.trimDistance,
          {
            endpointTangent: frame.capTangent,
            chordDirection: rightChordDirection,
            capTangent: frame.capTangent,
          }
        );
        const leftSplit = splitTerminalSideForRoundCap(
          roundedLeftSide,
          "start",
          frame.trimDistance,
          {
            endpointTangent: frame.capTangent,
            chordDirection: leftChordDirection,
            capTangent: frame.capTangent,
          }
        );
        if (rightSplit && leftSplit) {
          roundedRightSide = trimSideForRoundCapEmission(
            rightSplit.sidePoints,
            "start",
            rightSplit.referenceEndpointIndex
          );
          roundedLeftSide = trimSideForRoundCapEmission(
            leftSplit.sidePoints,
            "start",
            leftSplit.referenceEndpointIndex
          );
          const builtStartCap = buildRoundCapGeometry({
            position: "start",
            insertedLeft: leftSplit.insertedPoint,
            insertedRight: rightSplit.insertedPoint,
            leftTangentToEndpoint: leftSplit.tangentToEndpoint,
            rightTangentToEndpoint: rightSplit.tangentToEndpoint,
            referenceLeft: leftSplit.referenceEndpoint,
            referenceRight: rightSplit.referenceEndpoint,
            capTangent: frame.capTangent,
            capTension,
            radiusFactor: frame.radiusFactor,
            capWidth,
            preserveCoincidentMaxRadiusEndpoints: true,
            debugContext: {
              contourIndex: options.contourIndex ?? null,
              segmentIndex: 0,
              side: "cap",
              capPosition: "start",
            },
          });
          startCap = builtStartCap.capPoints;
        }
      }
    } else if (startIsSquare) {
      const startAngle =
        firstOnCurvePoint.capAngle ?? skeletonContour.capAngle ?? DEFAULT_CAP_ANGLE;
      const startDistance =
        firstOnCurvePoint.capDistance ?? skeletonContour.capDistance ?? 0;
      const clampedAngle = Math.min(
        Math.max(startAngle, -MAX_CAP_ANGLE),
        MAX_CAP_ANGLE
      );
      const startTangent = getSegmentTangent(segments[0], "start");
      const capTangent = { x: -startTangent.x, y: -startTangent.y };
      const capWidth = startCapLeftHW + startCapRightHW;
      const delta = Math.tan((Math.abs(clampedAngle) * Math.PI) / 180) * capWidth;
      const hasAngle = Math.abs(clampedAngle) > 0.001;
      const hasDistance = startDistance > 0.001;
      let moveLeft = clampedAngle > 0;
      if (startCapLeftHW < 0.5 && startCapRightHW > 0.5) moveLeft = false;
      if (startCapRightHW < 0.5 && startCapLeftHW > 0.5) moveLeft = true;

      const leftStart = getFirstOnCurvePoint(roundedLeftSide);
      const rightStart = getFirstOnCurvePoint(roundedRightSide);
      const leftHandleDir = getSideHandleDirection(roundedLeftSide, "start");
      const rightHandleDir = getSideHandleDirection(roundedRightSide, "start");
      const addLeft = hasDistance || (hasAngle && moveLeft);
      const addRight = hasDistance || (hasAngle && !moveLeft);
      const leftDelta = hasAngle && moveLeft ? delta : 0;
      const rightDelta = hasAngle && !moveLeft ? delta : 0;
      if (addLeft) {
        const leftExtra = createSquareCapPoint(
          leftStart,
          leftHandleDir,
          capTangent,
          hasDistance ? startDistance : 0,
          leftDelta
        );
        if (leftExtra) roundedLeftSide.unshift(leftExtra);
      }
      if (addRight) {
        const rightExtra = createSquareCapPoint(
          rightStart,
          rightHandleDir,
          capTangent,
          hasDistance ? startDistance : 0,
          rightDelta
        );
        if (rightExtra) roundedRightSide.unshift(rightExtra);
      }
    } else if (startIsDrop) {
      const startTangent = getSegmentTangent(segments[0], "start");
      const drop = buildDropCap({
        position: "start",
        outerSide: resolveDropCapOuterSide(
          segments[0],
          firstOnCurvePoint,
          skeletonContour,
          startCapLeftHW,
          startCapRightHW
        ),
        endpoint: firstOnCurvePoint,
        outwardTangent: { x: -startTangent.x, y: -startTangent.y },
        leftSide: roundedLeftSide,
        rightSide: roundedRightSide,
        capWidth: startCapLeftHW + startCapRightHW,
        capBallRatio:
          firstOnCurvePoint.capBallRatio ??
          skeletonContour.capBallRatio ??
          DEFAULT_CAP_BALL_RATIO,
        capBallShape:
          firstOnCurvePoint.capBallShape ??
          skeletonContour.capBallShape ??
          DEFAULT_CAP_BALL_SHAPE,
        capTension:
          firstOnCurvePoint.capTension ??
          skeletonContour.capTension ??
          DEFAULT_CAP_TENSION,
      });
      if (drop) {
        roundedLeftSide = drop.leftSide;
        roundedRightSide = drop.rightSide;
        startCap = drop.capPoints;
      }
    } else if (startIsSerif) {
      const startTangent = getSegmentTangent(segments[0], "start");
      const serifCap = buildSerifCap({
        position: "start",
        endpoint: firstOnCurvePoint,
        tangent: { x: -startTangent.x, y: -startTangent.y },
        normal: getEffectiveNormal(
          firstOnCurvePoint,
          vector.rotateVector90CW(startTangent)
        ),
        leftSide: roundedLeftSide,
        rightSide: roundedRightSide,
        leftHalfWidth: startCapLeftHW,
        rightHalfWidth: startCapRightHW,
        pointSerif: firstOnCurvePoint.serif,
        contourSerif: skeletonContour.serif,
        ownerPoint: firstOnCurvePoint,
        serifUnitsMode: options.serifUnitsMode,
      });
      if (serifCap) {
        roundedLeftSide = serifCap.leftSide;
        roundedRightSide = serifCap.rightSide;
        startCap = serifCap.capPoints;
      }
    } else {
      startCap = generateCap(
        firstOnCurvePoint,
        segments[0],
        defaultWidth,
        startCapStyle,
        "start",
        startCapLeftHW,
        startCapRightHW
      );
    }

    if (endIsRound) {
      const endTangent = getSegmentTangent(segments[segments.length - 1], "end");
      const leftEnd = getLastOnCurvePoint(roundedLeftSide);
      const rightEnd = getLastOnCurvePoint(roundedRightSide);
      if (leftEnd && rightEnd) {
        const capWidth = endCapLeftHW + endCapRightHW;
        const capRadiusRatio =
          lastOnCurvePoint.capRadiusRatio ??
          skeletonContour.capRadiusRatio ??
          DEFAULT_CAP_RADIUS_RATIO;
        const capTension =
          lastOnCurvePoint.capTension ??
          skeletonContour.capTension ??
          DEFAULT_CAP_TENSION;
        const frame = getRoundCapFrame({
          endpointTangent: endTangent,
          capRadiusRatio,
          capWidth,
          position: "end",
        });
        const leftPrev = getPreviousOnCurvePoint(
          roundedLeftSide,
          roundedLeftSide.length - 1
        );
        const rightPrev = getPreviousOnCurvePoint(
          roundedRightSide,
          roundedRightSide.length - 1
        );
        const leftChordDirection = leftPrev
          ? vector.normalizeVector(vector.subVectors(leftEnd, leftPrev))
          : frame.capTangent;
        const rightChordDirection = rightPrev
          ? vector.normalizeVector(vector.subVectors(rightEnd, rightPrev))
          : frame.capTangent;
        const leftSplit = splitTerminalSideForRoundCap(
          roundedLeftSide,
          "end",
          frame.trimDistance,
          {
            endpointTangent: frame.capTangent,
            chordDirection: leftChordDirection,
            capTangent: frame.capTangent,
          }
        );
        const rightSplit = splitTerminalSideForRoundCap(
          roundedRightSide,
          "end",
          frame.trimDistance,
          {
            endpointTangent: frame.capTangent,
            chordDirection: rightChordDirection,
            capTangent: frame.capTangent,
          }
        );
        if (leftSplit && rightSplit) {
          roundedLeftSide = trimSideForRoundCapEmission(
            leftSplit.sidePoints,
            "end",
            leftSplit.referenceEndpointIndex
          );
          roundedRightSide = trimSideForRoundCapEmission(
            rightSplit.sidePoints,
            "end",
            rightSplit.referenceEndpointIndex
          );
          const builtEndCap = buildRoundCapGeometry({
            position: "end",
            insertedLeft: leftSplit.insertedPoint,
            insertedRight: rightSplit.insertedPoint,
            leftTangentToEndpoint: leftSplit.tangentToEndpoint,
            rightTangentToEndpoint: rightSplit.tangentToEndpoint,
            referenceLeft: leftSplit.referenceEndpoint,
            referenceRight: rightSplit.referenceEndpoint,
            capTangent: frame.capTangent,
            capTension,
            radiusFactor: frame.radiusFactor,
            capWidth,
            preserveCoincidentMaxRadiusEndpoints: true,
            debugContext: {
              contourIndex: options.contourIndex ?? null,
              segmentIndex: segments.length - 1,
              side: "cap",
              capPosition: "end",
            },
          });
          endCap = builtEndCap.capPoints;
        }
      }
    } else if (endIsSquare) {
      const endAngle =
        lastOnCurvePoint.capAngle ?? skeletonContour.capAngle ?? DEFAULT_CAP_ANGLE;
      const endDistance =
        lastOnCurvePoint.capDistance ?? skeletonContour.capDistance ?? 0;
      const clampedAngle = Math.min(Math.max(endAngle, -MAX_CAP_ANGLE), MAX_CAP_ANGLE);
      const endTangent = getSegmentTangent(segments[segments.length - 1], "end");
      const capTangent = endTangent;
      const capWidth = endCapLeftHW + endCapRightHW;
      const delta = Math.tan((Math.abs(clampedAngle) * Math.PI) / 180) * capWidth;
      const hasAngle = Math.abs(clampedAngle) > 0.001;
      const hasDistance = endDistance > 0.001;
      let moveLeft = clampedAngle > 0;
      if (endCapLeftHW < 0.5 && endCapRightHW > 0.5) moveLeft = false;
      if (endCapRightHW < 0.5 && endCapLeftHW > 0.5) moveLeft = true;

      const leftEnd = getLastOnCurvePoint(roundedLeftSide);
      const rightEnd = getLastOnCurvePoint(roundedRightSide);
      const leftHandleDir = getSideHandleDirection(roundedLeftSide, "end");
      const rightHandleDir = getSideHandleDirection(roundedRightSide, "end");
      const addLeft = hasDistance || (hasAngle && moveLeft);
      const addRight = hasDistance || (hasAngle && !moveLeft);
      const leftDelta = hasAngle && moveLeft ? delta : 0;
      const rightDelta = hasAngle && !moveLeft ? delta : 0;
      if (addLeft) {
        const leftExtra = createSquareCapPoint(
          leftEnd,
          leftHandleDir,
          capTangent,
          hasDistance ? endDistance : 0,
          leftDelta
        );
        if (leftExtra) roundedLeftSide.push(leftExtra);
      }
      if (addRight) {
        const rightExtra = createSquareCapPoint(
          rightEnd,
          rightHandleDir,
          capTangent,
          hasDistance ? endDistance : 0,
          rightDelta
        );
        if (rightExtra) roundedRightSide.push(rightExtra);
      }
    } else if (endIsDrop) {
      const endTangent = getSegmentTangent(segments[segments.length - 1], "end");
      const drop = buildDropCap({
        position: "end",
        outerSide: resolveDropCapOuterSide(
          segments[segments.length - 1],
          lastOnCurvePoint,
          skeletonContour,
          endCapLeftHW,
          endCapRightHW
        ),
        endpoint: lastOnCurvePoint,
        outwardTangent: endTangent,
        leftSide: roundedLeftSide,
        rightSide: roundedRightSide,
        capWidth: endCapLeftHW + endCapRightHW,
        capBallRatio:
          lastOnCurvePoint.capBallRatio ??
          skeletonContour.capBallRatio ??
          DEFAULT_CAP_BALL_RATIO,
        capBallShape:
          lastOnCurvePoint.capBallShape ??
          skeletonContour.capBallShape ??
          DEFAULT_CAP_BALL_SHAPE,
        capTension:
          lastOnCurvePoint.capTension ??
          skeletonContour.capTension ??
          DEFAULT_CAP_TENSION,
      });
      if (drop) {
        roundedLeftSide = drop.leftSide;
        roundedRightSide = drop.rightSide;
        endCap = drop.capPoints;
      }
    } else if (endIsSerif) {
      const endTangent = getSegmentTangent(segments[segments.length - 1], "end");
      const serifCap = buildSerifCap({
        position: "end",
        endpoint: lastOnCurvePoint,
        tangent: endTangent,
        normal: getEffectiveNormal(
          lastOnCurvePoint,
          vector.rotateVector90CW(endTangent)
        ),
        leftSide: roundedLeftSide,
        rightSide: roundedRightSide,
        leftHalfWidth: endCapLeftHW,
        rightHalfWidth: endCapRightHW,
        pointSerif: lastOnCurvePoint.serif,
        contourSerif: skeletonContour.serif,
        ownerPoint: lastOnCurvePoint,
        serifUnitsMode: options.serifUnitsMode,
      });
      if (serifCap) {
        roundedLeftSide = serifCap.leftSide;
        roundedRightSide = serifCap.rightSide;
        endCap = serifCap.capPoints;
      }
    } else {
      endCap = generateCap(
        lastOnCurvePoint,
        segments[segments.length - 1],
        defaultWidth,
        endCapStyle,
        "end",
        endCapLeftHW,
        endCapRightHW
      );
    }

    roundedLeftSide = applySerifAuthoredHandles(roundedLeftSide, "left", authoredKeys);
    roundedRightSide = applySerifAuthoredHandles(
      roundedRightSide,
      "right",
      authoredKeys
    );

    const outlinePoints = [];
    // Left side forward
    outlinePoints.push(...roundedLeftSide);
    // End cap
    outlinePoints.push(...endCap);
    // Right side backward
    outlinePoints.push(...roundedRightSide.reverse());
    // Start cap
    outlinePoints.push(...startCap);

    // DISABLED for performance testing - alignHandleDirections is O(n³)
    // const alignedOutlinePoints = alignHandleDirections(outlinePoints, segments, null);

    const colinearPoints = enforceSmoothColinearity(
      stripCornerRoundMetadata(outlinePoints),
      true,
      {
        includeLinearNeighborCases: true,
        maxHandleRotationDeg: 60,
      }
    );
    const finalPoints = options.removeCollapsedPoints
      ? removeCollapsedOutlinePoints(colinearPoints)
      : colinearPoints;
    let contour = { points: finalPoints, isClosed: true };

    // Apply reverse if flag is set
    if (reversed) {
      contour = reverseContour(contour);
    }

    return [contour];
  }
}

/**
 * Reverse a contour's point order.
 * @param {Object} contour - Contour with points array and isClosed flag
 * @returns {Object} New contour with reversed points
 */
function reverseContour(contour) {
  const points = [...contour.points];
  points.reverse();
  if (contour.isClosed && points.length > 0) {
    // For closed contours, rotate so start point stays consistent
    const [lastPoint] = points.splice(-1, 1);
    points.splice(0, 0, lastPoint);
  }
  return { ...contour, points };
}

/**
 * Build segments from skeleton points.
 * Each segment has startPoint, endPoint, and optional control points.
 */
function buildSegmentsFromPoints(points, isClosed) {
  const segments = [];
  const numPoints = points.length;

  // Find on-curve point indices
  const onCurveIndices = [];
  for (let i = 0; i < numPoints; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }

  if (onCurveIndices.length < 2) {
    return segments;
  }

  // Build segments between consecutive on-curve points
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    const startIdx = onCurveIndices[i];
    const endIdx = onCurveIndices[i + 1];

    const segment = {
      startPoint: points[startIdx],
      endPoint: points[endIdx],
      controlPoints: [],
    };

    // Collect off-curve points between start and end
    for (let j = startIdx + 1; j < endIdx; j++) {
      segment.controlPoints.push(points[j]);
    }

    segments.push(segment);
  }

  // For closed contour, add segment from last to first on-curve point
  if (isClosed && onCurveIndices.length >= 2) {
    const lastIdx = onCurveIndices[onCurveIndices.length - 1];
    const firstIdx = onCurveIndices[0];

    const segment = {
      startPoint: points[lastIdx],
      endPoint: points[firstIdx],
      controlPoints: [],
    };

    // Off-curves after last on-curve
    for (let j = lastIdx + 1; j < numPoints; j++) {
      if (points[j].type) {
        segment.controlPoints.push(points[j]);
      }
    }
    // Off-curves before first on-curve
    for (let j = 0; j < firstIdx; j++) {
      if (points[j].type) {
        segment.controlPoints.push(points[j]);
      }
    }

    segments.push(segment);
  }

  return segments;
}

function getSkeletonDebugState() {
  if (typeof globalThis === "undefined") {
    return { enabled: false, filter: null };
  }
  const enabledFlag = globalThis.__fontraSkeletonDebug;
  return {
    // Disabled by default; enable explicitly via globalThis.__fontraSkeletonDebug.
    enabled: enabledFlag === undefined ? false : !!enabledFlag,
    filter: globalThis.__fontraSkeletonDebugFilter || null,
  };
}

function shouldLogSkeletonDebug(debugContext) {
  const debugState = getSkeletonDebugState();
  if (!debugState.enabled) return false;
  const filter = debugState.filter;
  if (!filter) return true;
  if (
    filter.contourIndex !== undefined &&
    debugContext?.contourIndex !== filter.contourIndex
  ) {
    return false;
  }
  if (
    filter.segmentIndex !== undefined &&
    debugContext?.segmentIndex !== filter.segmentIndex
  ) {
    return false;
  }
  if (filter.side !== undefined && debugContext?.side !== filter.side) {
    return false;
  }
  return true;
}

function logSkeletonDebug(debugContext, payload) {
  if (!shouldLogSkeletonDebug(debugContext)) return;
  const message = {
    contourIndex: debugContext?.contourIndex ?? null,
    segmentIndex: debugContext?.segmentIndex ?? null,
    side: debugContext?.side ?? null,
    ...payload,
  };
  // Log as a single string to avoid collapsed object entries in DevTools.
  console.log(`${SKELETON_DEBUG_PREFIX} ${JSON.stringify(message)}`);
}

/**
 * Generate offset points for a segment.
 * For open skeletons: first segment adds start, all segments add end
 * For closed skeletons: all segments add start (end connects to next start)
 * @param {Object} segment - The segment to generate offsets for
 * @param {Object|null} prevSegment - Previous segment (for corner normals)
 * @param {Object|null} nextSegment - Next segment (for corner normals)
 * @param {number} width - Default width (fallback)
 * @param {boolean} isFirst - Is this the first segment
 * @param {boolean} isLast - Is this the last segment
 * @param {boolean} isClosed - Is the contour closed
 * @param {string} capStyle - Cap style for open endpoints
 * @param {number} startLeftHalfWidth - Half-width on left side at start point
 * @param {number} startRightHalfWidth - Half-width on right side at start point
 * @param {number} endLeftHalfWidth - Half-width on left side at end point
 * @param {number} endRightHalfWidth - Half-width on right side at end point
 * @param {Object|null} debugContext - Optional debug metadata for console logs
 */
function generateOffsetPointsForSegment(
  segment,
  prevSegment,
  nextSegment,
  width,
  isFirst,
  isLast,
  isClosed,
  capStyle = "butt",
  startLeftHalfWidth = null,
  startRightHalfWidth = null,
  endLeftHalfWidth = null,
  endRightHalfWidth = null,
  debugContext = null,
  singleSided = false,
  singleSidedDirection = "left",
  authoredKeys = null
) {
  // Use provided half-widths or fall back to width/2
  const halfWidth = width / 2;
  const startLeftHW = startLeftHalfWidth ?? halfWidth;
  const startRightHW = startRightHalfWidth ?? halfWidth;
  const endLeftHW = endLeftHalfWidth ?? halfWidth;
  const endRightHW = endRightHalfWidth ?? halfWidth;

  const isCollapsedSide = (value) => value < 0.5;
  const collapsedSideInSingleSided = singleSided
    ? singleSidedDirection === "left"
      ? "right"
      : "left"
    : null;
  const getCornerRoundBaseForSide = (side, halfWidthValue, oppositeHalfWidthValue) => {
    if (!singleSided || side !== collapsedSideInSingleSided) {
      return halfWidthValue;
    }
    if (!isCollapsedSide(halfWidthValue)) {
      return halfWidthValue;
    }
    return Math.max(halfWidthValue, oppositeHalfWidthValue ?? 0);
  };

  const startLeftRoundBase = getCornerRoundBaseForSide(
    "left",
    startLeftHW,
    startRightHW
  );
  const startRightRoundBase = getCornerRoundBaseForSide(
    "right",
    startRightHW,
    startLeftHW
  );
  const endLeftRoundBase = getCornerRoundBaseForSide("left", endLeftHW, endRightHW);
  const endRightRoundBase = getCornerRoundBaseForSide("right", endRightHW, endLeftHW);

  const left = [];
  const right = [];
  const projectPoint = (basePoint, normal, halfWidth, sign) => {
    if (isCollapsedSide(halfWidth)) {
      return { x: basePoint.x, y: basePoint.y };
    }
    return {
      x: Math.round(basePoint.x + sign * normal.x * halfWidth),
      y: Math.round(basePoint.y + sign * normal.y * halfWidth),
    };
  };

  if (segment.controlPoints.length === 0) {
    // Line segment - simple offset with per-point widths
    const direction = vector.normalizeVector(
      vector.subVectors(segment.endPoint, segment.startPoint)
    );
    const normal = vector.rotateVector90CW(direction);

    // Add start point offset:
    // - For open skeletons: only for the first segment
    // - For closed skeletons: for all segments (each adds its start)
    const shouldAddStart = isClosed || isFirst;
    if (shouldAddStart) {
      let startNormal =
        !prevSegment ||
        (isFirst && !isClosed) ||
        // Direction comes from this straight, not from a miter average with the
        // one handle on the far side.
        isStraightControlledSmoothPoint(segment.startPoint, segment, prevSegment)
          ? normal
          : calculateCornerNormal(prevSegment, segment, startLeftHW);
      // Apply angle override if set on the point
      startNormal = getEffectiveNormal(segment.startPoint, startNormal);

      // Copy smooth property from skeleton point, round to UPM grid
      // Use per-point half-widths for left and right sides
      // Apply nudge offset if point is editable
      const startLeftNudge = ribNudgeDisplacement(
        segment.startPoint,
        startNormal,
        "left",
        startLeftHW
      );
      const startLeftBase = projectPoint(
        segment.startPoint,
        startNormal,
        startLeftHW,
        1
      );
      const startLeftPt = translateRibPoint(startLeftBase, startLeftNudge);
      left.push(
        buildGeneratedOnCurve(
          startLeftPt,
          segment.startPoint.smooth,
          segment.startPoint,
          startLeftHW,
          startLeftRoundBase,
          "left",
          startLeftNudge,
          startLeftBase
        )
      );

      const startRightNudge = ribNudgeDisplacement(
        segment.startPoint,
        startNormal,
        "right",
        startRightHW
      );
      const startRightBase = projectPoint(
        segment.startPoint,
        startNormal,
        startRightHW,
        -1
      );
      const startRightPt = translateRibPoint(startRightBase, startRightNudge);
      right.push(
        buildGeneratedOnCurve(
          startRightPt,
          segment.startPoint.smooth,
          segment.startPoint,
          startRightHW,
          startRightRoundBase,
          "right",
          startRightNudge,
          startRightBase
        )
      );
    }

    // Add end point offset:
    // - For open skeletons: for all segments (each adds its end)
    // - For closed skeletons: don't add (next segment's start is this end)
    const shouldAddEnd = !isClosed;
    if (shouldAddEnd) {
      let endNormal =
        !nextSegment ||
        isLast ||
        // Direction comes from this straight, not from a miter average with the
        // one handle on the far side.
        isStraightControlledSmoothPoint(segment.endPoint, segment, nextSegment)
          ? normal
          : calculateCornerNormal(segment, nextSegment, endLeftHW);
      // Apply angle override if set on the point
      endNormal = getEffectiveNormal(segment.endPoint, endNormal);

      // Copy smooth property from skeleton point, round to UPM grid
      // Use per-point half-widths for left and right sides
      // Apply nudge offset if point is editable
      const endLeftNudge = ribNudgeDisplacement(
        segment.endPoint,
        endNormal,
        "left",
        endLeftHW
      );
      const endLeftBase = projectPoint(segment.endPoint, endNormal, endLeftHW, 1);
      const endLeftPt = translateRibPoint(endLeftBase, endLeftNudge);
      left.push(
        buildGeneratedOnCurve(
          endLeftPt,
          segment.endPoint.smooth,
          segment.endPoint,
          endLeftHW,
          endLeftRoundBase,
          "left",
          endLeftNudge,
          endLeftBase
        )
      );

      const endRightNudge = ribNudgeDisplacement(
        segment.endPoint,
        endNormal,
        "right",
        endRightHW
      );
      const endRightBase = projectPoint(segment.endPoint, endNormal, endRightHW, -1);
      const endRightPt = translateRibPoint(endRightBase, endRightNudge);
      right.push(
        buildGeneratedOnCurve(
          endRightPt,
          segment.endPoint.smooth,
          segment.endPoint,
          endRightHW,
          endRightRoundBase,
          "right",
          endRightNudge,
          endRightBase
        )
      );
    }
  } else {
    // Cubic segments use the constructed endpoint-constrained offset cubic.
    const bezierPoints = [
      segment.startPoint,
      ...segment.controlPoints,
      segment.endPoint,
    ];

    // Convert to bezier-js format
    const bezier = createBezierFromPoints(bezierPoints);

    // Calculate normals at endpoints for corner handling
    const startDeriv = bezier.derivative(0);
    const startTangent = vector.normalizeVector({ x: startDeriv.x, y: startDeriv.y });
    const bezierStartNormal = vector.rotateVector90CW(startTangent);

    const endDeriv = bezier.derivative(1);
    const endTangent = vector.normalizeVector({ x: endDeriv.x, y: endDeriv.y });
    const bezierEndNormal = vector.rotateVector90CW(endTangent);

    // For corners (non-smooth junctions), use averaged normal. A smooth point
    // whose only handle is on this curve takes its direction from the straight
    // segment on the other side instead — that straight is what defines it, so
    // its rib must be perpendicular to the straight and not to a miter average.
    let startNormal;
    if (!prevSegment || (isFirst && !isClosed)) {
      startNormal = bezierStartNormal;
    } else if (
      isStraightControlledSmoothPoint(segment.startPoint, prevSegment, segment)
    ) {
      startNormal = straightSegmentNormal(prevSegment);
    } else {
      startNormal = calculateCornerNormal(prevSegment, segment, startLeftHW);
    }
    // Apply angle override if set on the point
    startNormal = getEffectiveNormal(segment.startPoint, startNormal);

    let endNormal;
    if (!nextSegment || (isLast && !isClosed)) {
      endNormal = bezierEndNormal;
    } else if (
      isStraightControlledSmoothPoint(segment.endPoint, nextSegment, segment)
    ) {
      endNormal = straightSegmentNormal(nextSegment);
    } else {
      endNormal = calculateCornerNormal(segment, nextSegment, endLeftHW);
    }
    // Apply angle override if set on the point
    endNormal = getEffectiveNormal(segment.endPoint, endNormal);

    const avgLeftHW = (startLeftHW + endLeftHW) / 2;
    const avgRightHW = (startRightHW + endRightHW) / 2;

    // Fixed endpoint positions (using corner-aware normals and per-point widths),
    // rounded to UPM grid. These stay UN-nudged: the offset construction below
    // is fit against the un-nudged offset curve, so handing it a nudged endpoint
    // makes it shorten the handle to pull the curve back. On-curve nudge and
    // Z-normal handle carry are applied independently after construction.
    const fixedStartLeft = projectPoint(
      segment.startPoint,
      startNormal,
      startLeftHW,
      1
    );
    const fixedStartRight = projectPoint(
      segment.startPoint,
      startNormal,
      startRightHW,
      -1
    );
    const fixedEndLeft = projectPoint(segment.endPoint, endNormal, endLeftHW, 1);
    const fixedEndRight = projectPoint(segment.endPoint, endNormal, endRightHW, -1);

    const nudgeStartLeft = ribNudgeDisplacement(
      segment.startPoint,
      startNormal,
      "left",
      startLeftHW
    );
    const nudgeStartRight = ribNudgeDisplacement(
      segment.startPoint,
      startNormal,
      "right",
      startRightHW
    );
    const nudgeEndLeft = ribNudgeDisplacement(
      segment.endPoint,
      endNormal,
      "left",
      endLeftHW
    );
    const nudgeEndRight = ribNudgeDisplacement(
      segment.endPoint,
      endNormal,
      "right",
      endRightHW
    );

    const addOffsetCurves = (
      output,
      fixedStart,
      fixedEnd,
      shouldAddStart,
      shouldAddEnd,
      smoothStart,
      smoothEnd,
      sideHalfWidth,
      isLeftSide,
      startHalfWidth,
      endHalfWidth,
      startRoundBase,
      endRoundBase,
      startNudge,
      endNudge
    ) => {
      const side = isLeftSide ? "left" : "right";
      // When halfWidth is near zero, contour should exactly match skeleton
      // Copy control points directly instead of using offset curves
      if (isCollapsedSide(sideHalfWidth) && segment.controlPoints.length > 0) {
        if (shouldAddStart) {
          output.push(
            buildGeneratedOnCurve(
              segment.startPoint,
              smoothStart,
              segment.startPoint,
              startHalfWidth,
              startRoundBase,
              side,
              startNudge,
              segment.startPoint
            )
          );
        }
        // Collapsed side must stay exactly on skeleton geometry.
        for (const cp of segment.controlPoints) {
          output.push({ x: cp.x, y: cp.y, type: "cubic" });
        }
        if (shouldAddEnd) {
          output.push(
            buildGeneratedOnCurve(
              segment.endPoint,
              smoothEnd,
              segment.endPoint,
              endHalfWidth,
              endRoundBase,
              side,
              endNudge,
              segment.endPoint
            )
          );
        }
        return;
      }

      const controls = segment.controlPoints;
      const sideSign = isLeftSide ? 1 : -1;
      const startTangentFallback = getSegmentTangent(segment, "start");
      const endTangentFallback = getSegmentTangent(segment, "end");
      const startHandleDir = getSkeletonHandleDirection(segment, "start", "out");
      const endHandleDir = getSkeletonHandleDirection(segment, "end", "in");
      const startDir = startHandleDir ?? startTangentFallback;
      const endDir = endHandleDir ?? {
        x: -endTangentFallback.x,
        y: -endTangentFallback.y,
      };
      const { startLength, endLength } = offsetCubicSide({
        p0: segment.startPoint,
        p1: controls[0],
        p2: controls[controls.length - 1],
        p3: segment.endPoint,
        d0: sideSign * startHalfWidth,
        d3: sideSign * endHalfWidth,
        q0: fixedStart,
        q3: fixedEnd,
        u0: startDir,
        u1: endDir,
        // The pin lives on the skeleton segment's start point, so it reads the
        // same for both sides regardless of which way each side is emitted.
        // Read off the generator's own flattened point shape, not the canonical
        // one - by here the points have been through canonicalToGeneratorInput.
        pinnedTension: isLeftSide
          ? segment.startPoint.leftSegmentCurvature
          : segment.startPoint.rightSegmentCurvature,
        startAdjustment:
          startHandleDir && !authoredKeys?.has(`${segment.startPoint?.id}/${side}/out`)
            ? getGeneratedHandleAdjustment(
                segment.startPoint,
                startHandleDir,
                side,
                "out"
              )
            : null,
        endAdjustment:
          endHandleDir && !authoredKeys?.has(`${segment.endPoint?.id}/${side}/in`)
            ? getGeneratedHandleAdjustment(segment.endPoint, endHandleDir, side, "in")
            : null,
      });
      if (shouldAddStart)
        output.push(
          buildGeneratedOnCurve(
            translateRibPoint(fixedStart, startNudge),
            smoothStart,
            segment.startPoint,
            startHalfWidth,
            startRoundBase,
            side,
            startNudge,
            fixedStart
          )
        );
      const adjustedHandle1 = {
        x: fixedStart.x + startDir.x * startLength,
        y: fixedStart.y + startDir.y * startLength,
      };
      const adjustedHandle2 = {
        x: fixedEnd.x + endDir.x * endLength,
        y: fixedEnd.y + endDir.y * endLength,
      };
      const startHandleNudge = ribHandleNudgeDisplacement(
        segment.startPoint,
        startNormal,
        side,
        startHalfWidth
      );
      const endHandleNudge = ribHandleNudgeDisplacement(
        segment.endPoint,
        endNormal,
        side,
        endHalfWidth
      );
      const emittedNudge = (anchor, displacement) => {
        const translated = translateRibPoint(anchor, displacement);
        return { x: translated.x - anchor.x, y: translated.y - anchor.y };
      };
      for (const [point, owner, role, axis, handleNudge] of [
        [
          adjustedHandle1,
          segment.startPoint,
          "out",
          startDir,
          emittedNudge(fixedStart, startHandleNudge),
        ],
        [
          adjustedHandle2,
          segment.endPoint,
          "in",
          endDir,
          emittedNudge(fixedEnd, endHandleNudge),
        ],
      ]) {
        const generated = {
          x: Math.round(point.x),
          y: Math.round(point.y),
          type: "cubic",
        };
        const provenance = pointProvenance(owner, side, role);
        if (provenance) generated._provenance = provenance;
        // The exact unit direction this handle was constructed on, before the
        // grid snap above. enforceSmoothColinearity needs it: recovering the
        // direction from the rounded position is width-dependent and, on short
        // handles, quantized to the lattice.
        if (axis) generated._axis = { x: axis.x, y: axis.y };
        if (authoredKeys?.has(`${owner?.id}/${side}/${role}`)) {
          const adjustment = getGeneratedHandleAdjustment(owner, axis, side, role);
          if (adjustment) generated._authoredAdjustment = adjustment;
        }
        if (handleNudge.x || handleNudge.y) {
          generated._handleNudge = handleNudge;
        }
        output.push(generated);
      }
      if (shouldAddEnd)
        output.push(
          buildGeneratedOnCurve(
            translateRibPoint(fixedEnd, endNudge),
            smoothEnd,
            segment.endPoint,
            endHalfWidth,
            endRoundBase,
            side,
            endNudge,
            fixedEnd
          )
        );
      return;
    };

    // Determine which points to add based on closed/open and first/last
    const shouldAddStart = isClosed || isFirst;
    const shouldAddEnd = !isClosed;

    addOffsetCurves(
      left,
      fixedStartLeft,
      fixedEndLeft,
      shouldAddStart,
      shouldAddEnd,
      segment.startPoint.smooth,
      segment.endPoint.smooth,
      avgLeftHW,
      true, // isLeftSide
      startLeftHW,
      endLeftHW,
      startLeftRoundBase,
      endLeftRoundBase,
      nudgeStartLeft,
      nudgeEndLeft
    );

    addOffsetCurves(
      right,
      fixedStartRight,
      fixedEndRight,
      shouldAddStart,
      shouldAddEnd,
      segment.startPoint.smooth,
      segment.endPoint.smooth,
      avgRightHW,
      false, // isLeftSide
      startRightHW,
      endRightHW,
      startRightRoundBase,
      endRightRoundBase,
      nudgeStartRight,
      nudgeEndRight
    );
  }

  return { left, right };
}

/**
 * Half-widths for on-curve points whose ribs must move as one, keyed by the
 * skeleton point object.
 *
 * Every point in a tied group (collectTiedRibGroups, which owns the rule) gets
 * the mean of the group's stored half-widths, per side. Every consumer resolves
 * a point's width through this map, so the straight segment and whatever is on
 * the other side of a shared point cannot disagree about where the rib is.
 * @param {Array} segments - The contour's segments
 * @param {boolean} isClosed - Whether the contour is closed
 * @param {number} defaultWidth - Contour default width
 * @returns {Map} skeleton point -> {left, right}
 */
function coupledHalfWidths(segments, isClosed, defaultWidth, contourCapStyle) {
  const groups = collectTiedRibGroups(
    segments,
    isClosed,
    (point) => point.widthTied !== false,
    collectSerifTerminals(segments, isClosed, contourCapStyle)
  );
  const sharedByGroup = new Map();
  const coupled = new Map();
  for (const [point, group] of groups) {
    let shared = sharedByGroup.get(group);
    if (!shared) {
      shared = {};
      for (const side of ["left", "right"]) {
        shared[side] = meanHalfWidth(group, (member) =>
          getPointHalfWidth(member, defaultWidth, side)
        );
      }
      sharedByGroup.set(group, shared);
    }
    coupled.set(point, shared);
  }
  return coupled;
}

/**
 * Calculate the normal at a corner between two segments.
 * Uses miter join logic.
 */
function calculateCornerNormal(segment1, segment2, halfWidth) {
  // Get outgoing tangent from segment1 at its endpoint
  let dir1;
  if (segment1.controlPoints.length === 0) {
    // Line segment - direction is constant
    dir1 = vector.normalizeVector(
      vector.subVectors(segment1.endPoint, segment1.startPoint)
    );
  } else {
    // Bezier segment - use derivative at t=1
    const bezier1 = createBezierFromPoints([
      segment1.startPoint,
      ...segment1.controlPoints,
      segment1.endPoint,
    ]);
    const deriv1 = bezier1.derivative(1);
    dir1 = vector.normalizeVector({ x: deriv1.x, y: deriv1.y });
  }

  // Get incoming tangent from segment2 at its start point
  let dir2;
  if (segment2.controlPoints.length === 0) {
    // Line segment - direction is constant
    dir2 = vector.normalizeVector(
      vector.subVectors(segment2.endPoint, segment2.startPoint)
    );
  } else {
    // Bezier segment - use derivative at t=0
    const bezier2 = createBezierFromPoints([
      segment2.startPoint,
      ...segment2.controlPoints,
      segment2.endPoint,
    ]);
    const deriv2 = bezier2.derivative(0);
    dir2 = vector.normalizeVector({ x: deriv2.x, y: deriv2.y });
  }

  // Compute angle bisector using atan2 (numerically stable for all angles)
  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;

  // Angle from dir1 to dir2 (signed)
  const angle = Math.atan2(cross, dot);

  // Bisector = dir1 rotated by angle/2
  const halfAngle = angle / 2;
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);

  const bisector = {
    x: dir1.x * cosH - dir1.y * sinH,
    y: dir1.x * sinH + dir1.y * cosH,
  };

  // Normal is perpendicular to bisector (rotated 90° CW)
  return { x: bisector.y, y: -bisector.x };
}

/**
 * Create a Bezier object from skeleton points.
 */
function createBezierFromPoints(points) {
  if (points.length === 2) {
    // Line: bezier-js only accepts the point[] form for order-1 curves
    // (coordinate args would be misread as a higher-order curve and throw)
    return new Bezier([
      { x: points[0].x, y: points[0].y },
      { x: points[1].x, y: points[1].y },
    ]);
  } else if (points.length === 3) {
    // Quadratic bezier
    return new Bezier(
      points[0].x,
      points[0].y,
      points[1].x,
      points[1].y,
      points[2].x,
      points[2].y
    );
  } else if (points.length === 4) {
    // Cubic bezier
    return new Bezier(
      points[0].x,
      points[0].y,
      points[1].x,
      points[1].y,
      points[2].x,
      points[2].y,
      points[3].x,
      points[3].y
    );
  } else {
    // Multiple control points - approximate with cubic
    // Use first and last as anchors, intermediate as averaged controls
    const p0 = points[0];
    const p3 = points[points.length - 1];
    const p1 = points[1];
    const p2 = points[points.length - 2];
    return new Bezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
}

function normalizeCapStyle(style) {
  if (!style) return "butt";
  return style;
}

function getSegmentTangent(segment, position) {
  if (segment.controlPoints.length === 0) {
    const direction = vector.normalizeVector(
      vector.subVectors(segment.endPoint, segment.startPoint)
    );
    return direction;
  }
  const bezier = createBezierFromPoints([
    segment.startPoint,
    ...segment.controlPoints,
    segment.endPoint,
  ]);
  const t = position === "start" ? 0 : 1;
  const deriv = bezier.derivative(t);
  return vector.normalizeVector({ x: deriv.x, y: deriv.y });
}

function getFirstOnCurvePoint(points) {
  if (!points) return null;
  for (const point of points) {
    if (!point.type) return point;
  }
  return null;
}

function getLastOnCurvePoint(points) {
  if (!points) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (!points[i].type) return points[i];
  }
  return null;
}

function getSideHandleDirection(points, position) {
  if (!points || points.length < 2) return null;
  if (position === "start") {
    const startIdx = points.findIndex((p) => p && !p.type);
    if (startIdx < 0) return null;
    const startPoint = points[startIdx];
    for (let i = startIdx + 1; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      if (!point.type) break;
      const dir = { x: point.x - startPoint.x, y: point.y - startPoint.y };
      const len = Math.hypot(dir.x, dir.y);
      if (len > 0.001) return { x: dir.x / len, y: dir.y / len };
    }
    return null;
  }

  const endIdx = (() => {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i] && !points[i].type) return i;
    }
    return -1;
  })();
  if (endIdx < 0) return null;
  const endPoint = points[endIdx];
  for (let i = endIdx - 1; i >= 0; i--) {
    const point = points[i];
    if (!point) continue;
    if (!point.type) break;
    const dir = { x: point.x - endPoint.x, y: point.y - endPoint.y };
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0.001) return { x: dir.x / len, y: dir.y / len };
  }
  return null;
}

function createSquareCapPoint(basePoint, handleDir, capTangent, baseDistance, delta) {
  if (!basePoint) return null;
  const hasDistance = baseDistance > 0.001;
  const hasDelta = delta > 0.001;
  if (!hasDistance && !hasDelta) {
    return { x: basePoint.x, y: basePoint.y, smooth: false };
  }
  let dir = handleDir;
  if (!dir || Math.hypot(dir.x, dir.y) < 0.001) {
    dir = capTangent;
  }
  let denom = dir.x * capTangent.x + dir.y * capTangent.y;
  if (denom < 0) {
    dir = { x: -dir.x, y: -dir.y };
    denom = -denom;
  }
  let t = baseDistance;
  if (hasDelta) {
    if (denom < 0.001) {
      const total = baseDistance + delta;
      return {
        x: Math.round(basePoint.x + capTangent.x * total),
        y: Math.round(basePoint.y + capTangent.y * total),
        smooth: false,
      };
    }
    t += delta / denom;
  }
  if (!(t > 0.001)) {
    return { x: basePoint.x, y: basePoint.y, smooth: false };
  }
  return {
    x: Math.round(basePoint.x + dir.x * t),
    y: Math.round(basePoint.y + dir.y * t),
    smooth: false,
  };
}

function computeTunniHandleLengths(startPoint, startDir, endPoint, endDir, tension) {
  const dir1 = vector.normalizeVector(startDir);
  const dir2 = vector.normalizeVector(endDir);
  const line1End = vector.addVectors(startPoint, dir1);
  const line2End = vector.addVectors(endPoint, dir2);

  const intersection = vector.intersect(startPoint, line1End, endPoint, line2End);
  if (
    intersection &&
    Number.isFinite(intersection.t1) &&
    Number.isFinite(intersection.t2)
  ) {
    const distStartToTunni = Math.abs(intersection.t1);
    const distEndToTunni = Math.abs(intersection.t2);
    return {
      startLen: distStartToTunni * tension,
      endLen: distEndToTunni * tension,
    };
  }

  const distTotal = vector.distance(startPoint, endPoint);
  const fallbackLen = (distTotal * tension) / 2;
  return { startLen: fallbackLen, endLen: fallbackLen };
}

/**
 * Generate cap points for open skeleton endpoints.
 * @param {Object} point - The endpoint
 * @param {Object} segment - The segment at this endpoint
 * @param {number} width - Default width (fallback)
 * @param {string} capStyle - Cap style ("butt", "round", "square")
 * @param {string} position - "start" or "end"
 * @param {number} leftHalfWidth - Half-width on left side
 * @param {number} rightHalfWidth - Half-width on right side
 */
// ---- Split-outline round caps ----------------------------------------------
// Ported from test/cap-rounding-rewamp (branch tip 7719b68f4): round caps are
// rebuilt from split side outlines instead of the old projected scaffold. See
// docs/superpowers/notes/2026-07-06-parity-bugs.md item 3.4 and the branch doc
// docs/superpowers/cap-logic-overview.md for the geometry map.

function getNextOnCurvePoint(points, startIndex) {
  if (!points) return null;
  for (let i = startIndex + 1; i < points.length; i++) {
    if (points[i] && !points[i].type) return points[i];
  }
  return null;
}

function getPreviousOnCurvePoint(points, startIndex) {
  if (!points) return null;
  for (let i = startIndex - 1; i >= 0; i--) {
    if (points[i] && !points[i].type) return points[i];
  }
  return null;
}

function getRoundCapFrame({ endpointTangent, capRadiusRatio, capWidth, position }) {
  const clampedCapRadiusRatio = Math.min(
    Math.max(capRadiusRatio, 0),
    MAX_CAP_RADIUS_RATIO
  );
  const radiusFactor =
    MAX_CAP_RADIUS_RATIO > 0 ? clampedCapRadiusRatio / MAX_CAP_RADIUS_RATIO : 0;
  const maxProjectionShift = Math.max(capWidth / 2 - capWidth / 128, 0);
  const trimDistance = maxProjectionShift * radiusFactor;
  const capTangent =
    position === "start"
      ? { x: -endpointTangent.x, y: -endpointTangent.y }
      : endpointTangent;
  return { radiusFactor, maxProjectionShift, trimDistance, capTangent };
}

function solveTerminalSplitForDistance(bezier, fromEnd, trimDistance) {
  const totalLength = bezier.length();
  if (!(totalLength > 0.001)) {
    return fromEnd ? 1 : 0;
  }

  const clampedTrimDistance = Math.min(Math.max(trimDistance, 0), totalLength);
  const targetLength = fromEnd
    ? totalLength - clampedTrimDistance
    : clampedTrimDistance;

  let low = 0;
  let high = 1;
  let bestT = fromEnd ? 1 : 0;
  let bestError = Infinity;

  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    const split = bezier.split(mid);
    const leftLength = split.left.length();
    const error = Math.abs(leftLength - targetLength);

    if (error < bestError) {
      bestError = error;
      bestT = mid;
    }
    if (error <= 0.5 || high - low <= 1e-4) {
      break;
    }
    if (leftLength < targetLength) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return bestT;
}

function cloneRoundCapPoint(point) {
  return point ? { ...point } : null;
}

// The round-cap split rebuilds terminal-segment points from scratch; without
// re-attached provenance the fallback annotator guesses (side: null) and the
// whole trimmed region stops being addressable — editable generated handles
// next to a round-capped endpoint were unselectable.
function withRoundCapProvenance(point, sourcePoint) {
  if (point && sourcePoint?._provenance) {
    point._provenance = { ...sourcePoint._provenance };
  }
  if (point && sourcePoint?._authoredAdjustment) {
    point._authoredAdjustment = { ...sourcePoint._authoredAdjustment };
  }
  return point;
}

function buildSplitOffCurve(point, sourceHandle = null) {
  const offCurve = {
    x: point.x,
    y: point.y,
    type: "cubic",
  };
  if (sourceHandle?._axis) {
    offCurve._axis = { x: sourceHandle._axis.x, y: sourceHandle._axis.y };
  }
  return offCurve;
}

function buildInsertedRoundCapPoint(point) {
  return {
    x: point.x,
    y: point.y,
    smooth: true,
  };
}

function isUsableDirection(direction) {
  return !!direction && Math.hypot(direction.x, direction.y) > 0.001;
}

function resolveRoundCapFallbackDirection(fallbackDirections) {
  const candidateDirections = [
    fallbackDirections?.endpointTangent,
    fallbackDirections?.chordDirection,
    fallbackDirections?.capTangent,
  ];
  for (const direction of candidateDirections) {
    if (isUsableDirection(direction)) {
      return vector.normalizeVector(direction);
    }
  }
  return { x: 1, y: 0 };
}

function getRoundCapTerminalSegment(points, sidePosition) {
  if (!points?.length) {
    return null;
  }

  if (sidePosition === "start") {
    const startIndex = points.findIndex((point) => point && !point.type);
    if (startIndex < 0) {
      return null;
    }
    for (let endIndex = startIndex + 1; endIndex < points.length; endIndex++) {
      if (points[endIndex] && !points[endIndex].type) {
        return {
          segmentStartIndex: startIndex,
          segmentEndIndex: endIndex,
          segmentPoints: points.slice(startIndex, endIndex + 1),
        };
      }
    }
    return null;
  }

  let segmentEndIndex = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i] && !points[i].type) {
      segmentEndIndex = i;
      break;
    }
  }
  if (segmentEndIndex < 0) {
    return null;
  }
  for (let startIndex = segmentEndIndex - 1; startIndex >= 0; startIndex--) {
    if (points[startIndex] && !points[startIndex].type) {
      return {
        segmentStartIndex: startIndex,
        segmentEndIndex,
        segmentPoints: points.slice(startIndex, segmentEndIndex + 1),
      };
    }
  }
  return null;
}

function splitTerminalSideForRoundCap(
  sidePoints,
  sidePosition,
  trimDistance,
  fallbackDirections
) {
  const terminalSegment = getRoundCapTerminalSegment(sidePoints, sidePosition);
  if (!terminalSegment) {
    return null;
  }

  const { segmentStartIndex, segmentEndIndex, segmentPoints } = terminalSegment;
  const fromEnd = sidePosition === "end";
  const referenceEndpointIndex = fromEnd ? segmentEndIndex : segmentStartIndex;
  const referenceEndpoint = cloneRoundCapPoint(sidePoints[referenceEndpointIndex]);
  const fallbackDirection = resolveRoundCapFallbackDirection(fallbackDirections);
  const startPoint = segmentPoints[0];
  const endPoint = segmentPoints[segmentPoints.length - 1];
  const chordVector = vector.subVectors(endPoint, startPoint);
  const segmentBezier =
    segmentPoints.length === 2 || segmentPoints.length === 4
      ? createBezierFromPoints(segmentPoints)
      : null;
  const terminalSegmentLength = segmentBezier
    ? segmentBezier.length()
    : Math.hypot(chordVector.x, chordVector.y);

  let effectiveTrimDistance = Math.min(
    Math.max(trimDistance, 0),
    terminalSegmentLength
  );
  if (terminalSegmentLength >= 2 && effectiveTrimDistance < 1) {
    effectiveTrimDistance = 1;
  }

  const synthesizeInsertedPoint = () => {
    const insertedPoint = withRoundCapProvenance(
      buildInsertedRoundCapPoint({
        x: referenceEndpoint.x - fallbackDirection.x,
        y: referenceEndpoint.y - fallbackDirection.y,
      }),
      referenceEndpoint
    );
    const rewrittenSegment = fromEnd
      ? [cloneRoundCapPoint(startPoint), insertedPoint, referenceEndpoint]
      : [referenceEndpoint, insertedPoint, cloneRoundCapPoint(endPoint)];
    const rewrittenSidePoints = [
      ...sidePoints.slice(0, segmentStartIndex),
      ...rewrittenSegment,
      ...sidePoints.slice(segmentEndIndex + 1),
    ];
    return {
      sidePoints: rewrittenSidePoints,
      insertedPointIndex: fromEnd ? segmentStartIndex + 1 : segmentStartIndex + 1,
      insertedPoint,
      referenceEndpointIndex: fromEnd ? segmentStartIndex + 2 : segmentStartIndex,
      referenceEndpoint,
      tangentToEndpoint: fallbackDirection,
    };
  };

  if (terminalSegmentLength < 2) {
    return synthesizeInsertedPoint();
  }

  if (segmentPoints.length === 2) {
    const lineDirection = vector.normalizeVector(chordVector);
    if (!isUsableDirection(lineDirection)) {
      return synthesizeInsertedPoint();
    }
    const t = effectiveTrimDistance / terminalSegmentLength;
    const interpolationT = fromEnd ? 1 - t : t;
    const insertedCoords = vector.interpolateVectors(
      startPoint,
      endPoint,
      interpolationT
    );
    let insertedPoint = buildInsertedRoundCapPoint(insertedCoords);
    if (vector.distance(insertedPoint, referenceEndpoint) < 1) {
      insertedPoint = buildInsertedRoundCapPoint({
        x: referenceEndpoint.x - fallbackDirection.x,
        y: referenceEndpoint.y - fallbackDirection.y,
      });
    }
    withRoundCapProvenance(insertedPoint, referenceEndpoint);
    const tangentToEndpoint = fromEnd
      ? lineDirection
      : { x: -lineDirection.x, y: -lineDirection.y };
    const rewrittenSegment = fromEnd
      ? [cloneRoundCapPoint(startPoint), insertedPoint, referenceEndpoint]
      : [referenceEndpoint, insertedPoint, cloneRoundCapPoint(endPoint)];
    const rewrittenSidePoints = [
      ...sidePoints.slice(0, segmentStartIndex),
      ...rewrittenSegment,
      ...sidePoints.slice(segmentEndIndex + 1),
    ];
    return {
      sidePoints: rewrittenSidePoints,
      insertedPointIndex: segmentStartIndex + 1,
      insertedPoint,
      referenceEndpointIndex: fromEnd ? segmentStartIndex + 2 : segmentStartIndex,
      referenceEndpoint,
      tangentToEndpoint,
    };
  }

  if (segmentPoints.length !== 4) {
    return synthesizeInsertedPoint();
  }

  const bezier = segmentBezier ?? createBezierFromPoints(segmentPoints);
  const splitT = solveTerminalSplitForDistance(bezier, fromEnd, effectiveTrimDistance);
  const derivative = bezier.derivative(splitT);
  const derivativeDirection = vector.normalizeVector({
    x: derivative.x,
    y: derivative.y,
  });
  if (!isUsableDirection(derivativeDirection)) {
    return synthesizeInsertedPoint();
  }

  const split = bezier.split(splitT);
  const leftPoints = split.left.points.map((point) => ({ x: point.x, y: point.y }));
  const rightPoints = split.right.points.map((point) => ({ x: point.x, y: point.y }));
  let insertedPoint = buildInsertedRoundCapPoint(leftPoints[leftPoints.length - 1]);
  if (vector.distance(insertedPoint, referenceEndpoint) < 1) {
    insertedPoint = buildInsertedRoundCapPoint({
      x: referenceEndpoint.x - fallbackDirection.x,
      y: referenceEndpoint.y - fallbackDirection.y,
    });
  }

  const tangentToEndpoint = fromEnd
    ? derivativeDirection
    : { x: -derivativeDirection.x, y: -derivativeDirection.y };
  // New handles inherit the original segment handles' provenance (first of
  // each pair from the start-adjacent handle, second from the end-adjacent
  // one); the inserted on-curve stands in for the reference endpoint.
  const originalHandle1 = segmentPoints[1];
  const originalHandle2 = segmentPoints[2];
  withRoundCapProvenance(insertedPoint, referenceEndpoint);
  // Keep the segment the trim was cut out of. The curvature gizmo reads its
  // number off the segment as emitted, but the pin it writes is reproduced on
  // the whole untrimmed segment, so on a trimmed terminal the two are talking
  // about different curves and the first drag snaps the shape from one to the
  // other. This is what lets the gizmo measure the curve the pin governs.
  if (insertedPoint._provenance) {
    insertedPoint._provenance.constructionSegment = segmentPoints.map((point) => ({
      x: point.x,
      y: point.y,
    }));
  }
  const rewrittenSegment = [
    cloneRoundCapPoint(startPoint),
    withRoundCapProvenance(
      buildSplitOffCurve(leftPoints[1], originalHandle1),
      originalHandle1
    ),
    withRoundCapProvenance(buildSplitOffCurve(leftPoints[2]), originalHandle2),
    insertedPoint,
    withRoundCapProvenance(buildSplitOffCurve(rightPoints[1]), originalHandle1),
    withRoundCapProvenance(
      buildSplitOffCurve(rightPoints[2], originalHandle2),
      originalHandle2
    ),
    cloneRoundCapPoint(endPoint),
  ];
  const rewrittenSidePoints = [
    ...sidePoints.slice(0, segmentStartIndex),
    ...rewrittenSegment,
    ...sidePoints.slice(segmentEndIndex + 1),
  ];

  return {
    sidePoints: rewrittenSidePoints,
    insertedPointIndex: segmentStartIndex + 3,
    insertedPoint,
    referenceEndpointIndex: fromEnd ? segmentStartIndex + 6 : segmentStartIndex,
    referenceEndpoint,
    tangentToEndpoint,
  };
}

/**
 * Move a terminal split onto an exact point, and re-aim the one handle that
 * survives the trim so the edge still arrives along `intoStroke`.
 *
 * The split itself lands wherever the edge happens to run, which is a function
 * of the edge's shape and therefore of everything that shapes it. A terminal
 * that wants a fixed release cannot take that point; it takes the cut only as a
 * decision about how much curve to keep, then pulls the loose end into place.
 * The handle rotation is what keeps the join smooth: `intoStroke` is the
 * direction the terminal's own straight section leaves in.
 * @param {Object} split - Result of splitTerminalSideForRoundCap
 * @param {Object} target - Where the trimmed edge must end, in glyph space
 * @param {Object} intoStroke - Unit direction away from the terminal
 * @param {string} sidePosition - "start" or "end"
 * @returns {Object} The split, with its inserted point and kept handle moved
 */
function anchorTerminalSplit(split, target, intoStroke, sidePosition) {
  const sidePoints = [...split.sidePoints];
  const insertedIndex = split.insertedPointIndex;
  const insertedPoint = { ...sidePoints[insertedIndex], x: target.x, y: target.y };
  sidePoints[insertedIndex] = insertedPoint;

  // The kept side of the cut is whichever side is not the terminal's own.
  const handleIndex = sidePosition === "end" ? insertedIndex - 1 : insertedIndex + 1;
  const handle = sidePoints[handleIndex];
  if (handle?.type) {
    const length = vector.distance(handle, split.insertedPoint);
    sidePoints[handleIndex] = {
      ...handle,
      x: target.x + intoStroke.x * length,
      y: target.y + intoStroke.y * length,
      _axis: { x: intoStroke.x, y: intoStroke.y },
    };
  }
  return { ...split, sidePoints, insertedPoint };
}

function trimSideForRoundCapEmission(sidePoints, sidePosition, referenceEndpointIndex) {
  const emitted = [...sidePoints];
  emitted.splice(referenceEndpointIndex, 1);
  if (sidePosition === "start") {
    while (emitted.length && emitted[0]?.type) {
      emitted.shift();
    }
  } else if (sidePosition === "end") {
    while (emitted.length && emitted[emitted.length - 1]?.type) {
      emitted.pop();
    }
  }
  return emitted;
}

function buildRoundCapEndpoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
    smooth: true,
    skipColinear: true,
  };
}

function buildRoundCapTipPoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
    smooth: true,
  };
}

function serializeRoundCapDebugPoint(point) {
  if (!point) return null;
  const serialized = {
    x: point.x,
    y: point.y,
  };
  if (point.type !== undefined) serialized.type = point.type;
  if (point.smooth !== undefined) serialized.smooth = point.smooth;
  if (point.skipColinear !== undefined) serialized.skipColinear = point.skipColinear;
  return serialized;
}

function orientDirectionToward(direction, targetVector) {
  if (!isUsableDirection(direction)) {
    return resolveRoundCapFallbackDirection({ endpointTangent: targetVector });
  }
  if (!isUsableDirection(targetVector)) {
    return vector.normalizeVector(direction);
  }
  const normalizedDirection = vector.normalizeVector(direction);
  const normalizedTarget = vector.normalizeVector(targetVector);
  const dot =
    normalizedDirection.x * normalizedTarget.x +
    normalizedDirection.y * normalizedTarget.y;
  return dot >= 0
    ? normalizedDirection
    : { x: -normalizedDirection.x, y: -normalizedDirection.y };
}

function buildRoundCapSegment(
  startPoint,
  startDir,
  endPoint,
  endDir,
  tension,
  debugContext = null,
  debugLabel = null
) {
  const segmentDebugBase = {
    phase: "round-cap-segment",
    label: debugLabel,
    startPoint: serializeRoundCapDebugPoint(startPoint),
    endPoint: serializeRoundCapDebugPoint(endPoint),
    startDir,
    endDir,
    tension,
  };
  if (
    !isUsableDirection(startDir) ||
    !isUsableDirection(endDir) ||
    vector.distance(startPoint, endPoint) < 0.001
  ) {
    logSkeletonDebug(debugContext, {
      ...segmentDebugBase,
      degenerate: true,
      reason: !isUsableDirection(startDir)
        ? "invalid-start-dir"
        : !isUsableDirection(endDir)
          ? "invalid-end-dir"
          : "coincident-points",
    });
    return [cloneRoundCapPoint(endPoint)];
  }

  const handleLengths = computeTunniHandleLengths(
    startPoint,
    startDir,
    endPoint,
    endDir,
    tension
  );
  if (
    !Number.isFinite(handleLengths.startLen) ||
    !Number.isFinite(handleLengths.endLen)
  ) {
    logSkeletonDebug(debugContext, {
      ...segmentDebugBase,
      degenerate: true,
      reason: "invalid-handle-lengths",
      handleLengths,
    });
    return [cloneRoundCapPoint(endPoint)];
  }

  const handleOut = {
    x: Math.round(startPoint.x + startDir.x * handleLengths.startLen),
    y: Math.round(startPoint.y + startDir.y * handleLengths.startLen),
    type: "cubic",
  };
  const handleIn = {
    x: Math.round(endPoint.x + endDir.x * handleLengths.endLen),
    y: Math.round(endPoint.y + endDir.y * handleLengths.endLen),
    type: "cubic",
  };
  const segmentPoints = [handleOut, handleIn, cloneRoundCapPoint(endPoint)];
  logSkeletonDebug(debugContext, {
    ...segmentDebugBase,
    degenerate: false,
    chordLength: vector.distance(startPoint, endPoint),
    handleLengths,
    segmentPoints: segmentPoints.map(serializeRoundCapDebugPoint),
  });
  return segmentPoints;
}

function buildRoundCapGeometry({
  position,
  insertedLeft,
  insertedRight,
  leftTangentToEndpoint,
  rightTangentToEndpoint,
  referenceLeft,
  referenceRight,
  capTangent,
  capTension,
  radiusFactor,
  capWidth,
  preserveCoincidentMaxRadiusEndpoints = false,
  debugContext = null,
}) {
  const referenceSpan = vector.subVectors(referenceLeft, referenceRight);
  const rawCapNormal = vector.normalizeVector(referenceSpan);
  const fallbackCapNormal = vector.normalizeVector(vector.rotateVector90CW(capTangent));
  const canUseRawCapNormal = isUsableDirection(rawCapNormal);
  const canUseFallbackCapNormal = isUsableDirection(fallbackCapNormal);
  const capNormal = canUseRawCapNormal
    ? rawCapNormal
    : canUseFallbackCapNormal
      ? fallbackCapNormal
      : null;

  const normalShift = (capWidth / 2) * radiusFactor;
  const zeroWidthCap = !(capWidth > 0.001);
  let finalEndpoints = null;
  let tipPoint = null;
  let isMergedTip = false;
  let preCollapseRight = null;
  let preCollapseLeft = null;
  let coincidentEndpointAxis = null;

  if (!zeroWidthCap && capNormal) {
    preCollapseRight = buildRoundCapEndpoint({
      x: referenceRight.x + capNormal.x * normalShift,
      y: referenceRight.y + capNormal.y * normalShift,
    });
    preCollapseLeft = buildRoundCapEndpoint({
      x: referenceLeft.x - capNormal.x * normalShift,
      y: referenceLeft.y - capNormal.y * normalShift,
    });

    const coincidentPreCollapseEndpoints =
      vector.distance(preCollapseRight, preCollapseLeft) <= 0.5;
    const shouldKeepCoincidentEndpoints =
      preserveCoincidentMaxRadiusEndpoints && radiusFactor >= 1 - 1e-6;

    if (shouldKeepCoincidentEndpoints) {
      const coincidentEndpoint = buildRoundCapEndpoint({
        x: (preCollapseRight.x + preCollapseLeft.x) / 2,
        y: (preCollapseRight.y + preCollapseLeft.y) / 2,
      });
      coincidentEndpointAxis = vector.normalizeVector(
        vector.subVectors(insertedLeft, insertedRight)
      );
      if (!isUsableDirection(coincidentEndpointAxis) && capNormal) {
        coincidentEndpointAxis = capNormal;
      }
      if (!isUsableDirection(coincidentEndpointAxis) && canUseFallbackCapNormal) {
        coincidentEndpointAxis = fallbackCapNormal;
      }
      finalEndpoints = {
        left: cloneRoundCapPoint(coincidentEndpoint),
        right: cloneRoundCapPoint(coincidentEndpoint),
      };
    } else if (radiusFactor >= 1 - 1e-6 || coincidentPreCollapseEndpoints) {
      isMergedTip = true;
      tipPoint = buildRoundCapTipPoint({
        x: (preCollapseRight.x + preCollapseLeft.x) / 2,
        y: (preCollapseRight.y + preCollapseLeft.y) / 2,
      });
    } else {
      finalEndpoints = {
        left: preCollapseLeft,
        right: preCollapseRight,
      };
    }
  } else {
    isMergedTip = true;
    tipPoint = buildRoundCapTipPoint({
      x: (referenceLeft.x + referenceRight.x) / 2,
      y: (referenceLeft.y + referenceRight.y) / 2,
    });
  }

  const capPoints = [];

  if (isMergedTip) {
    let tipAxis = null;
    if (
      preCollapseLeft &&
      preCollapseRight &&
      vector.distance(preCollapseLeft, preCollapseRight) > 0.001
    ) {
      tipAxis = vector.normalizeVector(
        vector.subVectors(preCollapseRight, preCollapseLeft)
      );
    }
    if (!isUsableDirection(tipAxis) && canUseFallbackCapNormal) {
      tipAxis = fallbackCapNormal;
    }
    if (!isUsableDirection(tipAxis)) {
      tipAxis = vector.normalizeVector(vector.subVectors(insertedLeft, insertedRight));
    }

    const rightTipDir = orientDirectionToward(
      tipAxis,
      vector.subVectors(insertedRight, tipPoint)
    );
    const leftTipDir = orientDirectionToward(
      tipAxis,
      vector.subVectors(insertedLeft, tipPoint)
    );

    if (position === "start") {
      capPoints.push(
        ...buildRoundCapSegment(
          insertedRight,
          rightTangentToEndpoint,
          tipPoint,
          rightTipDir,
          capTension,
          debugContext,
          "start-right-to-tip"
        )
      );
      capPoints.push(
        ...buildRoundCapSegment(
          tipPoint,
          leftTipDir,
          insertedLeft,
          leftTangentToEndpoint,
          capTension,
          debugContext,
          "start-tip-to-left"
        )
      );
    } else {
      capPoints.push(
        ...buildRoundCapSegment(
          insertedLeft,
          leftTangentToEndpoint,
          tipPoint,
          leftTipDir,
          capTension,
          debugContext,
          "end-left-to-tip"
        )
      );
      capPoints.push(
        ...buildRoundCapSegment(
          tipPoint,
          rightTipDir,
          insertedRight,
          rightTangentToEndpoint,
          capTension,
          debugContext,
          "end-tip-to-right"
        )
      );
    }

    logSkeletonDebug(debugContext, {
      phase: "round-cap-geometry",
      position,
      mode: "merged-tip",
      radiusFactor,
      capWidth,
      preserveCoincidentMaxRadiusEndpoints,
      insertedLeft: serializeRoundCapDebugPoint(insertedLeft),
      insertedRight: serializeRoundCapDebugPoint(insertedRight),
      referenceLeft: serializeRoundCapDebugPoint(referenceLeft),
      referenceRight: serializeRoundCapDebugPoint(referenceRight),
      preCollapseLeft: serializeRoundCapDebugPoint(preCollapseLeft),
      preCollapseRight: serializeRoundCapDebugPoint(preCollapseRight),
      capNormal,
      fallbackCapNormal,
      tipAxis,
      tipPoint: serializeRoundCapDebugPoint(tipPoint),
      capPoints: capPoints.map(serializeRoundCapDebugPoint),
    });
    return { capPoints, finalEndpoints, tipPoint, isMergedTip };
  }

  let tipLineDirection = vector.normalizeVector(
    vector.subVectors(finalEndpoints.left, finalEndpoints.right)
  );
  if (
    !isUsableDirection(tipLineDirection) &&
    isUsableDirection(coincidentEndpointAxis)
  ) {
    tipLineDirection = coincidentEndpointAxis;
  }
  if (
    !isUsableDirection(tipLineDirection) &&
    preCollapseLeft &&
    preCollapseRight &&
    vector.distance(preCollapseLeft, preCollapseRight) > 0.001
  ) {
    tipLineDirection = vector.normalizeVector(
      vector.subVectors(preCollapseLeft, preCollapseRight)
    );
  }
  if (!isUsableDirection(tipLineDirection) && canUseFallbackCapNormal) {
    tipLineDirection = fallbackCapNormal;
  }
  if (!isUsableDirection(tipLineDirection)) {
    tipLineDirection = vector.normalizeVector(
      vector.subVectors(insertedLeft, insertedRight)
    );
  }
  const leftTipDir = orientDirectionToward(
    tipLineDirection,
    vector.subVectors(insertedLeft, finalEndpoints.left)
  );
  const rightTipDir = orientDirectionToward(
    { x: -tipLineDirection.x, y: -tipLineDirection.y },
    vector.subVectors(insertedRight, finalEndpoints.right)
  );

  if (position === "start") {
    capPoints.push(
      ...buildRoundCapSegment(
        insertedRight,
        rightTangentToEndpoint,
        finalEndpoints.right,
        rightTipDir,
        capTension,
        debugContext,
        "start-right-to-final-right"
      )
    );
    capPoints.push(cloneRoundCapPoint(finalEndpoints.left));
    capPoints.push(
      ...buildRoundCapSegment(
        finalEndpoints.left,
        leftTipDir,
        insertedLeft,
        leftTangentToEndpoint,
        capTension,
        debugContext,
        "start-final-left-to-left"
      )
    );
  } else {
    capPoints.push(
      ...buildRoundCapSegment(
        insertedLeft,
        leftTangentToEndpoint,
        finalEndpoints.left,
        leftTipDir,
        capTension,
        debugContext,
        "end-left-to-final-left"
      )
    );
    capPoints.push(cloneRoundCapPoint(finalEndpoints.right));
    capPoints.push(
      ...buildRoundCapSegment(
        finalEndpoints.right,
        rightTipDir,
        insertedRight,
        rightTangentToEndpoint,
        capTension,
        debugContext,
        "end-final-right-to-right"
      )
    );
  }

  logSkeletonDebug(debugContext, {
    phase: "round-cap-geometry",
    position,
    mode: "two-endpoint",
    radiusFactor,
    capWidth,
    preserveCoincidentMaxRadiusEndpoints,
    insertedLeft: serializeRoundCapDebugPoint(insertedLeft),
    insertedRight: serializeRoundCapDebugPoint(insertedRight),
    referenceLeft: serializeRoundCapDebugPoint(referenceLeft),
    referenceRight: serializeRoundCapDebugPoint(referenceRight),
    preCollapseLeft: serializeRoundCapDebugPoint(preCollapseLeft),
    preCollapseRight: serializeRoundCapDebugPoint(preCollapseRight),
    finalLeft: serializeRoundCapDebugPoint(finalEndpoints.left),
    finalRight: serializeRoundCapDebugPoint(finalEndpoints.right),
    capNormal,
    fallbackCapNormal,
    tipLineDirection,
    leftTipDir,
    rightTipDir,
    capPoints: capPoints.map(serializeRoundCapDebugPoint),
  });
  return { capPoints, finalEndpoints, tipPoint, isMergedTip };
}

function assembleOpenOutlineWithRoundCaps({ leftSide, endCap, rightSide, startCap }) {
  const outlinePoints = [];
  outlinePoints.push(...leftSide);
  outlinePoints.push(...endCap);
  outlinePoints.push(...[...rightSide].reverse());
  outlinePoints.push(...startCap);
  return outlinePoints;
}

// ---- Drop (ball terminal) caps ---------------------------------------------
// A drop cap continues the OUTER generated edge tangentially into a true
// circle (the "ball"), wraps around it with kappa cubic arcs, then returns to
// the INNER edge through a single concave Tunni cut. The result is asymmetric,
// like the tail terminal of a serif 'a'. The outer side is inferred from the
// terminal segment's curvature (convex side gets the ball) unless capBallSide
// forces it. Neither side outline is trimmed, so all side provenance survives.

function clampCapBallRatio(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CAP_BALL_RATIO;
  }
  return Math.min(Math.max(value, MIN_CAP_BALL_RATIO), MAX_CAP_BALL_RATIO);
}

function clampCapBallShape(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CAP_BALL_SHAPE;
  }
  return Math.min(Math.max(value, 0), MAX_CAP_BALL_SHAPE);
}

// Which side the ball swells toward. Explicit capBallSide wins; otherwise the
// convex (outer) side of the terminal segment's bend. For a CCW-turning
// terminal the convex side is the left generated edge.
function resolveDropCapOuterSide(segment, point, skeletonContour, leftHW, rightHW) {
  const forced = point?.capBallSide ?? skeletonContour?.capBallSide ?? null;
  if (forced === "left" || forced === "right") {
    return forced;
  }
  const tangentStart = getSegmentTangent(segment, "start");
  const tangentEnd = getSegmentTangent(segment, "end");
  const cross = tangentStart.x * tangentEnd.y - tangentStart.y * tangentEnd.x;
  if (Math.abs(cross) > 1e-3) {
    return cross > 0 ? "left" : "right";
  }
  // Straight terminal: bias toward the wider side, defaulting to left.
  return rightHW > leftHW ? "right" : "left";
}

function dropCapOnCurve(coords) {
  return {
    x: Math.round(coords.x),
    y: Math.round(coords.y),
    smooth: true,
    // Protect the circle: the colinearity post-pass must not rotate ball
    // handles (same escape hatch the round cap uses on its endpoints).
    skipColinear: true,
  };
}

function dropCapHandle(coords) {
  return {
    x: Math.round(coords.x),
    y: Math.round(coords.y),
    type: "cubic",
  };
}

// The drop cap's ball, as the unit circle under an affine map:
//
//   p(u, v) = center + ex * a * u + ey * b * v
//
// `ex` runs along the stroke's outward tangent, `ey` from the outer edge toward
// the skeleton. `b` is the lateral radius (how far the ball swells sideways);
// `a` is the along-stroke radius, which capBallShape stretches backward only.
// Because the map is affine, circle arcs emitted in (u, v) space stay exact
// cubics after mapping, and "inside the ball" is a plain unit test on (u, v).
function makeDropCapBall(center, ex, ey, a, b) {
  return {
    center,
    ex,
    ey,
    a,
    b,
    toDevice(u, v) {
      return {
        x: center.x + ex.x * a * u + ey.x * b * v,
        y: center.y + ex.y * a * u + ey.y * b * v,
      };
    },
    at(theta) {
      return this.toDevice(Math.cos(theta), Math.sin(theta));
    },
    tangentAt(theta) {
      const du = -Math.sin(theta);
      const dv = Math.cos(theta);
      return vector.normalizeVector({
        x: ex.x * a * du + ey.x * b * dv,
        y: ex.y * a * du + ey.y * b * dv,
      });
    },
    localOf(point) {
      const d = vector.subVectors(point, center);
      return {
        u: (d.x * ex.x + d.y * ex.y) / a,
        v: (d.x * ey.x + d.y * ey.y) / b,
      };
    },
    thetaOf(point) {
      const { u, v } = this.localOf(point);
      return Math.atan2(v, u);
    },
    // `inflate` scales both axes, used to pull the neck trim further back.
    contains(point, inflate = 1) {
      const { u, v } = this.localOf(point);
      return u * u + v * v < inflate * inflate;
    },
  };
}

// Emit cubic kappa arcs along the ball from thetaStart counter-clockwise to
// thetaEnd (in the ball's own parameter space, thetaEnd > thetaStart). Returns
// points AFTER the starting on-curve (which the caller already has as the
// tangency point); the final point is the on-curve at thetaEnd.
function emitDropCapArc(ball, thetaStart, thetaEnd) {
  const delta = thetaEnd - thetaStart;
  if (!(delta > 1e-6)) {
    return [];
  }
  // Fixed piece count, not one derived from the sweep: the sweep changes
  // continuously as the ball, shape and tension are dragged, and a piece count
  // that steps with it restructures the contour mid-drag (and would break point
  // compatibility between masters). Four pieces keeps every piece under 90°
  // even at a full sweep.
  const pieces = DROP_CAP_ARC_PIECES;
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const points = [];
  let a = thetaStart;
  for (let i = 0; i < pieces; i++) {
    const b = a + step;
    const u0 = Math.cos(a);
    const v0 = Math.sin(a);
    const u1 = Math.cos(b);
    const v1 = Math.sin(b);
    // Unit-space tangents are (-sin, cos); the handles are the kappa offsets.
    points.push(dropCapHandle(ball.toDevice(u0 - k * v0, v0 + k * u0)));
    points.push(dropCapHandle(ball.toDevice(u1 + k * v1, v1 - k * u1)));
    points.push(dropCapOnCurve(ball.toDevice(u1, v1)));
    a = b;
  }
  return points;
}

// Direction of a side outline's terminal segment at the terminal itself, in
// increasing-index order. The neck has to leave the edge along this, otherwise
// the junction is only smooth by accident.
function getSideTerminalTangent(sidePoints, position) {
  const seg = getRoundCapTerminalSegment(sidePoints, position);
  if (!seg) {
    return null;
  }
  const { segmentPoints } = seg;
  if (segmentPoints.length === 4) {
    const derivative = createBezierFromPoints(segmentPoints).derivative(
      position === "end" ? 1 : 0
    );
    const direction = vector.normalizeVector({ x: derivative.x, y: derivative.y });
    if (isUsableDirection(direction)) {
      return direction;
    }
  }
  const chord = vector.subVectors(
    segmentPoints[segmentPoints.length - 1],
    segmentPoints[0]
  );
  return isUsableDirection(chord) ? vector.normalizeVector(chord) : null;
}

function getTerminalSegmentLength(sidePoints, position) {
  const seg = getRoundCapTerminalSegment(sidePoints, position);
  if (!seg) {
    return 0;
  }
  const { segmentPoints } = seg;
  if (segmentPoints.length === 4) {
    return createBezierFromPoints(segmentPoints).length();
  }
  return vector.distance(segmentPoints[0], segmentPoints[segmentPoints.length - 1]);
}

// A side outline's segments, ordered from the terminal backward. Segments that
// are neither a line (2 points) nor a cubic (4 points) are dropped, since the
// crossing search and the rebuild only understand those.
function getSideSegmentsFromTerminal(sidePoints, position) {
  const onCurveIndices = [];
  sidePoints.forEach((point, index) => {
    if (point && !point.type) {
      onCurveIndices.push(index);
    }
  });
  const segments = [];
  for (let i = 0; i + 1 < onCurveIndices.length; i++) {
    const segmentStartIndex = onCurveIndices[i];
    const segmentEndIndex = onCurveIndices[i + 1];
    const segmentPoints = sidePoints.slice(segmentStartIndex, segmentEndIndex + 1);
    if (segmentPoints.length === 2 || segmentPoints.length === 4) {
      segments.push({ segmentStartIndex, segmentEndIndex, segmentPoints });
    }
  }
  return position === "end" ? segments.reverse() : segments;
}

// How far back from the terminal a crossing sits, as a 0..1 fraction of its own
// segment plus the number of whole segments already walked — enough to compare
// two crossings on the same side.
function crossingBackness(crossing) {
  const withinSegment = crossing.fromEnd ? 1 - crossing.tCross : crossing.tCross;
  return crossing.segmentsFromTerminal + withinSegment;
}

// Find where a side outline last crosses the ball boundary, scanning backward
// from the terminal. The REAR-most transition is the one that matters:
// everything forward of it is swallowed by the ball, so that is where the ball
// lifts off the edge and the neck belongs. The walk continues onto earlier
// segments while they stay inside the ball, because an elongated ball easily
// reaches past the terminal segment. Returns the crossing plus everything
// `rebuildTrimmedSide` needs, or null when the ball never meets the side.
function findSideBallCrossing(sidePoints, position, contains) {
  const fromEnd = position === "end";
  const segments = getSideSegmentsFromTerminal(sidePoints, position);
  let segmentsFromTerminal = 0;
  let rearMost = null;
  for (const segment of segments) {
    const { segmentStartIndex, segmentEndIndex, segmentPoints } = segment;
    const isCubic = segmentPoints.length === 4;
    // Only cubic segments go through bezier-js; a linear segment is
    // interpolated directly (bezier-js cannot split an order-1 curve).
    const bezier = isCubic ? createBezierFromPoints(segmentPoints) : null;
    const at = (t) => {
      if (bezier) {
        const p = bezier.get(t);
        return { x: p.x, y: p.y };
      }
      return vector.interpolateVectors(
        segmentPoints[0],
        segmentPoints[segmentPoints.length - 1],
        t
      );
    };
    // s runs backward from this segment's forward end (s = 0) to its far end.
    const toT = (s) => (fromEnd ? 1 - s : s);
    const steps = 128;
    let hit = -1;
    let previousInside = contains(at(toT(0)));
    for (let i = 1; i <= steps; i++) {
      const inside = contains(at(toT(i / steps)));
      if (inside !== previousInside) {
        hit = i;
        previousInside = inside;
      }
    }
    if (hit >= 0) {
      // Bisect inside the last bracket; `insideAtHit` is the state after it.
      const insideAtHit = contains(at(toT(hit / steps)));
      let lo = (hit - 1) / steps;
      let hi = hit / steps;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (contains(at(toT(mid))) === insideAtHit) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      const tCross = toT((lo + hi) / 2);
      // Tangent of the edge at the crossing, in increasing-t order. The neck
      // fillet leaves the edge along this so the junction is genuinely smooth
      // wherever the crossing lands — a fixed direction taken from the ball's
      // own axis only looks right while the edge happens to be parallel to it.
      let crossingTangent = null;
      if (bezier) {
        const derivative = bezier.derivative(tCross);
        crossingTangent = vector.normalizeVector({
          x: derivative.x,
          y: derivative.y,
        });
      }
      if (!isUsableDirection(crossingTangent)) {
        const chord = vector.subVectors(
          segmentPoints[segmentPoints.length - 1],
          segmentPoints[0]
        );
        crossingTangent = isUsableDirection(chord)
          ? vector.normalizeVector(chord)
          : null;
      }
      rearMost = {
        crossing: at(tCross),
        crossingTangent,
        segmentStartIndex,
        segmentEndIndex,
        segmentPoints,
        bezier,
        isCubic,
        tCross,
        fromEnd,
        segmentsFromTerminal,
        provenanceSource: sidePoints[fromEnd ? segmentEndIndex : segmentStartIndex],
      };
    }
    // Keep walking back while the ball still covers this segment's far end —
    // an even further-back transition may sit on an earlier segment.
    const farPoint = fromEnd
      ? segmentPoints[0]
      : segmentPoints[segmentPoints.length - 1];
    if (!contains(farPoint)) {
      break;
    }
    segmentsFromTerminal += 1;
  }
  return rearMost;
}

// Rebuild a side outline trimmed at a crossing (from findSideBallCrossing),
// so its terminal segment stops at the crossing. `smooth` marks the new
// terminal on-curve (true for a filleted neck that meets the ball tangentially,
// false for a hard concave corner).
function rebuildTrimmedSide(sidePoints, crossingInfo, { smooth }) {
  const {
    crossing,
    segmentStartIndex,
    segmentEndIndex,
    segmentPoints,
    bezier,
    isCubic,
    tCross,
    fromEnd,
    provenanceSource,
  } = crossingInfo;
  const crossingOnCurve = withRoundCapProvenance(
    { x: Math.round(crossing.x), y: Math.round(crossing.y), smooth },
    provenanceSource
  );

  let rewrittenSegment;
  if (bezier) {
    const split = bezier.split(tCross);
    const kept = (fromEnd ? split.left : split.right).points.map((p) => ({
      x: p.x,
      y: p.y,
    }));
    if (isCubic) {
      rewrittenSegment = fromEnd
        ? [
            cloneRoundCapPoint(segmentPoints[0]),
            buildSplitOffCurve(kept[1]),
            buildSplitOffCurve(kept[2]),
            crossingOnCurve,
          ]
        : [
            crossingOnCurve,
            buildSplitOffCurve(kept[1]),
            buildSplitOffCurve(kept[2]),
            cloneRoundCapPoint(segmentPoints[segmentPoints.length - 1]),
          ];
    } else {
      rewrittenSegment = fromEnd
        ? [cloneRoundCapPoint(segmentPoints[0]), crossingOnCurve]
        : [
            crossingOnCurve,
            cloneRoundCapPoint(segmentPoints[segmentPoints.length - 1]),
          ];
    }
  } else {
    rewrittenSegment = fromEnd
      ? [cloneRoundCapPoint(segmentPoints[0]), crossingOnCurve]
      : [crossingOnCurve, cloneRoundCapPoint(segmentPoints[segmentPoints.length - 1])];
  }

  // Everything beyond the crossing's segment is swallowed by the ball: when the
  // crossing landed on an earlier segment, those forward segments go away.
  return fromEnd
    ? [...sidePoints.slice(0, segmentStartIndex), ...rewrittenSegment]
    : [...rewrittenSegment, ...sidePoints.slice(segmentEndIndex + 1)];
}

// Place the ball: trim the outer edge back, sit the ball tangent to it there,
// and pick the along-stroke radius so the ball's furthest point along the
// outward tangent lands exactly on the terminal plane — the line through the
// endpoint that a butt cap sits on. That is what keeps a drop cap from
// lengthening the stroke.
//
// On a straight terminal this is trivial (the along-radius is just the trim
// distance). On a curved one the edge tangent has rotated away from the outward
// tangent, so the ball's lateral swell reaches forward too; when that alone
// already breaches the plane, the trim is walked further back until there is
// room. Returns { split, tangency, ball } or null.
function solveDropCapBallOnTerminal({
  outerSideArr,
  position,
  endpoint,
  forward,
  lateralRadius,
  trimDistance,
  maxTrimDistance,
}) {
  let trim = trimDistance;
  let fallback = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const split = splitTerminalSideForRoundCap(outerSideArr, position, trim, {
      endpointTangent: forward,
      capTangent: forward,
    });
    if (!split?.insertedPoint) {
      break;
    }
    const tangency = split.insertedPoint;
    const ex = isUsableDirection(split.tangentToEndpoint)
      ? vector.normalizeVector(split.tangentToEndpoint)
      : forward;
    const ey = orientDirectionToward(
      vector.rotateVector90CW(ex),
      vector.subVectors(endpoint, tangency)
    );
    if (!isUsableDirection(ey)) {
      break;
    }
    const center = {
      x: tangency.x + ey.x * lateralRadius,
      y: tangency.y + ey.y * lateralRadius,
    };
    const alongComponent = ex.x * forward.x + ex.y * forward.y;
    const lateralComponent = lateralRadius * (ey.x * forward.x + ey.y * forward.y);
    // How far the center sits behind the terminal plane, along the tangent.
    const room =
      (endpoint.x - center.x) * forward.x + (endpoint.y - center.y) * forward.y;
    const makeResult = (a) => ({
      split,
      tangency,
      ball: makeDropCapBall(center, ex, ey, Math.max(a, 1), lateralRadius),
    });
    if (Math.abs(alongComponent) > 0.2 && room > Math.abs(lateralComponent) + 0.5) {
      // Ball extreme along `forward` is hypot(a * alongComponent,
      // lateralComponent) from the center; pin it to `room`.
      const along =
        Math.sqrt(room * room - lateralComponent * lateralComponent) /
        Math.abs(alongComponent);
      return makeResult(along);
    }
    fallback = fallback ?? makeResult(trim);
    const nextTrim = Math.min(
      trim + Math.abs(lateralComponent) - room + lateralRadius * 0.5 + 2,
      maxTrimDistance
    );
    if (!(nextTrim > trim + 0.5)) {
      break;
    }
    trim = nextTrim;
  }
  return fallback;
}

// Build a drop cap.
//
// The outer edge is trimmed back by the ball's along-stroke radius and flows
// tangentially into the ball there, so the ball's forward extreme lands on the
// terminal itself — a drop cap reaches exactly as far as a butt or round cap
// does and never lengthens the stroke. The inner side is trimmed where the ball
// crosses it, forming the concave neck. Returns { leftSide, rightSide,
// capPoints } with both sides possibly trimmed, or null to fall through.
function buildDropCap({
  position,
  outerSide,
  endpoint,
  outwardTangent,
  leftSide,
  rightSide,
  capWidth,
  capBallRatio,
  capBallShape,
  capTension,
}) {
  const forward = vector.normalizeVector(outwardTangent);
  if (!endpoint || !(capWidth > 0.001) || !isUsableDirection(forward)) {
    return null;
  }
  const lateralRadius = (clampCapBallRatio(capBallRatio) * capWidth) / 2;
  if (!(lateralRadius > 0.001)) {
    return null;
  }
  const outerSideArr = outerSide === "left" ? leftSide : rightSide;
  const innerSideArr = outerSide === "left" ? rightSide : leftSide;

  // capBallShape stretches the ball backward along the stroke only: it sets how
  // far back along the outer edge the ball attaches. The trim has to stay on
  // the outer side's terminal segment, so a short terminal segment caps how
  // elongated the ball can get.
  const shape = clampCapBallShape(capBallShape);
  const outerTerminalLength = getTerminalSegmentLength(outerSideArr, position);
  const trimDistance = Math.min(
    lateralRadius * (1 + shape * BALL_SHAPE_ELONGATION),
    Math.max(outerTerminalLength * 0.95, 1)
  );

  // Trim the outer edge back by the along-stroke radius; the ball is tangent to
  // the edge at the inserted point and its tip lands back on the terminal.
  const solved = solveDropCapBallOnTerminal({
    outerSideArr,
    position,
    endpoint,
    forward,
    lateralRadius,
    trimDistance,
    maxTrimDistance: Math.max(outerTerminalLength * 0.95, 1),
  });
  if (!solved) {
    return null;
  }
  const { split, tangency, ball } = solved;
  const ex = ball.ex;
  // The tangency is a genuine smooth junction; keep the colinearity post-pass
  // from rotating the ball's first handle away from it.
  tangency.skipColinear = true;
  const trimmedOuterSide = trimSideForRoundCapEmission(
    split.sidePoints,
    position,
    split.referenceEndpointIndex
  );

  const tension = Math.min(
    Math.max(Number.isFinite(capTension) ? capTension : 0, 0),
    MAX_CAP_TENSION_DROP
  );

  // Where the ball meets the inner edge (the arc ends there). When the ball is
  // too small to reach the inner edge, bridge to the inner terminal instead.
  const ballCross = findSideBallCrossing(innerSideArr, position, (point) =>
    ball.contains(point)
  );

  // With tension, pull the inner trim back by growing the trim ball: the stroke
  // edge peels away earlier and eases into the ball, softening the notch into a
  // concave neck. Back off the inflation until the grown ball still yields a
  // crossing genuinely behind the plain one — a ball so large that the rear
  // crossing runs off the side would otherwise report the forward crossing
  // instead, which folds the neck back over the stroke.
  let softCross = null;
  let inflate = 1;
  if (ballCross && tension > 0.01) {
    for (let s = 1 + tension * NECK_PULLBACK_FACTOR; s > 1.02; s = 1 + (s - 1) * 0.65) {
      const candidate = findSideBallCrossing(innerSideArr, position, (point) =>
        ball.contains(point, s)
      );
      if (candidate && crossingBackness(candidate) > crossingBackness(ballCross)) {
        softCross = candidate;
        inflate = s;
        break;
      }
    }
  }

  let trimmedInnerSide;
  let thetaInner;
  let mode;
  let innerTrim = null;
  if (softCross) {
    trimmedInnerSide = rebuildTrimmedSide(innerSideArr, softCross, { smooth: true });
    innerTrim = softCross.crossing;
    thetaInner = ball.thetaOf(ballCross.crossing);
    mode = "soft";
  } else if (ballCross) {
    trimmedInnerSide = rebuildTrimmedSide(innerSideArr, ballCross, { smooth: false });
    thetaInner = ball.thetaOf(ballCross.crossing);
    mode = "corner";
  } else {
    trimmedInnerSide = innerSideArr;
    const innerTerminal =
      position === "start"
        ? getFirstOnCurvePoint(innerSideArr)
        : getLastOnCurvePoint(innerSideArr);
    if (!innerTerminal) {
      return null;
    }
    thetaInner = ball.thetaOf(innerTerminal);
    mode = "bridge";
  }

  // The tangency sits at theta = -pi/2 by construction (it is the ball's
  // extreme along -ey). Sweep counter-clockwise from there, around the forward
  // tip at theta = 0, to the inner attachment — no heuristic needed, because
  // the inner side always lies on the +ey half.
  const thetaOuter = -Math.PI / 2;
  const twoPi = Math.PI * 2;
  while (thetaInner <= thetaOuter + 1e-6) {
    thetaInner += twoPi;
  }
  while (thetaInner > thetaOuter + twoPi) {
    thetaInner -= twoPi;
  }
  const sweep = thetaInner - thetaOuter;

  // For a soft neck, back the ball attachment off along the arc as well (not
  // just the inner trim back along the edge). Ending the arc before the corner
  // means the fillet cuts across it and eases in from above the edge, instead
  // of continuing the arc's tangent and overshooting below it into a dip. The
  // absolute cap keeps a very soft neck from eating the ball itself: past it
  // the extra tension only reaches further back along the edge.
  const backoff =
    mode === "soft" ? Math.min(inflate - 1, 0.35 * sweep, MAX_NECK_ARC_BACKOFF) : 0;
  const thetaArcEnd = thetaInner - backoff;
  const arc = emitDropCapArc(ball, thetaOuter, thetaArcEnd);

  // Points strictly between the outer tangency and the inner terminal, in the
  // outer -> inner traversal direction.
  let capForwardToInner;
  if (mode === "soft") {
    // Concave neck: the arc ends at the backed-off ball attachment (smooth);
    // one cubic eases from there into the pulled-back inner trim — tangent to
    // the ball at the ball end (continuing the sweep) and along the stroke edge
    // at the inner end.
    const ballAttach = ball.at(thetaArcEnd);
    const sweepTangent = ball.tangentAt(thetaArcEnd);
    const innerTangent = orientDirectionToward(
      softCross.crossingTangent ?? ex,
      vector.subVectors(ballAttach, innerTrim)
    );
    const chord = vector.distance(ballAttach, innerTrim);
    const handleLen = NECK_HANDLE_FRACTION * chord;
    capForwardToInner = [
      ...arc,
      dropCapHandle({
        x: ballAttach.x + sweepTangent.x * handleLen,
        y: ballAttach.y + sweepTangent.y * handleLen,
      }),
      dropCapHandle({
        x: innerTrim.x + innerTangent.x * handleLen,
        y: innerTrim.y + innerTangent.y * handleLen,
      }),
    ];
  } else if (mode === "bridge") {
    // Small ball: connect the last arc on-curve to the inner terminal with a
    // short concave neck cubic, scaled by tension.
    const neckPoint = ball.at(thetaInner);
    const innerTerminal =
      position === "start"
        ? getFirstOnCurvePoint(innerSideArr)
        : getLastOnCurvePoint(innerSideArr);
    const chord = vector.distance(neckPoint, innerTerminal);
    const ballTangent = orientDirectionToward(
      ball.tangentAt(thetaInner),
      vector.subVectors(innerTerminal, neckPoint)
    );
    const innerTangent = orientDirectionToward(
      getSideTerminalTangent(innerSideArr, position) ?? ex,
      vector.subVectors(neckPoint, innerTerminal)
    );
    const neckLengths = computeTunniHandleLengths(
      neckPoint,
      ballTangent,
      innerTerminal,
      innerTangent,
      Math.max(tension, 0.2)
    );
    const clampNeckLen = (value) =>
      Math.min(Math.max(Number.isFinite(value) ? value : 0.4 * chord, 0), 0.6 * chord);
    capForwardToInner = [
      ...arc,
      dropCapHandle({
        x: neckPoint.x + ballTangent.x * clampNeckLen(neckLengths.startLen),
        y: neckPoint.y + ballTangent.y * clampNeckLen(neckLengths.startLen),
      }),
      dropCapHandle({
        x: innerTerminal.x + innerTangent.x * clampNeckLen(neckLengths.endLen),
        y: innerTerminal.y + innerTangent.y * clampNeckLen(neckLengths.endLen),
      }),
    ];
  } else {
    // Hard corner: the trimmed inner side already provides the crossing
    // on-curve, so drop the arc's terminal on-curve to avoid duplicating it.
    capForwardToInner = arc.slice(0, -1);
  }

  const fromSide = position === "end" ? "left" : "right";
  const capPoints =
    outerSide === fromSide ? capForwardToInner : capForwardToInner.slice().reverse();

  return {
    leftSide: outerSide === "left" ? trimmedOuterSide : trimmedInnerSide,
    rightSide: outerSide === "left" ? trimmedInnerSide : trimmedOuterSide,
    capPoints,
  };
}

// Exported because the parameter panel has to park an untouched slider on the
// value the generator is actually drawing with. A stored null means "inherit",
// so a fresh serif has no number of its own on any of these; a slider that
// parked at its own minimum instead would claim a shape nobody is looking at,
// and the first touch of the thumb would jump the terminal.
export const SERIF_HALF_DEFAULTS = Object.freeze({
  wingLength: 0,
  tipThickness: 0,
  wingSlope: 0,
  tipCutAngle: 0,
  reach: 0,
  // A fresh serif should read as a serif, so the transition starts as a real
  // bracket rather than a straight bevel. Both are dimensionless, so they need
  // no unit scaling.
  tension: 0.7,
  concavity: 0.8,
  easeDistance: 0,
  easeCurvature: 0.5,
});

const SERIF_LENGTH_FIELDS = new Set([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "reach",
  "easeDistance",
]);

function resolveSerifHalf(pointSerif, contourSerif, side, context = {}) {
  const scale = context.unitsMode === "normalized" ? context.strokeWidth : 1;
  const resolved = {};
  for (const field of Object.keys(SERIF_HALF_DEFAULTS)) {
    const value =
      pointSerif?.[side]?.[field] ??
      contourSerif?.[side]?.[field] ??
      SERIF_HALF_DEFAULTS[field];
    resolved[field] = SERIF_LENGTH_FIELDS.has(field) ? value * scale : value;
  }
  return resolved;
}

function buildSerifCap({
  position,
  endpoint,
  tangent,
  normal,
  leftSide,
  rightSide,
  leftHalfWidth,
  rightHalfWidth,
  pointSerif,
  contourSerif,
  ownerPoint,
  serifUnitsMode,
}) {
  const outward = vector.normalizeVector(tangent);
  if (!isUsableDirection(outward)) return null;
  const frame = computeSerifFrame({
    endpoint,
    tangent: outward,
    normal,
    axisMode: pointSerif?.axisMode ?? contourSerif?.axisMode ?? "perpendicular",
    axisAngle: pointSerif?.axisAngle ?? contourSerif?.axisAngle ?? 0,
  });
  const leftRibEnd = {
    x: endpoint.x + normal.x * leftHalfWidth,
    y: endpoint.y + normal.y * leftHalfWidth,
  };
  const rightRibEnd = {
    x: endpoint.x - normal.x * rightHalfWidth,
    y: endpoint.y - normal.y * rightHalfWidth,
  };
  const unitsContext = {
    unitsMode: serifUnitsMode,
    strokeWidth: leftHalfWidth + rightHalfWidth,
  };
  const lengthScale =
    unitsContext.unitsMode === "normalized" ? unitsContext.strokeWidth : 1;
  const left = resolveSerifHalf(pointSerif, contourSerif, "left", unitsContext);
  const right = resolveSerifHalf(pointSerif, contourSerif, "right", unitsContext);
  // A terminal may only consume its own segment. Clamp before constructing the
  // serif as well as before splitting the outline, otherwise the splice stays
  // local while the emitted straight section still reaches into the next one.
  const clampTerminalDepth = (side, half) => {
    const available = getTerminalSegmentLength(side, position) * 0.95;
    const room = Math.max(available - (half.tipThickness + half.wingSlope), 0);
    const wantedReach = Math.max(half.reach, 0);
    const reach = Math.min(wantedReach, room);
    const wantedEase = Math.max(half.easeDistance, 0);
    const easeDistance = Math.min(wantedEase, Math.max(room - reach, 0));
    return {
      half: { ...half, reach, easeDistance },
      clamped: wantedReach > reach || wantedEase > easeDistance,
    };
  };
  const leftDepth = clampTerminalDepth(leftSide, left);
  const rightDepth = clampTerminalDepth(rightSide, right);
  const terminalArgs = {
    frame,
    leftFlankU: frame.toFrame(leftRibEnd).u,
    rightFlankU: frame.toFrame(rightRibEnd).u,
    left: leftDepth.half,
    right: rightDepth.half,
    undersideCup:
      (pointSerif?.undersideCup ?? contourSerif?.undersideCup ?? 0) * lengthScale,
  };
  const terminal = buildSerifTerminal(terminalArgs);
  // The serif releases the stroke at a point of its own choosing, on the flank
  // line, and the edge is brought to that point rather than the reverse. Cutting
  // the edge and taking whatever point falls out would hand the serif a release
  // that moves whenever the edge is reshaped - and a curvature pin reshapes the
  // edge, so dragging one would walk two on-curves along the stroke. The cut only
  // decides how much curve to keep; the handle that survives it absorbs the rest.
  const releaseSide = (side, ribEnd, half) => {
    const release = frame.toGlyph(half.release);
    const split = splitTerminalSideForRoundCap(
      side,
      position,
      vector.distance(ribEnd, release),
      { endpointTangent: outward, capTangent: outward }
    );
    return split ? anchorTerminalSplit(split, release, frame.depth, position) : null;
  };
  const leftSplit = releaseSide(leftSide, leftRibEnd, terminal.halves.left);
  const rightSplit = releaseSide(rightSide, rightRibEnd, terminal.halves.right);
  if (!leftSplit || !rightSplit) return null;
  const capPoints =
    position === "end" ? terminal.points : [...terminal.points].reverse();
  for (const point of capPoints) withRoundCapProvenance(point, ownerPoint);
  return {
    leftSide: trimSideForRoundCapEmission(
      leftSplit.sidePoints,
      position,
      leftSplit.referenceEndpointIndex
    ),
    rightSide: trimSideForRoundCapEmission(
      rightSplit.sidePoints,
      position,
      rightSplit.referenceEndpointIndex
    ),
    capPoints,
    depthClamped: leftDepth.clamped || rightDepth.clamped,
  };
}

function generateCap(
  point,
  segment,
  width,
  capStyle,
  position,
  leftHalfWidth = null,
  rightHalfWidth = null,
  capAngle = DEFAULT_CAP_ANGLE
) {
  const halfWidth = width / 2;
  const leftHW = leftHalfWidth ?? halfWidth;
  const rightHW = rightHalfWidth ?? halfWidth;
  // For round caps, use average half-width for the tip point
  const avgHW = (leftHW + rightHW) / 2;
  const capPoints = [];

  // Determine direction at this endpoint
  let direction;
  if (position === "start") {
    direction = vector.normalizeVector(
      vector.subVectors(segment.endPoint, segment.startPoint)
    );
  } else {
    direction = vector.normalizeVector(
      vector.subVectors(segment.endPoint, segment.startPoint)
    );
  }

  const normal = vector.rotateVector90CW(direction);
  const capTangent =
    position === "start" ? { x: -direction.x, y: -direction.y } : direction;

  if (capStyle === "round") {
    // Semicircular cap using cubic bezier approximation
    // Use per-point widths for left/right sides
    const kappa = 0.5522847498; // Bezier circle approximation constant

    if (position === "end") {
      // Arc from right side to left side (going "forward")
      const rightPoint = {
        x: point.x - normal.x * rightHW,
        y: point.y - normal.y * rightHW,
      };
      const leftPoint = {
        x: point.x + normal.x * leftHW,
        y: point.y + normal.y * leftHW,
      };
      const tipPoint = {
        x: point.x + direction.x * avgHW,
        y: point.y + direction.y * avgHW,
      };

      // Control points for quarter arcs
      capPoints.push({
        x: rightPoint.x + direction.x * rightHW * kappa,
        y: rightPoint.y + direction.y * rightHW * kappa,
        type: "cubic",
      });
      capPoints.push({
        x: tipPoint.x - normal.x * rightHW * kappa,
        y: tipPoint.y - normal.y * rightHW * kappa,
        type: "cubic",
      });
      capPoints.push(tipPoint);
      capPoints.push({
        x: tipPoint.x + normal.x * leftHW * kappa,
        y: tipPoint.y + normal.y * leftHW * kappa,
        type: "cubic",
      });
      capPoints.push({
        x: leftPoint.x + direction.x * leftHW * kappa,
        y: leftPoint.y + direction.y * leftHW * kappa,
        type: "cubic",
      });
    } else {
      // Start cap - arc from left to right (going "backward")
      const rightPoint = {
        x: point.x - normal.x * rightHW,
        y: point.y - normal.y * rightHW,
      };
      const leftPoint = {
        x: point.x + normal.x * leftHW,
        y: point.y + normal.y * leftHW,
      };
      const tipPoint = {
        x: point.x - direction.x * avgHW,
        y: point.y - direction.y * avgHW,
      };

      capPoints.push({
        x: leftPoint.x - direction.x * leftHW * kappa,
        y: leftPoint.y - direction.y * leftHW * kappa,
        type: "cubic",
      });
      capPoints.push({
        x: tipPoint.x + normal.x * leftHW * kappa,
        y: tipPoint.y + normal.y * leftHW * kappa,
        type: "cubic",
      });
      capPoints.push(tipPoint);
      capPoints.push({
        x: tipPoint.x - normal.x * rightHW * kappa,
        y: tipPoint.y - normal.y * rightHW * kappa,
        type: "cubic",
      });
      capPoints.push({
        x: rightPoint.x - direction.x * rightHW * kappa,
        y: rightPoint.y - direction.y * rightHW * kappa,
        type: "cubic",
      });
    }
  } else if (capStyle === "square") {
    // Square cap - extend by per-point half-widths, with optional angle
    const capWidth = leftHW + rightHW;
    const clampedAngle = Math.max(-89.9, Math.min(89.9, capAngle ?? 0));
    const angleRad = (clampedAngle * Math.PI) / 180;
    const angleShift = (capWidth * Math.tan(angleRad)) / 2;
    const leftShift = avgHW + angleShift;
    const rightShift = avgHW - angleShift;

    capPoints.push({
      x: point.x - normal.x * rightHW + capTangent.x * rightShift,
      y: point.y - normal.y * rightHW + capTangent.y * rightShift,
    });
    capPoints.push({
      x: point.x + normal.x * leftHW + capTangent.x * leftShift,
      y: point.y + normal.y * leftHW + capTangent.y * leftShift,
    });
  }
  // "butt" style needs no extra points

  return capPoints;
}

/**
 * Convert generated outline contour to packed contour format.
 */
export function outlineContourToPackedPath(outlineContour) {
  return packContour(outlineContour);
}
