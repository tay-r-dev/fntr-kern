import { Bezier } from "bezier-js";
import { buildHandleDomain } from "./natural-handle-solver.js";
import { offsetContourAlongNormals } from "./offset-contour.js";
import { offsetCubicSide } from "./offset-cubic.js";
import {
  buildSerifTerminal,
  computeSerifFrame,
  makeSerifWall,
} from "./serif-geometry.js";
import {
  CAP_POINT_FIELDS,
  DEFAULT_CORNER_CURVATURE,
  DEFAULT_SKELETON_WIDTH,
  SERIF_HALF_ZEROS,
  calculateNormalAtSkeletonPoint,
  collectSerifTerminals,
  collectTiedRibGroups,
  getEffectiveNormal,
  getEffectiveRibHalfWidth,
  isStraightControlledSmoothPoint,
  ribAngleLockReach,
  meanHalfWidth,
  normalizeSkeletonData,
  straightSegmentNormal,
} from "./skeleton-model.js";
import { shiftTensionsToMean } from "./tunni-calculations.js";
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
// Drop-cap easing: how far back along the inner edge the neck starts, as a
// fraction of the run from the plain ball crossing to the next on-curve behind
// it. 0 is the hard corner, 1 collapses the neck's far end onto that on-curve.
// A fraction rather than a length, so the geometry's stop and the panel's top of
// range are one fact and the neck can never eat an on-curve.
const DEFAULT_CAP_BALL_EASING = 0;
// The eased neck's own curvature, in the curvature gizmo's unit: 1 puts both
// handles on the tangent intersection. The gizmo writes it per point; this is
// what an unset bulb draws.
const DEFAULT_CAP_BALL_EASE_CURVATURE = 0.55;
// Fallback neck handle length as a fraction of the neck chord, used only where
// the two tangents give no intersection to measure against.
const NECK_HANDLE_FRACTION = 0.45;
// How far (radians of ball sweep) the neck may back the ball attachment off.
const MAX_NECK_ARC_BACKOFF = 0.6;
// Cubic pieces the ball arc is always emitted in, whatever the sweep.
const DROP_CAP_ARC_PIECES = 4;
// The shortest cut the ball may sit on. A round cap keeps a unit for the same
// reason: the ball reads its own frame off the piece the cut leaves behind.
const MIN_BALL_TRIM = 1;
// Divisor floor for the terminal pin. It keeps the arithmetic finite where the
// outer edge has turned square to the outward tangent. It is not a limit on the
// answer, because the search never asks for a radius the shape did not request.
const MIN_BALL_EDGE_ALIGNMENT = 1e-3;
// Fixed cost of the cut search: a scan for the bracket, then a bisection inside
// it. Fixed, because a convergence test would make the answer a step function of
// where the test happens to trip.
const DROP_CAP_TRIM_SCAN_STEPS = 24;
const DROP_CAP_TRIM_BISECTION_STEPS = 14;
// A corner trim may run the whole way to the neighbouring on-curve. Two corners
// sharing one segment are held apart by the pairwise limiter below, which is
// what a fixed per-corner fraction used to stand in for.
const MAX_HANDLE_TRIM_RATIO = 0.99;

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
  // The mode rides with the lock. Like every other field here it has to be
  // copied across the dialect explicitly, or the geometry reads undefined and
  // falls back to a default the point never asked for.
  generatorPoint.ribAngleLockMode = point.ribAngleLockMode ?? "stroke";
  // Serif parameters travel as one object. Like ribAngleLock, they have to be
  // copied across explicitly: the generator never sees the canonical shape, and
  // a field that is not copied here fails silently rather than throwing.
  generatorPoint.serif = point.serif ?? null;
  // The corner block travels whole, like the serif's. A new field inside it
  // therefore arrives without a copy line — which is not true of a flat field.
  generatorPoint.corner = point.corner ?? null;
  // Three independent locks per side; see SKELETON_LOCK_KINDS in skeleton-model.
  for (const side of ["left", "right"]) {
    for (const kind of ["handles", "slide", "width"]) {
      const name = `${side}Locked${kind[0].toUpperCase()}${kind.slice(1)}`;
      generatorPoint[name] = point.locked?.[side]?.[kind] === true;
    }
  }
  // The pinned segment tension for the segment STARTING here, per side. Null
  // where the segment is unpinned, which is not the same as zero.
  generatorPoint.leftSegmentCurvature = point.segmentCurvature?.left ?? null;
  generatorPoint.rightSegmentCurvature = point.segmentCurvature?.right ?? null;
  for (const field of ["capStyle", "capBallSide", ...CAP_POINT_FIELDS]) {
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

// The corner numbers for one side of the stroke. Resolved at emission, where
// the side is known, so the rounding pass reads one pair per point and never
// asks which side it is working on.
function getCornerSide(point, side) {
  const corner = point?.corner;
  const values = side === "right" ? corner?.right : corner?.left;
  const distance = Math.max(0, Number.isFinite(values?.distance) ? values.distance : 0);
  const curvature = Number.isFinite(values?.curvature)
    ? Math.min(Math.max(values.curvature, 0), 1)
    : DEFAULT_CORNER_CURVATURE;
  return { distance, curvature };
}

// Forward provenance for a generated point: which skeleton point/side/role it
// was emitted for. Attached at emission, carried through the post-processing
// stages (which spread or mutate points in place), collected into the
// generated[].pointMap and stripped from the output points. Points that get
// replaced by later stages (corner rounding, caps) simply lose provenance and
// fall back to the side-less annotator — they are not editable targets.
function pointProvenance(sourcePoint, side, role, nudge = null, arm = null) {
  if (!sourcePoint?._sourcePointId || (side !== "left" && side !== "right")) {
    return undefined;
  }
  const provenance = { skeletonPointId: sourcePoint._sourcePointId, side, role };
  if (arm) {
    // Two on-curves of one side of one skeleton point, one per arm. Without
    // this they say exactly the same thing and no reader can name one of them.
    provenance.arm = arm;
  }
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
  constructionAnchor = null,
  arm = null
) {
  const generatedPoint = {
    x: basePoint.x,
    y: basePoint.y,
    smooth,
  };
  const provenance = pointProvenance(skeletonPoint, side, "onCurve", nudge, arm);
  if (provenance) {
    generatedPoint._provenance = provenance;
  }
  if (provenance?.nudge && constructionAnchor) {
    generatedPoint._constructionAnchor = {
      x: constructionAnchor.x,
      y: constructionAnchor.y,
    };
  }
  const { distance, curvature } = getCornerSide(skeletonPoint, side);
  // A collapsed side lies on the skeleton exactly, and rounding it would pull
  // that edge off the line the designer drew.
  const cornerRoundBase = Math.max(0, cornerRoundBaseOverride ?? halfWidth ?? 0);
  if (distance > 0 && cornerRoundBase >= 0.5) {
    generatedPoint.cornerDistance = distance;
    generatedPoint.cornerCurvature = curvature;
  }
  return generatedPoint;
}

function stripCornerRoundMetadata(points) {
  return points.map((point) => {
    if (!point || point.type) {
      return point;
    }
    if (point.cornerDistance === undefined && point.cornerCurvature === undefined) {
      return point;
    }
    const {
      cornerDistance: _cornerDistance,
      cornerCurvature: _cornerCurvature,
      ...rest
    } = point;
    return rest;
  });
}

// Two kinds of point draw nothing, and the option drops both. An on-curve that
// landed on the on-curve before it, with the handles between them. And a curve
// segment whose two handles each sit on their own on-curve: a straight line by
// geometry, still stored as a curve.
export function removeCollapsedOutlinePoints(points, tolerance = 0.5) {
  return removeStraightSegmentHandles(
    removeCoincidentOnCurves(points, tolerance),
    tolerance
  );
}

// The segment is scanned around the end of the array because the outline is
// closed: the last on-curve and the first one bound a segment like any other.
function removeStraightSegmentHandles(points, tolerance) {
  if (points.length < 4) {
    return points;
  }
  const isNear = (one, other) =>
    Math.abs(one.x - other.x) <= tolerance && Math.abs(one.y - other.y) <= tolerance;
  // On the line the two on-curves span, whatever it does along that line. A
  // handle sitting on its own on-curve is one case of this; the underside cup
  // at zero is another, and it puts its controls a third of the way along.
  // Past an end the curve doubles back before it arrives, and still draws the
  // same straight line.
  const isOnChord = (handle, start, end) => {
    const spanX = end.x - start.x;
    const spanY = end.y - start.y;
    const lengthSquared = spanX * spanX + spanY * spanY;
    if (lengthSquared === 0) {
      return isNear(handle, start);
    }
    const cross = (handle.x - start.x) * spanY - (handle.y - start.y) * spanX;
    return Math.abs(cross) / Math.sqrt(lengthSquared) <= tolerance;
  };
  const dropped = new Set();
  for (let index = 0; index < points.length; index++) {
    const [start, first, second, end] = [0, 1, 2, 3].map(
      (step) => points[(index + step) % points.length]
    );
    if (start.type || !first.type || !second.type || end.type) {
      continue;
    }
    // Both ends, or neither. One handle off the line still bends the segment,
    // and dropping it would change the shape rather than simplify it.
    if (!isOnChord(first, start, end) || !isOnChord(second, start, end)) {
      continue;
    }
    dropped.add((index + 1) % points.length);
    dropped.add((index + 2) % points.length);
  }
  return points.filter((point, index) => !dropped.has(index));
}

function removeCoincidentOnCurves(points, tolerance) {
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

  // A slide-locked side keeps its stored nudge but does not apply it.
  const lockedKey = side === "left" ? "leftLockedSlide" : "rightLockedSlide";
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
  // A handle lock keeps the handles where the designer put them, so the stored
  // nudge is applied here exactly as on an unlocked side. What the lock blocks
  // is the writing of a new one.
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
  // A handle lock preserves the authored curvature, so the stored offsets are
  // applied here as on any other side. The lock is enforced where handles are
  // written, not where they are read.
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
    // No floor: the hand that placed this handle outranks the generator's own
    // shortest length, and zero is a legal setting.
    const clamped =
      Math.min(Math.max(requested / domain.startReach, 0), domain.maxStartTension) *
      domain.startReach;
    points[index] = {
      ...point,
      x: Math.round(anchor.x + axis.x * clamped),
      y: Math.round(anchor.y + axis.y * clamped),
      _provenance: authoredProvenance,
    };
  }
  return points;
}

// A pin states what a segment's tension is, and the segment it states it about
// is the one on screen. On a serifed terminal that is the piece left after the
// trim, not the curve the generator solved, so the pin is applied here — after
// the splice, alongside the two handle adjustments that already wait for it.
// Applying it before the cut would let a pin reshape the wall the serif's own
// release is found on, and walk the terminal up and down the stem.
function applySerifPinnedCurvature(sidePoints, side, authoredKeys, pins) {
  if (!authoredKeys?.size || !pins?.size) return sidePoints;
  const points = [...sidePoints];
  const isOffCurve = (point) => !!point?.type;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  for (let index = 0; index + 3 < points.length; index++) {
    const anchor = points[index];
    const handle1 = points[index + 1];
    const handle2 = points[index + 2];
    const far = points[index + 3];
    if (isOffCurve(anchor) || isOffCurve(far)) continue;
    if (!isOffCurve(handle1) || !isOffCurve(handle2)) continue;
    // A pin is keyed on its segment's START point, and the handle leaving that
    // point is the one the key names. Read the owner off the handle rather than
    // the anchor: the side arrays run one way for a start terminal and the other
    // for an end one, so only the handle's own provenance is direction-free.
    const owner = handle1._provenance?.skeletonPointId;
    const role = handle1._provenance?.role;
    if (owner === undefined || !role) continue;
    if (!authoredKeys.has(`${owner}/${side}/${role}`)) continue;
    const pin = pins.get(`${owner}/${side}`);
    if (!Number.isFinite(pin)) continue;
    const axis1 = handle1._axis;
    const axis2 = handle2._axis;
    if (!axis1 || !axis2) continue;
    const domain = buildHandleDomain(anchor, far, axis1, axis2);
    if (!(domain.startReach > 0) || !(domain.endReach > 0)) continue;
    // The gizmo measures each handle against its own true tangent intersection,
    // and the domain's reach is a stable coordinate scale rather than that
    // intersection. So rescale onto the ceiling, shift there, and rescale back —
    // the same three steps the pre-splice path takes, for the same reason.
    const shifted = shiftTensionsToMean(
      {
        start:
          vector.distance(anchor, handle1) / domain.startReach / domain.maxStartTension,
        end: vector.distance(far, handle2) / domain.endReach / domain.maxEndTension,
      },
      pin,
      1
    );
    // No floor: a pin is the gizmo's own statement about this segment, and it
    // may take either handle all the way down.
    const startLength =
      clamp(shifted.start * domain.maxStartTension, 0, domain.maxStartTension) *
      domain.startReach;
    const endLength =
      clamp(shifted.end * domain.maxEndTension, 0, domain.maxEndTension) *
      domain.endReach;
    points[index + 1] = {
      ...handle1,
      x: Math.round(anchor.x + axis1.x * startLength),
      y: Math.round(anchor.y + axis1.y * startLength),
    };
    points[index + 2] = {
      ...handle2,
      x: Math.round(far.x + axis2.x * endLength),
      y: Math.round(far.y + axis2.y * endLength),
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

// An inner corner's two on-curves stand at the two arms' edge ends, which is the
// only place two adjacent on-curves name one skeleton point and one side.
function isInnerCornerPair(first, second) {
  return (
    !!first &&
    !!second &&
    !first.type &&
    !second.type &&
    first._provenance?.arm === "in" &&
    second._provenance?.arm === "out" &&
    first._provenance?.skeletonPointId === second._provenance?.skeletonPointId &&
    first._provenance?.side === second._provenance?.side
  );
}

// How near two crossings must be to count as the same one. Curve-curve
// intersection subdivides, so a single crossing comes back as a small cluster of
// parameter pairs. Counting those as several would send an ordinary corner down
// the fallback.
const CORNER_CROSSING_CLUSTER = 0.5;

// How small a pair of spans must get before it is called one point, in font
// units, and how many spans the search may hold at once. The cap only bites on
// two curves that lie along each other, where every span overlaps every other;
// the clustering below then collapses what comes back.
const CROSSING_PRECISION = 0.01;
const CROSSING_MAX_SPANS = 4000;

// A straight as a cubic. Controls at the thirds keep it linear in t, so the
// parameter the search reports is the parameter along the straight.
function asCubic(curve) {
  if (curve.length === 4) {
    return curve;
  }
  const [start, end] = curve;
  return [
    start,
    {
      x: start.x + (end.x - start.x) / 3,
      y: start.y + (end.y - start.y) / 3,
    },
    {
      x: start.x + (2 * (end.x - start.x)) / 3,
      y: start.y + (2 * (end.y - start.y)) / 3,
    },
    end,
  ];
}

function splitCubicInHalf(points) {
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = mid(points[0], points[1]);
  const b = mid(points[1], points[2]);
  const c = mid(points[2], points[3]);
  const d = mid(a, b);
  const e = mid(b, c);
  const f = mid(d, e);
  return [
    [points[0], a, d, f],
    [f, e, c, points[3]],
  ];
}

function controlBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, size: Math.max(maxX - minX, maxY - minY) };
}

/**
 * Every place two cubics cross, as a parameter on each.
 *
 * bezier-js has its own curve-curve intersection and it is not used here. It
 * reduces each curve to spans it calls simple and drops the spans it cannot
 * simplify, so a crossing that lands in a dropped span is reported as no
 * crossing at all. On the sharp inner corner of a b it reported none where there
 * is one, and the outline doubled back on itself.
 *
 * This subdivides the two curves against each other instead. Two spans whose
 * control boxes miss cannot hold a crossing. Two spans small enough to be one
 * point are one. Nothing is dropped, so nothing is missed.
 */
function cubicCrossings(cubic1, cubic2) {
  const found = [];
  let stack = [[cubic1, 0, 1, cubic2, 0, 1]];
  while (stack.length) {
    if (stack.length > CROSSING_MAX_SPANS) {
      break;
    }
    const [first, firstLow, firstHigh, second, secondLow, secondHigh] = stack.pop();
    const boxA = controlBox(first);
    const boxB = controlBox(second);
    if (
      boxA.maxX < boxB.minX ||
      boxB.maxX < boxA.minX ||
      boxA.maxY < boxB.minY ||
      boxB.maxY < boxA.minY
    ) {
      continue;
    }
    if (boxA.size <= CROSSING_PRECISION && boxB.size <= CROSSING_PRECISION) {
      found.push({ t1: (firstLow + firstHigh) / 2, t2: (secondLow + secondHigh) / 2 });
      continue;
    }
    // Halve whichever span is the coarser, so both close in together.
    if (boxA.size >= boxB.size) {
      const [left, right] = splitCubicInHalf(first);
      const middle = (firstLow + firstHigh) / 2;
      stack.push([left, firstLow, middle, second, secondLow, secondHigh]);
      stack.push([right, middle, firstHigh, second, secondLow, secondHigh]);
    } else {
      const [left, right] = splitCubicInHalf(second);
      const middle = (secondLow + secondHigh) / 2;
      stack.push([first, firstLow, firstHigh, left, secondLow, middle]);
      stack.push([first, firstLow, firstHigh, right, middle, secondHigh]);
    }
  }
  return found;
}

function cubicPointAt(points, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * points[0].x + b * points[1].x + c * points[2].x + d * points[3].x,
    y: a * points[0].y + b * points[1].y + c * points[2].y + d * points[3].y,
  };
}

// Every place the two curves meet, as a parameter on each, with clusters of
// subdivision hits counted once. Two straights are solved outright: the exact
// answer costs less than the search and cannot report a cluster.
function cornerCurveCrossings(curve1, curve2) {
  let candidates = [];
  if (curve1.length === 2 && curve2.length === 2) {
    const hit = vector.intersect(curve1[0], curve1[1], curve2[0], curve2[1]);
    if (hit) {
      candidates.push({ t1: hit.t1, t2: hit.t2 });
    }
  } else {
    candidates = cubicCrossings(asCubic(curve1), asCubic(curve2));
  }
  const shapeOne = asCubic(curve1);

  const crossings = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.t1) || !Number.isFinite(candidate.t2)) {
      continue;
    }
    // The two edges overlap, so their crossing lies inside both of the drawn
    // pieces. A meeting outside one of them is the carried-on line meeting
    // something the outline never draws.
    if (candidate.t1 < 0 || candidate.t1 > 1 || candidate.t2 < 0 || candidate.t2 > 1) {
      continue;
    }
    const point = cubicPointAt(shapeOne, candidate.t1);
    if (
      crossings.some(
        (other) => vector.distance(other.point, point) <= CORNER_CROSSING_CLUSTER
      )
    ) {
      continue;
    }
    crossings.push({ ...candidate, point });
  }
  return crossings;
}

/**
 * Replace each inner corner's two on-curve points with the one place its two
 * curves cross, and cut both curves back to it.
 *
 * A corner's inner side is where the two arms' edges overlap. The crossing there
 * is drawn geometry, so it is found rather than guessed at: both curves bend
 * toward each other, so a crossing of their end directions always sits too far
 * out and on a strongly curved arm the corner sticks through the stroke.
 *
 * Run before roundSharpCornersOnSide. Rounding reads the corner this pass leaves
 * behind.
 *
 * Where the two do not cross exactly once, both edge ends are kept and the
 * straight between them is the corner. Choosing among several crossings is a
 * choice that can change between two frames of a drag, and the outline is
 * rebuilt on every frame.
 */
function joinInnerCornersOnSide(sidePoints, { isClosed }) {
  let points = sidePoints.map((point) => ({ ...point }));
  // The element the list started on, so a closed side can be turned back to face
  // the way it came in. A merge can swallow it, and then the point that replaced
  // it is the start.
  const originalStart = points[0];
  let guard = points.length;

  while (guard-- > 0) {
    const pairIndex = findInnerCornerPair(points, isClosed);
    if (pairIndex === null) {
      break;
    }
    const merged = mergeInnerCornerPair(points, pairIndex, isClosed);
    if (!merged) {
      // No usable crossing. Both edge ends stay and the straight between them is
      // the corner. Clear the arm labels on the way past so the scan does not
      // come back to this pair.
      const first = points[pairIndex];
      const second = points[(pairIndex + 1) % points.length];
      for (const point of [first, second]) {
        if (point._provenance) {
          point._provenance = { ...point._provenance, heldArm: point._provenance.arm };
          delete point._provenance.arm;
        }
      }
      continue;
    }
    points = merged;
  }

  // Put the arm labels back on any pair that kept both of its points.
  for (const point of points) {
    if (point._provenance?.heldArm) {
      point._provenance.arm = point._provenance.heldArm;
      delete point._provenance.heldArm;
    }
  }

  if (isClosed && originalStart) {
    const startIndex = points.indexOf(originalStart);
    if (startIndex > 0) {
      points = [...points.slice(startIndex), ...points.slice(0, startIndex)];
    }
  }
  return points;
}

function findInnerCornerPair(points, isClosed) {
  const last = isClosed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    if (isInnerCornerPair(points[i], points[(i + 1) % points.length])) {
      return i;
    }
  }
  return null;
}

// The points from `from` to `to` going forward, both ends excluded, wrapping
// around the end of a closed side.
function pointsBetween(points, from, to) {
  const between = [];
  let cursor = (from + 1) % points.length;
  while (cursor !== to && between.length < points.length) {
    between.push(points[cursor]);
    cursor = (cursor + 1) % points.length;
  }
  return between;
}

// The indices from `from` to `to` going forward, both ends included.
function indexSpan(points, from, to) {
  const span = [from];
  let cursor = (from + 1) % points.length;
  while (span.length <= points.length) {
    span.push(cursor);
    if (cursor === to) {
      return span;
    }
    cursor = (cursor + 1) % points.length;
  }
  return span;
}

function mergeInnerCornerPair(points, pairIndex, isClosed) {
  const arrivingEnd = pairIndex;
  const leavingStart = (pairIndex + 1) % points.length;
  const prevOn = findPrevOnCurveIndex(points, arrivingEnd, isClosed);
  const nextOn = findNextOnCurveIndex(points, leavingStart, isClosed);
  if (prevOn === null || nextOn === null || prevOn === leavingStart) {
    return null;
  }

  const arrivingHandles = pointsBetween(points, prevOn, arrivingEnd);
  const leavingHandles = pointsBetween(points, leavingStart, nextOn);
  if (
    (arrivingHandles.length !== 0 && arrivingHandles.length !== 2) ||
    (leavingHandles.length !== 0 && leavingHandles.length !== 2)
  ) {
    return null;
  }

  const arriving = [points[prevOn], ...arrivingHandles, points[arrivingEnd]];
  const leaving = [points[leavingStart], ...leavingHandles, points[nextOn]];
  const crossings = cornerCurveCrossings(
    arriving.map((point) => ({ x: point.x, y: point.y })),
    leaving.map((point) => ({ x: point.x, y: point.y }))
  );
  if (crossings.length !== 1) {
    return null;
  }
  const { t1, t2, point: crossing } = crossings[0];

  // Everything the two edge ends carried that describes the corner itself, not
  // where it sat: the rounding stamped on it at emission, and its smoothness.
  // Corner rounding runs after this pass and reads them off the point it finds.
  const arrivingPoint = points[arrivingEnd];
  const crossingPoint = {
    x: Math.round(crossing.x),
    y: Math.round(crossing.y),
    smooth: arrivingPoint.smooth === true,
  };
  if (arrivingPoint.cornerDistance !== undefined) {
    crossingPoint.cornerDistance = arrivingPoint.cornerDistance;
  }
  if (arrivingPoint.cornerCurvature !== undefined) {
    crossingPoint.cornerCurvature = arrivingPoint.cornerCurvature;
  }
  const source = arrivingPoint._provenance;
  if (source) {
    const { arm: _arm, ...rest } = source;
    crossingPoint._provenance = { ...rest };
    // The cut leaves both curves shorter than the ones the generator solved.
    // Anything measuring a cut curve would then be talking about a different
    // curve from the one a pin is reproduced on, and the curvature gizmo's first
    // drag would jump. One reader resolves these; see skeleton-model.js.
    if (arriving.length === 4) {
      crossingPoint._provenance.constructionSegmentIn = arriving.map((point) => ({
        x: point.x,
        y: point.y,
      }));
    }
    if (leaving.length === 4) {
      crossingPoint._provenance.constructionSegmentOut = leaving.map((point) => ({
        x: point.x,
        y: point.y,
      }));
    }
  }

  const cutArriving = cutCurveAt(arriving, t1, "left");
  const cutLeaving = cutCurveAt(leaving, t2, "right");

  const rewritten = [
    points[prevOn],
    ...cutArriving,
    crossingPoint,
    ...cutLeaving,
    points[nextOn],
  ];

  const span = indexSpan(points, prevOn, nextOn);
  const replaced = new Set(span);
  const kept = [];
  for (let i = 0; i < points.length; i++) {
    if (!replaced.has(i)) {
      kept.push(points[i]);
    }
  }
  if (span[0] <= span[span.length - 1]) {
    return [...points.slice(0, prevOn), ...rewritten, ...points.slice(nextOn + 1)];
  }
  // The span wrapped the end of a closed side. The result starts on the piece
  // that follows it, which a closed contour is free to do; the caller turns the
  // list back to face the way it came in.
  return [...rewritten, ...kept];
}

// The handles of the piece of `curve` on one side of `t`, with their own
// provenance kept in place and their axes restamped, because a cut turns a
// handle onto a new direction.
function cutCurveAt(curve, t, half) {
  if (curve.length !== 4) {
    return [];
  }
  const split = new Bezier(curve.map((point) => ({ x: point.x, y: point.y }))).split(t);
  const kept = (half === "left" ? split.left : split.right).points;
  // Handle 1 keeps handle 1's address whichever end the cut came from, the same
  // rule the round-cap split follows.
  return [1, 2].map((index) => {
    const anchor = index === 1 ? kept[0] : kept[3];
    const handle = {
      ...curve[index],
      x: Math.round(kept[index].x),
      y: Math.round(kept[index].y),
      type: "cubic",
    };
    // A cut turns a handle onto a new direction, and a handle carrying a stale
    // axis leaves every reader measuring along a line the curve no longer takes.
    const axis = vector.normalizeVector({
      x: kept[index].x - anchor.x,
      y: kept[index].y - anchor.y,
    });
    if (Number.isFinite(axis.x) && Number.isFinite(axis.y)) {
      handle._axis = { x: axis.x, y: axis.y };
    } else {
      delete handle._axis;
    }
    return handle;
  });
}

// The four points of one arm, as references into the side's own list, or null
// where the two on-curves do not have exactly two handles between them.
function armPoints(points, fromOnIndex, toOnIndex, isClosed) {
  const between = pointsBetween(points, fromOnIndex, toOnIndex);
  if (between.length !== 2 || !between[0].type || !between[1].type) {
    return null;
  }
  if (!isClosed && fromOnIndex > toOnIndex) {
    return null;
  }
  return [points[fromOnIndex], between[0], between[1], points[toOnIndex]];
}

// Where along a cubic it has covered `length` of its own arc. Bisection on arc
// length, which rises strictly with the parameter, so the answer is continuous
// in the input and a fixed trip count is enough. Returns null where the curve is
// shorter than the length asked for.
function parameterAtArcLength(curve, length) {
  const bezier = new Bezier(curve.map((point) => ({ x: point.x, y: point.y })));
  const total = bezier.length();
  if (!(total > 1e-6) || !(length > 0) || length >= total) {
    return null;
  }
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (bezier.split(0, middle).length() < length) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

// Give up `trim` of one end of a curved arm by CUTTING the curve there. What
// survives is the same curve, shorter — the piece the rounding did not take.
//
// Sliding the end point along the chord toward its handle and carrying that
// handle with it is not this. It is a rigid move of one end of a cubic while the
// other end and its handle stay, which reshapes the curve: on `I^1` the shoulder
// bulged 19 units out of its own path on a rounding of 36. The corner join and
// the serif's easing both cut, and this is the same operation.
//
// `atEnd` says which end is given up. The arm's own points are rewritten in
// place, and the direction the surviving curve now travels at the cut is
// returned, because the arc has to leave along it or the join is a kink.
function trimCurvedArm(arm, trim, atEnd) {
  // Measured from the end being given up, so the curve is turned round when that
  // end is the far one.
  const given = parameterAtArcLength(atEnd ? [...arm].reverse() : arm, trim);
  if (given === null) {
    return null;
  }
  const bezier = new Bezier(arm.map((point) => ({ x: point.x, y: point.y })));
  const kept = (atEnd ? bezier.split(0, 1 - given) : bezier.split(given, 1)).points;
  const cutIndex = atEnd ? 3 : 0;
  const handleAtCut = atEnd ? 2 : 1;
  for (const index of [0, 1, 2, 3]) {
    arm[index].x = kept[index].x;
    arm[index].y = kept[index].y;
    if (index === 1 || index === 2) {
      // A cut turns a handle onto a new direction. A handle left carrying the
      // axis it was constructed on sends every reader measuring along a line the
      // curve no longer takes.
      const anchor = kept[index === 1 ? 0 : 3];
      const axis = vector.normalizeVector({
        x: kept[index].x - anchor.x,
        y: kept[index].y - anchor.y,
      });
      if (Number.isFinite(axis.x) && Number.isFinite(axis.y)) {
        arm[index]._axis = { x: axis.x, y: axis.y };
      } else {
        delete arm[index]._axis;
      }
    }
  }
  // The way the curve is heading as it arrives at the cut, pointing on past it.
  const travel = vector.normalizeVector({
    x: kept[cutIndex].x - kept[handleAtCut].x,
    y: kept[cutIndex].y - kept[handleAtCut].y,
  });
  if (!Number.isFinite(travel.x) || !Number.isFinite(travel.y)) {
    return null;
  }
  return { point: { x: kept[cutIndex].x, y: kept[cutIndex].y }, travel };
}

function roundSharpCornersOnSide(sidePoints, { isClosed }) {
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

    // Stamped at emission, per side, or absent where this side is not rounded.
    const cornerDistance = corner.cornerDistance;
    if (!Number.isFinite(cornerDistance) || cornerDistance <= 0) {
      continue;
    }
    const cornerCurvature = Number.isFinite(corner.cornerCurvature)
      ? corner.cornerCurvature
      : DEFAULT_CORNER_CURVATURE;

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
    // How far each arm may give up. An arm ends at its neighbouring on-curve,
    // and a curved arm stops just short of its handle, because trimming past
    // the handle inverts the curve it belongs to.
    let maxTrimIn = vector.distance(corner, points[prevOnIndex]);
    let maxTrimOut = vector.distance(corner, points[nextOnIndex]);

    if (prevHandleIndex !== null) {
      maxTrimIn = Math.min(
        maxTrimIn,
        vector.distance(corner, points[prevHandleIndex]) * MAX_HANDLE_TRIM_RATIO
      );
    }
    if (nextHandleIndex !== null) {
      maxTrimOut = Math.min(
        maxTrimOut,
        vector.distance(corner, points[nextHandleIndex]) * MAX_HANDLE_TRIM_RATIO
      );
    }

    const trimIn = Math.min(cornerDistance, maxTrimIn);
    const trimOut = Math.min(cornerDistance, maxTrimOut);
    if (!Number.isFinite(trimIn) || !Number.isFinite(trimOut)) {
      continue;
    }
    if (!(trimIn > 0) || !(trimOut > 0)) {
      continue;
    }

    cornerInfos.set(corner, {
      trimIn,
      trimOut,
      dirInAway,
      dirOutAway,
      curvature: cornerCurvature,
      prevHandlePoint: prevHandleIndex !== null ? points[prevHandleIndex] : null,
      nextHandlePoint: nextHandleIndex !== null ? points[nextHandleIndex] : null,
      // A curved arm is given up by cutting the curve, so the whole cubic is
      // needed and not just the handle beside the corner. Held as references so
      // that the emission below reads them as they stand — two corners can share
      // one segment, and the second has to cut what the first left.
      arrivingArm:
        prevHandleIndex !== null ? armPoints(points, prevOnIndex, i, isClosed) : null,
      leavingArm:
        nextHandleIndex !== null ? armPoints(points, i, nextOnIndex, isClosed) : null,
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

    // A straight arm is given up by stepping along it, which is exact. A curved
    // one is given up by cutting the curve, and the arc then has to leave along
    // the direction the shortened curve actually travels at the cut rather than
    // along the corner's own chord.
    const arrivingCut = cornerInfo.arrivingArm
      ? trimCurvedArm(cornerInfo.arrivingArm, trimIn, true)
      : null;
    const leavingCut = cornerInfo.leavingArm
      ? trimCurvedArm(cornerInfo.leavingArm, trimOut, false)
      : null;
    if (
      (cornerInfo.arrivingArm && !arrivingCut) ||
      (cornerInfo.leavingArm && !leavingCut)
    ) {
      i++;
      continue;
    }

    const startPoint = {
      x: arrivingCut ? arrivingCut.point.x : corner.x + cornerInfo.dirInAway.x * trimIn,
      y: arrivingCut ? arrivingCut.point.y : corner.y + cornerInfo.dirInAway.y * trimIn,
      smooth: true,
    };
    const endPoint = {
      x: leavingCut ? leavingCut.point.x : corner.x + cornerInfo.dirOutAway.x * trimOut,
      y: leavingCut ? leavingCut.point.y : corner.y + cornerInfo.dirOutAway.y * trimOut,
      smooth: true,
    };

    const startTangent = arrivingCut
      ? arrivingCut.travel
      : {
          x: -cornerInfo.dirInAway.x,
          y: -cornerInfo.dirInAway.y,
        };
    const endTangent = leavingCut
      ? { x: -leavingCut.travel.x, y: -leavingCut.travel.y }
      : {
          x: cornerInfo.dirOutAway.x,
          y: cornerInfo.dirOutAway.y,
        };
    // Curvature is a tension: 0 leaves both handles on their own on-curve and
    // cuts a straight chamfer, 1 carries both onto the corner point, which is
    // where the two tangent rays meet. A zero-length handle is the setting
    // asking for a chamfer, so it is never repaired.
    const chord = vector.distance(startPoint, endPoint);
    const handleLengths =
      chord > 1e-3
        ? computeTunniHandleLengths(
            startPoint,
            startTangent,
            endPoint,
            { x: -endTangent.x, y: -endTangent.y },
            cornerInfo.curvature
          )
        : { startLen: 0, endLen: 0 };

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

// The side whose edge lies on the centerline under `mode`, or null under
// two-sided, where the centerline lies on no edge.
//
// The naming does not read the way it sounds: a stroke set to "left" carries
// its width on the left, so its RIGHT edge is the one on the centerline.
export function collapsedSideForSingleSided(mode) {
  return mode === "left" ? "right" : mode === "right" ? "left" : null;
}

// Where a mode stands the centerline, as a signed distance from where the
// two-sided centerline stands. Positive along the left normal, which is the
// direction the left half-width is measured in.
//
// The half-width is the coupled one. Ribs tied across a straight share one
// offset, so the coupled value is where the edge is and the stored value is not.
function centerlineOffsetForSingleSided(contour, point, mode) {
  const collapsed = collapsedSideForSingleSided(mode);
  if (!collapsed) {
    return 0;
  }
  const distance = getEffectiveRibHalfWidth(contour, point, collapsed);
  return collapsed === "right" ? -distance : distance;
}

// Every stored adjustment that shapes one side of the generated outline. When
// that side's edge becomes the centerline, the edge is taken as drawn, so each
// of these is already in the geometry and has to come off the point — left
// behind, it would be applied a second time to an outline that already has it.
function clearGeneratedAdjustmentsOnSide(point, side) {
  point.nudge = { ...point.nudge, [side]: 0 };
  point.handleNudge = { ...point.handleNudge, [side]: 0 };
  point.segmentCurvature = { ...point.segmentCurvature, [side]: null };
  const handleOffsets = { ...point.handleOffsets };
  delete handleOffsets[`${side}In`];
  delete handleOffsets[`${side}Out`];
  point.handleOffsets = handleOffsets;
}

// The collapsing side's emitted geometry, keyed by the skeleton point it came
// from: the on-curve, and the handles either side of it.
//
// A corner where the two arms both emit an on-curve is left out. Those two
// points are the two ends of the corner rather than one place the centerline
// could stand, and taking either would put the centerline on one arm's edge
// and off the other's. Such a point falls back to the plain offset, which
// reaches the corner the letter actually draws.
function collectSolvedSidePoints(contour, side) {
  // The solve reads the generator's own input dialect, not the stored contour:
  // flattened widths, and the stable id under the name provenance is stamped
  // from. Handing it a stored contour emits points at no coordinates and with
  // no provenance at all.
  const [generatorContour] = canonicalToGeneratorInput({
    contours: [contour],
  }).contours;
  const solved = solveSkeletonContourSides(generatorContour);
  if (!solved) {
    return null;
  }
  const emitted = side === "left" ? solved.leftSide : solved.rightSide;
  const bySkeletonPoint = new Map();
  const armed = new Set();
  for (const point of emitted) {
    const provenance = point?._provenance;
    if (!provenance || provenance.side !== side) {
      continue;
    }
    const id = provenance.skeletonPointId;
    const entry = bySkeletonPoint.get(id) || {};
    if (provenance.role === "onCurve") {
      if (provenance.arm || entry.onCurve) {
        armed.add(id);
      }
      entry.onCurve = point;
    } else if (provenance.role === "in" || provenance.role === "out") {
      entry[provenance.role] = point;
    }
    bySkeletonPoint.set(id, entry);
  }
  for (const id of armed) {
    bySkeletonPoint.delete(id);
  }
  return bySkeletonPoint;
}

// Move a contour's centerline so that the letter stays where it is when its
// side mode changes to `targetMode`. The mode itself is written separately, by
// `setSkeletonContourSingleSided`.
//
// **It writes no width.** A one-sided stroke gives the named side the sum of
// the two stored half-widths and sets the other to nothing, so the visible
// width is that same sum in both modes. Moving the centerline onto the edge
// that is collapsing is the whole of it, and the stored split between the two
// sides rides across untouched — which is what the contour returns to when it
// goes two-sided again.
//
// At a point holding 60 on the left and 20 on the right, going two-sided to
// left-only: the centerline moves 20 toward the right edge, the left side then
// receives 80, and the left edge has not moved.
//
// `respectChanges` decides which edge the centerline lands on where the
// designer has worked on the collapsing side by hand.
//
// Off, the centerline is the old one stepped sideways, so it lands on the edge
// as the generator solves it, and the hand work stays stored and unapplied,
// ready for the contour going two-sided again.
//
// On, the centerline becomes that edge as drawn: its on-curves and handles are
// taken from what the generator emitted for that side, which already carries
// every slid on-curve, carried handle, hand-placed handle and pinned curvature
// on it. Those adjustments are then cleared, because they have become the shape
// of the centerline and applying them again would move the outline off it.
// Taking the emitted edge is the only route that keeps all of them: reading the
// stored numbers back and replaying them would be a second copy of the
// generator, and would carry only the ones somebody remembered.
//
// Returns whether anything moved.
export function moveCenterlineForSingleSidedChange(
  originalContour,
  workingContour,
  targetMode,
  { respectChanges = false, round = Math.round } = {}
) {
  const currentMode = originalContour?.singleSided ?? null;
  const nextMode = targetMode ?? null;
  if (currentMode === nextMode) {
    return false;
  }

  const offsets = new Map();
  originalContour.points.forEach((point, pointIndex) => {
    if (point.type) {
      return;
    }
    const distance =
      centerlineOffsetForSingleSided(originalContour, point, nextMode) -
      centerlineOffsetForSingleSided(originalContour, point, currentMode);
    if (distance) {
      offsets.set(pointIndex, distance);
    }
  });
  if (!offsets.size) {
    return false;
  }

  const moved = offsetContourAlongNormals(
    originalContour.points,
    originalContour.closed === true,
    offsets,
    workingContour.points,
    {
      round,
      rebuildHandles: true,
      // A corner's two edges meet further out than a half-width, so the
      // centerline has to reach that far to land on the corner the letter
      // draws.
      offsetCorners: true,
      normalAt: (pointIndex) =>
        calculateNormalAtSkeletonPoint(originalContour, pointIndex),
    }
  );

  const collapsingSide = collapsedSideForSingleSided(nextMode);
  if (!respectChanges || !collapsingSide) {
    return moved;
  }

  // The centerline stepped sideways above is the solved edge. Where the drawn
  // edge differs from it, the drawn one wins, point and handles together.
  const solved = collectSolvedSidePoints(originalContour, collapsingSide);
  if (!solved?.size) {
    return moved;
  }
  const points = originalContour.points;
  const isClosed = originalContour.closed === true;
  const step = (index, delta) => {
    const next = index + delta;
    if (next >= 0 && next < points.length) {
      return next;
    }
    return isClosed ? (next + points.length) % points.length : -1;
  };
  let changed = moved;
  points.forEach((point, pointIndex) => {
    if (point.type) {
      return;
    }
    const entry = solved.get(point.id);
    const workingPoint = workingContour.points[pointIndex];
    if (!entry?.onCurve || !workingPoint) {
      return;
    }
    workingPoint.x = round(entry.onCurve.x);
    workingPoint.y = round(entry.onCurve.y);
    for (const [role, delta] of [
      ["in", -1],
      ["out", 1],
    ]) {
      const handle = entry[role];
      const handleIndex = step(pointIndex, delta);
      const workingHandle =
        handleIndex >= 0 ? workingContour.points[handleIndex] : null;
      if (handle && workingHandle?.type) {
        workingHandle.x = round(handle.x);
        workingHandle.y = round(handle.y);
      }
    }
    clearGeneratedAdjustmentsOnSide(workingPoint, collapsingSide);
    changed = true;
  });
  return changed;
}

// Solve the stroke's two edges, and stop there.
//
// This is the whole of the offset construction and none of what closes it into
// a letter: no inner-corner join, no corner rounding, no caps, no assembly. So
// each side holds one on-curve per skeleton point, carrying the skeleton point
// it came from, which is what a reader wanting "where does this edge run" needs
// and what the finished outline no longer offers.
//
// Returns null where the contour is too short to have edges at all.
//
// `generateOutlineFromSkeletonContour` is the one caller that goes on to close
// them, and it takes the rest of what it needs from the same return, so the two
// halves cannot disagree about a width, a cap style or a coupled rib.
export function solveSkeletonContourSides(skeletonContour, options = {}) {
  const {
    points,
    isClosed,
    defaultWidth = DEFAULT_WIDTH,
    capStyle = "butt",
    singleSided = false,
    singleSidedDirection = "left",
  } = skeletonContour;

  if (points.length < 2) {
    return null;
  }

  // Separate on-curve and off-curve points, build segments
  const segments = buildSegmentsFromPoints(points, isClosed);

  // If no valid segments (e.g., less than 2 on-curve points), return empty
  if (segments.length === 0) {
    return null;
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
  // The stored pin for each segment a serif terminal owns, so the value the
  // solve no longer applies can be applied to the emitted piece instead.
  const serifPins = new Map();
  if (authoredKeys.size) {
    for (const segment of segments) {
      const owner = segment.startPoint;
      if (owner?.id === undefined) continue;
      if (Number.isFinite(owner.leftSegmentCurvature))
        serifPins.set(`${owner.id}/left`, owner.leftSegmentCurvature);
      if (Number.isFinite(owner.rightSegmentCurvature))
        serifPins.set(`${owner.id}/right`, owner.rightSegmentCurvature);
    }
  }
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

  return {
    segments,
    leftSide,
    rightSide,
    authoredKeys,
    serifPins,
    resolveHalfWidth,
    firstOnCurvePoint,
    lastOnCurvePoint,
    startCapStyle,
    endCapStyle,
  };
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
    isClosed,
    defaultWidth = DEFAULT_WIDTH,
    capStyle = "butt",
    reversed = false,
    singleSided = false,
    singleSidedDirection = "left",
  } = skeletonContour;

  const solved = solveSkeletonContourSides(skeletonContour, options);
  if (!solved) {
    return [];
  }
  const {
    segments,
    leftSide,
    rightSide,
    authoredKeys,
    serifPins,
    resolveHalfWidth,
    firstOnCurvePoint,
    lastOnCurvePoint,
    startCapStyle,
    endCapStyle,
  } = solved;

  const joinedLeftSide = joinInnerCornersOnSide(leftSide, { isClosed });
  const joinedRightSide = joinInnerCornersOnSide(rightSide, { isClosed });

  let roundedLeftSide = roundSharpCornersOnSide(joinedLeftSide, { isClosed });
  let roundedRightSide = roundSharpCornersOnSide(joinedRightSide, { isClosed });

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
        capBallEasing: firstOnCurvePoint.capBallEasing ?? DEFAULT_CAP_BALL_EASING,
        capBallEaseCurvature:
          firstOnCurvePoint.capBallEaseCurvature ?? DEFAULT_CAP_BALL_EASE_CURVATURE,
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
        capBallEasing: lastOnCurvePoint.capBallEasing ?? DEFAULT_CAP_BALL_EASING,
        capBallEaseCurvature:
          lastOnCurvePoint.capBallEaseCurvature ?? DEFAULT_CAP_BALL_EASE_CURVATURE,
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
    // The pin last, which is the order the solve itself uses: the placements say
    // where each handle sits, the pin then states the tension of the pair. Put
    // the other way round, an adjusted handle overwrites the pin, and the number
    // the gizmo measured off the drawn curve cannot be reproduced from it.
    roundedLeftSide = applySerifPinnedCurvature(
      roundedLeftSide,
      "left",
      authoredKeys,
      serifPins
    );
    roundedRightSide = applySerifPinnedCurvature(
      roundedRightSide,
      "right",
      authoredKeys,
      serifPins
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
  const projectPoint = (basePoint, normal, halfWidth, sign, miterScale = 1) => {
    if (isCollapsedSide(halfWidth)) {
      return { x: basePoint.x, y: basePoint.y };
    }
    const reach = halfWidth * miterScale;
    return {
      x: Math.round(basePoint.x + sign * normal.x * reach),
      y: Math.round(basePoint.y + sign * normal.y * reach),
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
    let startJoin =
      !prevSegment ||
      (isFirst && !isClosed) ||
      // Direction comes from this straight, not from a miter average with the
      // one handle on the far side.
      isStraightControlledSmoothPoint(segment.startPoint, segment, prevSegment)
        ? null
        : calculateCornerJoin(prevSegment, segment);
    let startNormal = startJoin ? startJoin.normal : normal;
    // Apply angle override if set on the point
    startNormal = getEffectiveNormal(segment.startPoint, startNormal);
    // A smooth point is not a corner: the centerline does not change direction
    // there, so it keeps the averaged normal at a plain half-width.
    if (startJoin && segment.startPoint.smooth) {
      startJoin = null;
    }
    const startLocked = !!segment.startPoint?.ribAngleLock;
    const startJoinPlace = lockedPlacement(
      segment.startPoint,
      startNormal,
      startJoin ? startJoin.normal : normal
    );
    const startOwnPlace = lockedPlacement(
      segment.startPoint,
      getEffectiveNormal(segment.startPoint, normal),
      normal
    );
    const startLeftPlace = cornerSidePlacement(
      startJoin,
      1,
      startJoinPlace,
      startOwnPlace,
      startLocked
    );
    const startRightPlace = cornerSidePlacement(
      startJoin,
      -1,
      startJoinPlace,
      startOwnPlace,
      startLocked
    );
    // An inner side needs both arms' edge ends, so the arm that does not carry
    // the shared on-curve today adds its own.
    const addStartLeft = shouldAddStart || startLeftPlace.perArm;
    const addStartRight = shouldAddStart || startRightPlace.perArm;
    if (addStartLeft || addStartRight) {
      const startLeftScale = startLeftPlace.scale;
      const startRightScale = startRightPlace.scale;

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
        startLeftPlace.normal,
        startLeftHW,
        1,
        startLeftScale
      );
      const startLeftPt = translateRibPoint(startLeftBase, startLeftNudge);
      if (addStartLeft) {
        left.push(
          buildGeneratedOnCurve(
            startLeftPt,
            segment.startPoint.smooth,
            segment.startPoint,
            startLeftHW,
            startLeftRoundBase,
            "left",
            startLeftNudge,
            startLeftBase,
            startLeftPlace.perArm ? "out" : null
          )
        );
      }

      const startRightNudge = ribNudgeDisplacement(
        segment.startPoint,
        startNormal,
        "right",
        startRightHW
      );
      const startRightBase = projectPoint(
        segment.startPoint,
        startRightPlace.normal,
        startRightHW,
        -1,
        startRightScale
      );
      const startRightPt = translateRibPoint(startRightBase, startRightNudge);
      if (addStartRight) {
        right.push(
          buildGeneratedOnCurve(
            startRightPt,
            segment.startPoint.smooth,
            segment.startPoint,
            startRightHW,
            startRightRoundBase,
            "right",
            startRightNudge,
            startRightBase,
            startRightPlace.perArm ? "out" : null
          )
        );
      }
    }

    // Add end point offset:
    // - For open skeletons: for all segments (each adds its end)
    // - For closed skeletons: don't add (next segment's start is this end)
    const shouldAddEnd = !isClosed;
    let endJoin =
      !nextSegment ||
      // A closed contour's last segment has a next one: it wraps. Only an open
      // contour's last segment ends at a terminal rather than a corner.
      (isLast && !isClosed) ||
      // Direction comes from this straight, not from a miter average with the
      // one handle on the far side.
      isStraightControlledSmoothPoint(segment.endPoint, segment, nextSegment)
        ? null
        : calculateCornerJoin(segment, nextSegment);
    let endNormal = endJoin ? endJoin.normal : normal;
    // Apply angle override if set on the point
    endNormal = getEffectiveNormal(segment.endPoint, endNormal);
    // A smooth point is not a corner and keeps the averaged normal at a plain
    // half-width.
    if (endJoin && segment.endPoint.smooth) {
      endJoin = null;
    }
    const endLocked = !!segment.endPoint?.ribAngleLock;
    const endJoinPlace = lockedPlacement(
      segment.endPoint,
      endNormal,
      endJoin ? endJoin.normal : normal
    );
    const endOwnPlace = lockedPlacement(
      segment.endPoint,
      getEffectiveNormal(segment.endPoint, normal),
      normal
    );
    const endLeftPlace = cornerSidePlacement(
      endJoin,
      1,
      endJoinPlace,
      endOwnPlace,
      endLocked
    );
    const endRightPlace = cornerSidePlacement(
      endJoin,
      -1,
      endJoinPlace,
      endOwnPlace,
      endLocked
    );
    const addEndLeft = shouldAddEnd || endLeftPlace.perArm;
    const addEndRight = shouldAddEnd || endRightPlace.perArm;
    if (addEndLeft || addEndRight) {
      const endLeftScale = endLeftPlace.scale;
      const endRightScale = endRightPlace.scale;

      // Copy smooth property from skeleton point, round to UPM grid
      // Use per-point half-widths for left and right sides
      // Apply nudge offset if point is editable
      const endLeftNudge = ribNudgeDisplacement(
        segment.endPoint,
        endNormal,
        "left",
        endLeftHW
      );
      const endLeftBase = projectPoint(
        segment.endPoint,
        endLeftPlace.normal,
        endLeftHW,
        1,
        endLeftScale
      );
      const endLeftPt = translateRibPoint(endLeftBase, endLeftNudge);
      if (addEndLeft) {
        left.push(
          buildGeneratedOnCurve(
            endLeftPt,
            segment.endPoint.smooth,
            segment.endPoint,
            endLeftHW,
            endLeftRoundBase,
            "left",
            endLeftNudge,
            endLeftBase,
            endLeftPlace.perArm ? "in" : null
          )
        );
      }

      const endRightNudge = ribNudgeDisplacement(
        segment.endPoint,
        endNormal,
        "right",
        endRightHW
      );
      const endRightBase = projectPoint(
        segment.endPoint,
        endRightPlace.normal,
        endRightHW,
        -1,
        endRightScale
      );
      const endRightPt = translateRibPoint(endRightBase, endRightNudge);
      if (addEndRight) {
        right.push(
          buildGeneratedOnCurve(
            endRightPt,
            segment.endPoint.smooth,
            segment.endPoint,
            endRightHW,
            endRightRoundBase,
            "right",
            endRightNudge,
            endRightBase,
            endRightPlace.perArm ? "in" : null
          )
        );
      }
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
    let startJoin = null;
    if (!prevSegment || (isFirst && !isClosed)) {
      startNormal = bezierStartNormal;
    } else if (
      isStraightControlledSmoothPoint(segment.startPoint, prevSegment, segment)
    ) {
      startNormal = straightSegmentNormal(prevSegment);
    } else {
      startJoin = calculateCornerJoin(prevSegment, segment);
      startNormal = startJoin.normal;
    }
    const startUnlockedNormal = startNormal;
    // Apply angle override if set on the point
    startNormal = getEffectiveNormal(segment.startPoint, startNormal);
    // A smooth point is not a corner and keeps the averaged normal at a plain
    // half-width.
    if (startJoin && segment.startPoint.smooth) {
      startJoin = null;
    }

    let endNormal;
    let endJoin = null;
    if (!nextSegment || (isLast && !isClosed)) {
      endNormal = bezierEndNormal;
    } else if (
      isStraightControlledSmoothPoint(segment.endPoint, nextSegment, segment)
    ) {
      endNormal = straightSegmentNormal(nextSegment);
    } else {
      endJoin = calculateCornerJoin(segment, nextSegment);
      endNormal = endJoin.normal;
    }
    const endUnlockedNormal = endNormal;
    // Apply angle override if set on the point
    endNormal = getEffectiveNormal(segment.endPoint, endNormal);
    // A smooth point is not a corner and keeps the averaged normal at a plain
    // half-width.
    if (endJoin && segment.endPoint.smooth) {
      endJoin = null;
    }
    const startLocked = !!segment.startPoint?.ribAngleLock;
    const endLocked = !!segment.endPoint?.ribAngleLock;
    // The unlocked normal is the one the point would have used with no lock, and
    // it is what the forced rib is measured against. At a straight-controlled
    // smooth point that is the straight's normal, not this curve's, which is why
    // it is read back from the branch above rather than recomputed here.
    const startJoinPlace = lockedPlacement(
      segment.startPoint,
      startNormal,
      startUnlockedNormal
    );
    const endJoinPlace = lockedPlacement(
      segment.endPoint,
      endNormal,
      endUnlockedNormal
    );
    const startOwnPlace = lockedPlacement(
      segment.startPoint,
      getEffectiveNormal(segment.startPoint, bezierStartNormal),
      bezierStartNormal
    );
    const endOwnPlace = lockedPlacement(
      segment.endPoint,
      getEffectiveNormal(segment.endPoint, bezierEndNormal),
      bezierEndNormal
    );
    const startLeftPlace = cornerSidePlacement(
      startJoin,
      1,
      startJoinPlace,
      startOwnPlace,
      startLocked
    );
    const startRightPlace = cornerSidePlacement(
      startJoin,
      -1,
      startJoinPlace,
      startOwnPlace,
      startLocked
    );
    const endLeftPlace = cornerSidePlacement(
      endJoin,
      1,
      endJoinPlace,
      endOwnPlace,
      endLocked
    );
    const endRightPlace = cornerSidePlacement(
      endJoin,
      -1,
      endJoinPlace,
      endOwnPlace,
      endLocked
    );

    const avgLeftHW = (startLeftHW + endLeftHW) / 2;
    const avgRightHW = (startRightHW + endRightHW) / 2;

    // Fixed endpoint positions (using corner-aware normals and per-point widths),
    // rounded to UPM grid. These stay UN-nudged: the offset construction below
    // is fit against the un-nudged offset curve, so handing it a nudged endpoint
    // makes it shorten the handle to pull the curve back. On-curve nudge and
    // Z-normal handle carry are applied independently after construction.
    const fixedStartLeft = projectPoint(
      segment.startPoint,
      startLeftPlace.normal,
      startLeftHW,
      1,
      startLeftPlace.scale
    );
    const fixedStartRight = projectPoint(
      segment.startPoint,
      startRightPlace.normal,
      startRightHW,
      -1,
      startRightPlace.scale
    );
    const fixedEndLeft = projectPoint(
      segment.endPoint,
      endLeftPlace.normal,
      endLeftHW,
      1,
      endLeftPlace.scale
    );
    const fixedEndRight = projectPoint(
      segment.endPoint,
      endRightPlace.normal,
      endRightHW,
      -1,
      endRightPlace.scale
    );

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
      endNudge,
      startArm,
      endArm
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
              segment.startPoint,
              startArm
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
              segment.endPoint,
              endArm
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
      const startAdjustment =
        startHandleDir && !authoredKeys?.has(`${segment.startPoint?.id}/${side}/out`)
          ? getGeneratedHandleAdjustment(
              segment.startPoint,
              startHandleDir,
              side,
              "out"
            )
          : null;
      const endAdjustment =
        endHandleDir && !authoredKeys?.has(`${segment.endPoint?.id}/${side}/in`)
          ? getGeneratedHandleAdjustment(segment.endPoint, endHandleDir, side, "in")
          : null;
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
      // How far emission will slide each handle along its own direction. The
      // ceiling is a statement about the drawn curve, so it has to know.
      const alongDirection = (anchor, displacement, direction) => {
        const emitted = emittedNudge(anchor, displacement);
        return emitted.x * direction.x + emitted.y * direction.y;
      };
      const { startLength, endLength, honoredStartAdjustment, honoredEndAdjustment } =
        offsetCubicSide({
          startHandleNudge: alongDirection(fixedStart, startHandleNudge, startDir),
          endHandleNudge: alongDirection(fixedEnd, endHandleNudge, endDir),
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
          //
          // Withheld on a serif terminal's own segment, and applied after the
          // splice instead. The serif finds its release ON this wall, so a pin
          // applied here reshapes the wall the release is found on and walks the
          // whole terminal up and down the stem. The `out` handle at a segment's
          // start point is claimed for exactly the segments a serif terminal owns,
          // which is why the same key set gates all three authored layers.
          pinnedTension: authoredKeys?.has(`${segment.startPoint?.id}/${side}/out`)
            ? undefined
            : isLeftSide
              ? segment.startPoint.leftSegmentCurvature
              : segment.startPoint.rightSegmentCurvature,
          startAdjustment,
          endAdjustment,
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
            fixedStart,
            startArm
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
      for (const [point, owner, role, axis, handleNudge, adjustment, honored] of [
        [
          adjustedHandle1,
          segment.startPoint,
          "out",
          startDir,
          emittedNudge(fixedStart, startHandleNudge),
          startAdjustment,
          honoredStartAdjustment,
        ],
        [
          adjustedHandle2,
          segment.endPoint,
          "in",
          endDir,
          emittedNudge(fixedEnd, endHandleNudge),
          endAdjustment,
          honoredEndAdjustment,
        ],
      ]) {
        const generated = {
          x: Math.round(point.x),
          y: Math.round(point.y),
          type: "cubic",
        };
        const provenance = pointProvenance(owner, side, role);
        // How much of this handle's stored offset the ceiling let through. Only
        // an attached offset that was actually offered here has one: a detached
        // handle is absolute and never met the ceiling, and a serif terminal's
        // handles are placed after the splice by their own path.
        if (
          provenance &&
          adjustment &&
          !adjustment.detached &&
          (adjustment.x || adjustment.y) &&
          axis
        ) {
          provenance.honoredAdjustment = {
            x: axis.x * honored,
            y: axis.y * honored,
          };
        }
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
          // Published for the same reason the on-curve publishes its own nudge:
          // this displacement is added after the construction, so a reader that
          // wants the curve the generator solved has to be able to take it back
          // off. Recovering it from geometry is not available (rail R-D).
          if (provenance) provenance.handleNudge = { ...handleNudge };
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
            fixedEnd,
            endArm
          )
        );
      return;
    };

    // Determine which points to add based on closed/open and first/last. An
    // inner side needs both arms' edge ends, so the arm that does not carry the
    // shared on-curve today adds its own.
    const shouldAddStart = isClosed || isFirst;
    const shouldAddEnd = !isClosed;

    addOffsetCurves(
      left,
      fixedStartLeft,
      fixedEndLeft,
      shouldAddStart || startLeftPlace.perArm,
      shouldAddEnd || endLeftPlace.perArm,
      segment.startPoint.smooth,
      segment.endPoint.smooth,
      avgLeftHW,
      true, // isLeftSide
      startLeftHW,
      endLeftHW,
      startLeftRoundBase,
      endLeftRoundBase,
      nudgeStartLeft,
      nudgeEndLeft,
      startLeftPlace.perArm ? "out" : null,
      endLeftPlace.perArm ? "in" : null
    );

    addOffsetCurves(
      right,
      fixedStartRight,
      fixedEndRight,
      shouldAddStart || startRightPlace.perArm,
      shouldAddEnd || endRightPlace.perArm,
      segment.startPoint.smooth,
      segment.endPoint.smooth,
      avgRightHW,
      false, // isLeftSide
      startRightHW,
      endRightHW,
      startRightRoundBase,
      endRightRoundBase,
      nudgeStartRight,
      nudgeEndRight,
      startRightPlace.perArm ? "out" : null,
      endRightPlace.perArm ? "in" : null
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
 * The join at a corner between two arms.
 *
 * `normal` is the unit normal on the line that splits the angle between the two
 * arms. `miterScale` is how many half-widths along that line the two carried-on
 * edges of a side meet at: one over the cosine of half the turn, and Infinity
 * where the two arms are exactly parallel, which is a centerline folded back on
 * itself. `dir1` and `dir2` are the arms' own unit directions, returned so that
 * no caller works them out a second time (rail R-B).
 */
function calculateCornerJoin(segment1, segment2) {
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

  // Each arm's edge ends square to that arm's own direction, so the two edge
  // ends of one side are at two different places. Carried on along their own
  // arms they meet on the split line, one half-width over the cosine of half
  // the turn out. Placing the point at a plain half-width left the corner open.
  const cosHalfTurn = Math.abs(cosH);
  const miterScale = cosHalfTurn > 0 ? 1 / cosHalfTurn : Infinity;

  // Normal is perpendicular to bisector (rotated 90 degrees CW)
  return { normal: { x: bisector.y, y: -bisector.x }, miterScale, dir1, dir2 };
}

/**
 * Whether one side of a corner has a gap between its two edge ends.
 *
 * `sideSign` is 1 for the left side and -1 for the right. The test reads the
 * geometry rather than the sign of the turn: it takes the ingoing arm's own
 * direction and the vector between the two edge ends, which is the half-width
 * times the difference of the two arms' normals. Pointing the same way means a
 * gap, which is the outer side.
 */
function cornerSideIsOuter(dir1, dir2, sideSign) {
  const n1 = vector.rotateVector90CW(dir1);
  const n2 = vector.rotateVector90CW(dir2);
  const between = { x: sideSign * (n2.x - n1.x), y: sideSign * (n2.y - n1.y) };
  return dir1.x * between.x + dir1.y * between.y >= 0;
}

// How far a corner may reach, as a multiple of ITS OWN SIDE'S half-width. Past
// this the two arms are so nearly parallel that the place their edges meet is
// further out than the letter is tall.
//
// Per side, not per stroke. Stated against the whole stroke width instead, a
// side carrying a small share of an unlinked width was allowed a spike several
// times longer than that side is wide, while the other side of the same corner
// was held: a 10/50 stroke let its narrow side reach twelve half-widths. Four
// half-widths is two full stroke widths wherever the two sides are equal, so
// nothing changes for a linked width. The drag that offsets an ordinary
// hand-drawn outline states the same number the same way.
const CORNER_MITER_LIMIT = 4;

/**
 * Whether an outer side's apex is out of bounds.
 *
 * True past the limit, and true where the two arms are exactly parallel and
 * there is no apex at all. That side then ends each arm at its own edge end, and
 * the straight between the two is the corner.
 */
function cornerIsHeld(miterScale) {
  return !Number.isFinite(miterScale) || miterScale > CORNER_MITER_LIMIT;
}

/**
 * A normal and how far along it the outline sits, once a forced rib is allowed
 * for.
 *
 * A rib angle lock turns the rib off the perpendicular. The stroke's width is
 * measured across the centerline and does not change, so the outline point stays
 * on the edge it was always on, and the forced rib has to reach further along
 * itself to get there: one half-width over the cosine of the angle it was turned
 * through. Walking a plain half-width along the forced rib instead put the
 * outline inside its own edge, and a diagonal stem with a horizontal rib drew
 * 51 units wide while its panel read 60.
 *
 * The same limit the corner uses holds it. A rib turned to within a few degrees
 * of the centerline reaches for an edge that is almost parallel to it.
 */
function lockedPlacement(point, forcedNormal, unlockedNormal) {
  return {
    normal: forcedNormal,
    scale: ribAngleLockReach(point, forcedNormal, unlockedNormal),
  };
}

/**
 * Where one side of a corner puts its endpoint.
 *
 * The outer side reaches the apex: along the split line, at one half-width over
 * the cosine of half the turn.
 *
 * Three cases cannot use the apex. The inner side's two edges overlap rather than
 * stopping, so their crossing is drawn geometry and joinInnerCornersOnSide finds
 * it. An outer side past the miter limit has an apex too far out to draw. Both
 * end each arm at its own edge end, square to that arm's own direction, which is
 * what `perArm` says. Both arms work it out for themselves from the same pair of
 * segments, so they agree with no state passed between them.
 */
function cornerSidePlacement(join, sideSign, joinPlace, ownPlace, locked) {
  if (!join) {
    return { ...joinPlace, perArm: false };
  }
  if (locked) {
    // A forced rib replaces the split line outright, so there is no meeting
    // place to reach: both carried-on edges already lie on the forced rib. Each
    // arm ends on it instead, on the side its own direction puts it. Where the
    // corner turns far enough for the two arms to read opposite sides, that
    // gives a flat face across the corner, one rib wide, along the forced angle.
    // Where they read the same side the two land together and are one point.
    return { ...ownPlace, perArm: true };
  }
  if (!cornerSideIsOuter(join.dir1, join.dir2, sideSign)) {
    return { ...ownPlace, perArm: true };
  }
  if (cornerIsHeld(join.miterScale)) {
    // The two edge ends have a gap between them, so joinInnerCornersOnSide finds
    // no crossing and leaves both standing. The straight between them needs no
    // code: two on-curves with no handles between them are a straight line.
    return { ...ownPlace, perArm: true };
  }
  return {
    normal: joinPlace.normal,
    scale: joinPlace.scale * join.miterScale,
    perArm: false,
  };
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
  fallbackDirections,
  // How little curve a cut may leave behind. A round cap keeps a unit, because
  // its tip is built from the direction the leftover piece gives it. A serif
  // reads no direction off that piece and may release the stroke at the rib end
  // itself, which is a legal shape — points collapse, they do not disappear.
  { minimumTrim = 1 } = {}
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
  if (terminalSegmentLength >= 2 && effectiveTrimDistance < minimumTrim) {
    effectiveTrimDistance = minimumTrim;
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
    if (
      minimumTrim > 0 &&
      vector.distance(insertedPoint, referenceEndpoint) < minimumTrim
    ) {
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
  return (
    splitTerminalSideAtT(sidePoints, sidePosition, terminalSegment, bezier, splitT, {
      fallbackDirection,
    }) ?? synthesizeInsertedPoint()
  );
}

// Cut a terminal side's segment at a parameter and rewrite the side around the
// cut. Shared by the distance split above and the parameter split below, so the
// two cannot drift apart on how a cut segment is put back together.
//
// Returns null when the cut has no usable tangent, which is the caller's cue to
// fall back to a synthesized point.
function splitTerminalSideAtT(
  sidePoints,
  sidePosition,
  terminalSegment,
  bezier,
  splitT,
  { publishConstructionSegment = true, fallbackDirection } = {}
) {
  const { segmentStartIndex, segmentEndIndex, segmentPoints } = terminalSegment;
  const fromEnd = sidePosition === "end";
  const referenceEndpointIndex = fromEnd ? segmentEndIndex : segmentStartIndex;
  const referenceEndpoint = cloneRoundCapPoint(sidePoints[referenceEndpointIndex]);
  const startPoint = segmentPoints[0];
  const endPoint = segmentPoints[segmentPoints.length - 1];
  const derivative = bezier.derivative(splitT);
  const derivativeDirection = vector.normalizeVector({
    x: derivative.x,
    y: derivative.y,
  });
  if (!isUsableDirection(derivativeDirection)) {
    return null;
  }

  const split = bezier.split(splitT);
  const leftPoints = split.left.points.map((point) => ({ x: point.x, y: point.y }));
  const rightPoints = split.right.points.map((point) => ({ x: point.x, y: point.y }));
  let insertedPoint = buildInsertedRoundCapPoint(leftPoints[leftPoints.length - 1]);
  if (fallbackDirection && vector.distance(insertedPoint, referenceEndpoint) < 1) {
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
  if (publishConstructionSegment && insertedPoint._provenance) {
    insertedPoint._provenance.constructionSegment = segmentPoints.map((point) => ({
      x: point.x,
      y: point.y,
    }));
  }
  // The two handles either side of the cut are tangent to the curve there, so
  // each one's own direction is the axis its length is measured along. Stamp it:
  // a handle carrying no axis leaves every reader estimating one back out of a
  // rounded position, and an authored adjustment has nothing to move along.
  const axisFromInserted = (point) => {
    const direction = vector.normalizeVector({
      x: point.x - insertedPoint.x,
      y: point.y - insertedPoint.y,
    });
    return isUsableDirection(direction) ? direction : null;
  };
  const stampAxis = (offCurve, axis) => {
    if (axis) offCurve._axis = { x: axis.x, y: axis.y };
    return offCurve;
  };
  const rewrittenSegment = [
    cloneRoundCapPoint(startPoint),
    withRoundCapProvenance(
      buildSplitOffCurve(leftPoints[1], originalHandle1),
      originalHandle1
    ),
    withRoundCapProvenance(
      stampAxis(buildSplitOffCurve(leftPoints[2]), axisFromInserted(leftPoints[2])),
      originalHandle2
    ),
    insertedPoint,
    withRoundCapProvenance(
      stampAxis(buildSplitOffCurve(rightPoints[1]), axisFromInserted(rightPoints[1])),
      originalHandle1
    ),
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

// Split a terminal side at a parameter that the caller already knows, rather
// than at an arc-length distance the split has to solve for. A serif finds its
// release ON the wall, so the parameter comes with it, and solving for a
// distance again would only reintroduce the half-unit tolerance that solve
// carries.
function splitTerminalSideAtParameter(
  sidePoints,
  sidePosition,
  parameter,
  fallbackDirections
) {
  const terminalSegment = getRoundCapTerminalSegment(sidePoints, sidePosition);
  if (!terminalSegment) {
    return null;
  }
  const { segmentPoints } = terminalSegment;
  // A serif on a straight stem has a LINE for its terminal segment, which is the
  // ordinary case and must keep working. On a line, parameter and distance are
  // exactly proportional, so the existing distance split is exact there and
  // there is nothing to solve. Only a cubic needs the parameter carried through.
  if (segmentPoints.length === 2) {
    const length = vector.distance(segmentPoints[0], segmentPoints[1]);
    return splitTerminalSideForRoundCap(
      sidePoints,
      sidePosition,
      parameter * length,
      fallbackDirections,
      { minimumTrim: 0 }
    );
  }
  if (segmentPoints.length !== 4) {
    return null;
  }
  const bezier = createBezierFromPoints(segmentPoints);
  // A start terminal's segment already runs from the rib end into the stroke,
  // which is the wall's own direction. An end terminal's runs the other way.
  const splitT = sidePosition === "end" ? 1 - parameter : parameter;
  // No floor and no nudge away from the endpoint. A collapsed serif releases the
  // stroke AT the rib end, which is a legal shape here — points collapse, they
  // do not disappear — and pushing the cut a unit inward instead moves an
  // on-curve a designer never asked to move. The degenerate piece the cut leaves
  // behind is discarded by the emission trim in any case.
  return (
    splitTerminalSideAtT(sidePoints, sidePosition, terminalSegment, bezier, splitT, {
      // A pin on a serifed terminal governs the piece that survives the trim,
      // not the curve the generator solved, so there is no second curve for a
      // reader to be handed. Publishing one would leave the gizmo measuring one
      // curve and writing the answer onto another.
      publishConstructionSegment: false,
    }) ??
    // Only when the cut has no usable tangent, which needs a segment with a
    // collapsed handle. Then the distance split's synthesized point stands in.
    splitTerminalSideForRoundCap(sidePoints, sidePosition, 0, fallbackDirections, {
      minimumTrim: 0,
    })
  );
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

function clampCapBallEasing(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CAP_BALL_EASING;
  }
  return Math.min(Math.max(value, 0), 1);
}

// Clamped on output only, like every other curvature the gizmo writes: a stored
// value the geometry cannot honor today comes back intact once it can.
function clampCapBallEaseCurvature(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CAP_BALL_EASE_CURVATURE;
  }
  return Math.min(Math.max(value, 0), 1);
}

// The neck's own provenance. A neck is cap geometry with no skeleton segment
// behind it, so its curvature cannot live in `segmentCurvature`; it names the
// cap-owning point and the field instead. `side` is the inner generated side, so
// the segment walk sees one consistent side across all four points and needs no
// second rule to accept it.
function neckProvenance(sourcePoint, side, role) {
  if (!sourcePoint?._sourcePointId) {
    return null;
  }
  return {
    skeletonPointId: sourcePoint._sourcePointId,
    side,
    role,
    capCurvatureField: "capBallEaseCurvature",
  };
}

function withNeckProvenance(point, sourcePoint, side, role) {
  const provenance = neckProvenance(sourcePoint, side, role);
  if (point && provenance) {
    point._provenance = provenance;
  }
  return point;
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
    contains(point) {
      const { u, v } = this.localOf(point);
      return u * u + v * v < 1;
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

// The same crossing slid back along its own segment by `easing`, a 0..1 fraction
// of the run from the crossing to that segment's far on-curve.
//
// Staying on the crossing's own segment is what bounds the neck. At easing 1 the
// far end lands exactly on the on-curve and the two collapse, and there is
// nowhere past it to go — so the stop is a property of the run rather than a
// separate clamp that could disagree with the panel's range.
function crossingAtEasing(crossingInfo, easing) {
  const { tCross, fromEnd, bezier, segmentPoints } = crossingInfo;
  const t = fromEnd ? tCross * (1 - easing) : tCross + (1 - tCross) * easing;
  let crossing;
  let crossingTangent = null;
  if (bezier) {
    const point = bezier.get(t);
    crossing = { x: point.x, y: point.y };
    const derivative = bezier.derivative(t);
    crossingTangent = vector.normalizeVector({ x: derivative.x, y: derivative.y });
  } else {
    const last = segmentPoints[segmentPoints.length - 1];
    crossing = vector.interpolateVectors(segmentPoints[0], last, t);
    const chord = vector.subVectors(last, segmentPoints[0]);
    crossingTangent = isUsableDirection(chord) ? vector.normalizeVector(chord) : null;
  }
  return {
    ...crossingInfo,
    crossing,
    crossingTangent: isUsableDirection(crossingTangent)
      ? crossingTangent
      : crossingInfo.crossingTangent,
    tCross: t,
  };
}

// Rebuild a side outline trimmed at a crossing (from findSideBallCrossing),
// so its terminal segment stops at the crossing. `smooth` marks the new
// terminal on-curve (true for a filleted neck that meets the ball tangentially,
// false for a hard concave corner).
//
// `addressable` gives the trimmed segment's two rebuilt handles the provenance
// their originals carried, and stamps the untrimmed segment onto the crossing
// on-curve. Together those are what the curvature gizmo needs: the addresses let
// it find the segment at all, and the untrimmed snapshot lets it measure the
// curve its pin actually governs rather than the piece left after the cut. This
// is the same pair the round-cap split publishes.
//
// It is off for an eased neck on purpose. Exactly one gizmo lives at a bulb's
// terminal: above the incision when there is no easing, and on the neck itself
// once there is. Publishing both would put two of them a few units apart.
function rebuildTrimmedSide(sidePoints, crossingInfo, { smooth, addressable = false }) {
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
  if (addressable && isCubic && crossingOnCurve._provenance) {
    crossingOnCurve._provenance.constructionSegment = segmentPoints.map((point) => ({
      x: point.x,
      y: point.y,
    }));
  }

  let rewrittenSegment;
  if (bezier) {
    const split = bezier.split(tCross);
    const kept = (fromEnd ? split.left : split.right).points.map((p) => ({
      x: p.x,
      y: p.y,
    }));
    // The rebuilt handles inherit the original handles' provenance in place, so
    // handle 1 keeps handle 1's address whichever end the cut came from.
    const splitHandle = (index) =>
      addressable
        ? withRoundCapProvenance(
            buildSplitOffCurve(kept[index], segmentPoints[index]),
            segmentPoints[index]
          )
        : buildSplitOffCurve(kept[index]);
    if (isCubic) {
      rewrittenSegment = fromEnd
        ? [
            cloneRoundCapPoint(segmentPoints[0]),
            splitHandle(1),
            splitHandle(2),
            crossingOnCurve,
          ]
        : [
            crossingOnCurve,
            splitHandle(1),
            splitHandle(2),
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

// The ball's frame at one cut on the outer edge, and the along-stroke radius the
// terminal pin allows there.
//
// `alongRadius` is how deep the ball may be before its furthest point along the
// outward tangent breaches the terminal plane. It is zero where the ball's
// lateral swell alone already breaches it, and it grows without bound as the
// edge turns square to the outward tangent, because there the ball's reach stops
// depending on its depth at all. `edgeAlignment` is that agreement, and it falls
// as the cut moves back.
function probeDropCapBallFrame({
  tangency,
  edgeTangent,
  endpoint,
  forward,
  lateralRadius,
}) {
  const ex = isUsableDirection(edgeTangent)
    ? vector.normalizeVector(edgeTangent)
    : forward;
  const ey = orientDirectionToward(
    vector.rotateVector90CW(ex),
    vector.subVectors(endpoint, tangency)
  );
  if (!isUsableDirection(ey)) {
    return null;
  }
  const center = {
    x: tangency.x + ey.x * lateralRadius,
    y: tangency.y + ey.y * lateralRadius,
  };
  const edgeAlignment = ex.x * forward.x + ex.y * forward.y;
  const lateralComponent = lateralRadius * (ey.x * forward.x + ey.y * forward.y);
  // How far the center sits behind the terminal plane, along the tangent.
  const room =
    (endpoint.x - center.x) * forward.x + (endpoint.y - center.y) * forward.y;
  // Ball extreme along `forward` is hypot(a * edgeAlignment, lateralComponent)
  // from the center; pin it to `room`.
  const alongRadius =
    Math.sqrt(Math.max(room * room - lateralComponent * lateralComponent, 0)) /
    Math.max(Math.abs(edgeAlignment), MIN_BALL_EDGE_ALIGNMENT);
  return { ex, ey, center, edgeAlignment, alongRadius };
}

// Choose where to cut the outer edge. The cut runs from the terminal backward on
// a normalized parameter, and the search returns the cut that delivers the ball
// the shape settings asked for.
//
// Two facts drive it. The edge's agreement with the outward tangent falls as the
// cut moves back, so the run of cuts where the edge still runs forward at all is
// bounded by one crossing. And within that run the allowed depth rises without
// bound toward the far end, because a ball attached where the edge has turned
// square reaches forward by its width alone whatever its depth.
//
// So the requested depth is a root, and the search bisects for it from the far
// end. Bisecting is what makes the cut move continuously with the skeleton. The
// discarded version tested whether a cut merely fit and took the first that did,
// which lands the flattest ball the geometry permits, and which flips to a
// different cut entirely when the test trips one sample earlier.
//
// Where every cut allows more depth than was asked for, the shallowest wins. The
// two answers meet exactly where they change over.
function searchDropCapTrim(frameAt, wantedAlongRadius) {
  // The deepest cut worth considering: past it the edge runs backward and a ball
  // hung off it is not on the stroke's end any more.
  let hi = 1;
  let previousAlignment = frameAt(0)?.edgeAlignment ?? 0;
  for (let i = 1; i <= DROP_CAP_TRIM_SCAN_STEPS; i++) {
    const s = i / DROP_CAP_TRIM_SCAN_STEPS;
    const alignment = frameAt(s)?.edgeAlignment ?? 0;
    if (alignment <= 0 && previousAlignment > 0) {
      let lo = (i - 1) / DROP_CAP_TRIM_SCAN_STEPS;
      hi = s;
      for (let step = 0; step < DROP_CAP_TRIM_BISECTION_STEPS; step++) {
        const mid = (lo + hi) / 2;
        if ((frameAt(mid)?.edgeAlignment ?? 0) > 0) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      hi = lo;
      break;
    }
    previousAlignment = alignment;
  }

  // Walk back from there to bracket the requested depth, and note the deepest
  // ball the run allows on the way. Scanning from the deep end picks the
  // crossing next to the unbounded one, which is the cut where the ball
  // genuinely sits in the bend.
  const radiusAt = (s) => frameAt(s)?.alongRadius ?? 0;
  const spacing = hi / DROP_CAP_TRIM_SCAN_STEPS;
  const deepestReach = radiusAt(hi);
  let best = { s: hi, alongRadius: deepestReach };
  let bracketLo = null;
  for (let i = DROP_CAP_TRIM_SCAN_STEPS - 1; i >= 0; i--) {
    const s = spacing * i;
    const alongRadius = radiusAt(s);
    if (alongRadius > best.alongRadius) {
      best = { s, alongRadius };
    }
    if (bracketLo === null && alongRadius < wantedAlongRadius) {
      bracketLo = s;
    }
  }

  if (deepestReach >= wantedAlongRadius) {
    if (bracketLo === null) {
      // Every cut on the run allows more depth than was asked for, so the
      // shallowest one wins and the ball is exactly the shape requested.
      return 0;
    }
    let lo = bracketLo;
    for (let step = 0; step < DROP_CAP_TRIM_BISECTION_STEPS; step++) {
      const mid = (lo + hi) / 2;
      if (radiusAt(mid) < wantedAlongRadius) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return hi;
  }

  // No cut on the run allows the requested depth, so the deepest ball available
  // wins. Refining between the samples either side of the best one is what keeps
  // this moving continuously: the best sample alone steps from grid line to grid
  // line. The two answers meet where the deepest available reaches the request.
  if (!(best.alongRadius > 0)) {
    return null;
  }
  let lo = Math.max(best.s - spacing, 0);
  let high = Math.min(best.s + spacing, hi);
  for (let step = 0; step < DROP_CAP_TRIM_BISECTION_STEPS; step++) {
    const third = (high - lo) / 3;
    if (radiusAt(lo + third) < radiusAt(high - third)) {
      lo += third;
    } else {
      high -= third;
    }
  }
  return (lo + high) / 2;
}

// Place the ball: trim the outer edge back, sit the ball tangent to it there,
// and pick the along-stroke radius so the ball's furthest point along the
// outward tangent lands exactly on the terminal plane — the line through the
// endpoint that a butt cap sits on. That is what keeps a drop cap from
// lengthening the stroke.
//
// On a straight terminal the along-radius is just the trim distance. On a curved
// one the edge tangent has rotated away from the outward tangent, so the ball's
// lateral swell reaches forward too and the trim has to go back further to pay
// for it. How much further is what the search decides.
//
// Returns { split, tangency, ball } or null when no cut on the terminal segment
// leaves room for a ball at all.
function solveDropCapBallOnTerminal({
  outerSideArr,
  position,
  endpoint,
  forward,
  lateralRadius,
  wantedAlongRadius,
  maxTrimDistance,
}) {
  const terminalSegment = getRoundCapTerminalSegment(outerSideArr, position);
  if (!terminalSegment) {
    return null;
  }
  const fromEnd = position === "end";
  const { segmentPoints } = terminalSegment;
  const isCubic = segmentPoints.length === 4;
  const bezier = isCubic ? createBezierFromPoints(segmentPoints) : null;

  // A cubic edge is searched in its own parameter, which costs a point and a
  // derivative per probe. Resolving a trim distance instead costs a bisection
  // over arc length per probe, and the search does not need one until it has
  // chosen. A straight edge has no such distinction and is searched by distance.
  let frameAt;
  let cutAt;
  if (bezier) {
    const nearT = solveTerminalSplitForDistance(bezier, fromEnd, MIN_BALL_TRIM);
    const farT = solveTerminalSplitForDistance(bezier, fromEnd, maxTrimDistance);
    const paramAt = (s) => nearT + (farT - nearT) * s;
    frameAt = (s, radius) => {
      const splitT = paramAt(s);
      const point = bezier.get(splitT);
      const derivative = bezier.derivative(splitT);
      const direction = vector.normalizeVector({
        x: derivative.x,
        y: derivative.y,
      });
      if (!isUsableDirection(direction)) {
        return null;
      }
      return probeDropCapBallFrame({
        tangency: { x: point.x, y: point.y },
        edgeTangent: fromEnd ? direction : { x: -direction.x, y: -direction.y },
        endpoint,
        forward,
        lateralRadius: radius,
      });
    };
    cutAt = (s) =>
      splitTerminalSideAtT(
        outerSideArr,
        position,
        terminalSegment,
        bezier,
        paramAt(s),
        { fallbackDirection: forward }
      );
  } else {
    const trimAt = (s) => MIN_BALL_TRIM + (maxTrimDistance - MIN_BALL_TRIM) * s;
    const splitAt = (s) =>
      splitTerminalSideForRoundCap(outerSideArr, position, trimAt(s), {
        endpointTangent: forward,
        capTangent: forward,
      });
    frameAt = (s, radius) => {
      const split = splitAt(s);
      if (!split?.insertedPoint) {
        return null;
      }
      return probeDropCapBallFrame({
        tangency: split.insertedPoint,
        edgeTangent: split.tangentToEndpoint,
        endpoint,
        forward,
        lateralRadius: radius,
      });
    };
    cutAt = splitAt;
  }

  // The width the ball is asked for can be more than the terminal will hold. A
  // ball whose sideways swell alone already passes the terminal plane has no
  // depth that satisfies the pin, at any cut. Narrowing it until one cut does is
  // what keeps a bulb on the stroke. Refusing instead drops the terminal to a
  // plain cap, which is a bulb vanishing partway along the ratio slider.
  let radius = lateralRadius;
  let chosen = searchDropCapTrim((s) => frameAt(s, radius), wantedAlongRadius);
  if (chosen === null) {
    let tooWide = lateralRadius;
    let fits = 0;
    for (let step = 0; step < DROP_CAP_TRIM_BISECTION_STEPS; step++) {
      const mid = (fits + tooWide) / 2;
      if (searchDropCapTrim((s) => frameAt(s, mid), wantedAlongRadius) === null) {
        tooWide = mid;
      } else {
        fits = mid;
      }
    }
    if (!(fits > 0.001)) {
      return null;
    }
    radius = fits;
    chosen = searchDropCapTrim((s) => frameAt(s, radius), wantedAlongRadius);
    if (chosen === null) {
      return null;
    }
  }
  const split = cutAt(chosen);
  if (!split?.insertedPoint) {
    return null;
  }
  // Measure the frame again on the cut that will actually be emitted. The two
  // agree except where the cut lands within a unit of the endpoint and the split
  // substitutes a synthesized point, which is far from anything the search picks.
  const frame = probeDropCapBallFrame({
    tangency: split.insertedPoint,
    edgeTangent: split.tangentToEndpoint,
    endpoint,
    forward,
    lateralRadius: radius,
  });
  if (!frame) {
    return null;
  }
  // Never deeper than the shape asked for. The search put the cut where the two
  // agree; the cap only bites where the whole edge allows more than was wanted.
  const alongRadius = Math.min(frame.alongRadius, wantedAlongRadius);
  return {
    split,
    tangency: split.insertedPoint,
    ball: makeDropCapBall(
      frame.center,
      frame.ex,
      frame.ey,
      Math.max(alongRadius, 1),
      radius
    ),
  };
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
  capBallEasing,
  capBallEaseCurvature,
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
  const innerSideName = outerSide === "left" ? "right" : "left";

  // capBallShape stretches the ball backward along the stroke only: it sets the
  // along-stroke radius the ball is asked for. The cut has to stay on the outer
  // side's terminal segment, so a short terminal segment caps how elongated the
  // ball can get.
  const shape = clampCapBallShape(capBallShape);
  const outerTerminalLength = getTerminalSegmentLength(outerSideArr, position);
  const wantedAlongRadius = lateralRadius * (1 + shape * BALL_SHAPE_ELONGATION);

  // Cut the outer edge back far enough to deliver that radius; the ball is
  // tangent to the edge at the inserted point and its tip lands back on the
  // terminal.
  const solved = solveDropCapBallOnTerminal({
    outerSideArr,
    position,
    endpoint,
    forward,
    lateralRadius,
    wantedAlongRadius,
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

  const easing = clampCapBallEasing(capBallEasing);
  const easeCurvature = clampCapBallEaseCurvature(capBallEaseCurvature);

  // Where the ball meets the inner edge (the arc ends there). When the ball is
  // too small to reach the inner edge, bridge to the inner terminal instead.
  const ballCross = findSideBallCrossing(innerSideArr, position, (point) =>
    ball.contains(point)
  );

  // Easing slides the neck's far end back along the inner edge, so the stroke
  // edge peels away earlier and eases into the ball instead of meeting it at a
  // notch. The far end is placed directly at its fraction of the run, which is
  // what lets the value be aimed: an earlier version grew a second, inflated
  // ball and took whatever crossing that happened to make, and no reading of the
  // number told you where the neck would land.
  const easedCross =
    ballCross && easing > 0 ? crossingAtEasing(ballCross, easing) : null;

  let trimmedInnerSide;
  let thetaInner;
  let mode;
  let innerTrim = null;
  if (easedCross) {
    trimmedInnerSide = rebuildTrimmedSide(innerSideArr, easedCross, { smooth: true });
    innerTrim = easedCross.crossing;
    thetaInner = ball.thetaOf(ballCross.crossing);
    mode = "soft";
  } else if (ballCross) {
    trimmedInnerSide = rebuildTrimmedSide(innerSideArr, ballCross, {
      smooth: false,
      addressable: true,
    });
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
    mode === "soft" ? easing * Math.min(0.35 * sweep, MAX_NECK_ARC_BACKOFF) : 0;
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
      easedCross.crossingTangent ?? ex,
      vector.subVectors(ballAttach, innerTrim)
    );
    const chord = vector.distance(ballAttach, innerTrim);
    const neckLengths = computeTunniHandleLengths(
      ballAttach,
      sweepTangent,
      innerTrim,
      innerTangent,
      easeCurvature
    );
    const clampNeckLen = (value) =>
      Math.min(
        Math.max(Number.isFinite(value) ? value : NECK_HANDLE_FRACTION * chord, 0),
        chord
      );
    capForwardToInner = [
      ...arc,
      withNeckProvenance(
        dropCapHandle({
          x: ballAttach.x + sweepTangent.x * clampNeckLen(neckLengths.startLen),
          y: ballAttach.y + sweepTangent.y * clampNeckLen(neckLengths.startLen),
        }),
        endpoint,
        innerSideName,
        "out"
      ),
      withNeckProvenance(
        dropCapHandle({
          x: innerTrim.x + innerTangent.x * clampNeckLen(neckLengths.endLen),
          y: innerTrim.y + innerTangent.y * clampNeckLen(neckLengths.endLen),
        }),
        endpoint,
        innerSideName,
        "in"
      ),
    ];
    // The arc's last on-curve is the neck's own start. It needs an address for
    // the segment walk to see the neck at all; the walk takes a segment only
    // when all four of its points carry one.
    withNeckProvenance(arc[arc.length - 1], endpoint, innerSideName, "onCurve");
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
      easeCurvature
    );
    const clampNeckLen = (value) =>
      Math.min(Math.max(Number.isFinite(value) ? value : 0.4 * chord, 0), 0.6 * chord);
    capForwardToInner = [
      ...arc,
      withNeckProvenance(
        dropCapHandle({
          x: neckPoint.x + ballTangent.x * clampNeckLen(neckLengths.startLen),
          y: neckPoint.y + ballTangent.y * clampNeckLen(neckLengths.startLen),
        }),
        endpoint,
        innerSideName,
        "out"
      ),
      withNeckProvenance(
        dropCapHandle({
          x: innerTerminal.x + innerTangent.x * clampNeckLen(neckLengths.endLen),
          y: innerTerminal.y + innerTangent.y * clampNeckLen(neckLengths.endLen),
        }),
        endpoint,
        innerSideName,
        "in"
      ),
    ];
    withNeckProvenance(arc[arc.length - 1], endpoint, innerSideName, "onCurve");
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

export { SERIF_HALF_ZEROS as SERIF_HALF_DEFAULTS };

const SERIF_LENGTH_FIELDS = new Set([
  "wingLength",
  "tipThickness",
  "wingSlope",
  "reach",
  "easeDistance",
]);

function resolveSerifHalf(pointSerif, side, context = {}) {
  const scale = context.unitsMode === "normalized" ? context.strokeWidth : 1;
  const resolved = {};
  for (const field of Object.keys(SERIF_HALF_ZEROS)) {
    const value = pointSerif?.[side]?.[field] ?? 0;
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
  ownerPoint,
  serifUnitsMode,
}) {
  const outward = vector.normalizeVector(tangent);
  if (!isUsableDirection(outward)) return null;
  const frame = computeSerifFrame({
    endpoint,
    tangent: outward,
    normal,
    axisMode: pointSerif?.axisMode ?? "perpendicular",
    axisAngle: pointSerif?.axisAngle ?? 0,
  });
  const unitsContext = {
    unitsMode: serifUnitsMode,
    strokeWidth: leftHalfWidth + rightHalfWidth,
  };
  const lengthScale =
    unitsContext.unitsMode === "normalized" ? unitsContext.strokeWidth : 1;
  // A side the terminal is not built on draws no shape. It still emits every
  // one of its points, all of them at zero, which is what keeps a one-winged
  // serif interpolable against a two-winged one.
  const sides = pointSerif?.sides;
  const builtOnSide = (side) =>
    sides !== "left" && sides !== "right" ? true : sides === side;
  const resolveHalfForSide = (side) =>
    builtOnSide(side)
      ? resolveSerifHalf(pointSerif, side, unitsContext)
      : { ...SERIF_HALF_ZEROS };
  const left = resolveHalfForSide("left");
  const right = resolveHalfForSide("right");
  // The wall, in frame coordinates, running from the rib end into the stroke.
  // A terminal may only consume its own segment, and the wall's own maximum
  // depth is what states that: the serif clamps its reach and ease against it.
  // An end terminal's side points run the other way, so its segment is reversed.
  const wallForSide = (sidePoints) => {
    const terminalSegment = getRoundCapTerminalSegment(sidePoints, position);
    if (!terminalSegment) return null;
    const ordered =
      position === "end"
        ? [...terminalSegment.segmentPoints].reverse()
        : terminalSegment.segmentPoints;
    return makeSerifWall(ordered.map((point) => frame.toFrame(point)));
  };
  const leftWall = wallForSide(leftSide);
  const rightWall = wallForSide(rightSide);
  if (!leftWall || !rightWall) return null;

  const terminal = buildSerifTerminal({
    frame,
    leftWall,
    rightWall,
    left,
    right,
    undersideCup: (pointSerif?.undersideCup ?? 0) * lengthScale,
    // A fraction of the foot's own span, so the units mode does not touch it.
    undersideCupTension: pointSerif?.undersideCupTension,
    undersideCupBalance: pointSerif?.undersideCupBalance,
  });

  // The release sits ON the wall, so the split lands on it and the surviving
  // piece is a slice of the curve the generator solved. Nothing is dragged onto
  // a target and no handle is turned: the old anchoring existed only because
  // the release was placed off the wall, and bending the wall back to it is
  // what let tip thickness reshape the stem.
  const fallbackDirections = { endpointTangent: outward, capTangent: outward };
  const leftSplit = splitTerminalSideAtParameter(
    leftSide,
    position,
    terminal.halves.left.releaseParameter,
    fallbackDirections
  );
  const rightSplit = splitTerminalSideAtParameter(
    rightSide,
    position,
    terminal.halves.right.releaseParameter,
    fallbackDirections
  );
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
    depthClamped:
      terminal.halves.left.depthClamped || terminal.halves.right.depthClamped,
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
