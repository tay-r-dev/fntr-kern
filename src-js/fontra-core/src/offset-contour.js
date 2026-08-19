import { Bezier } from "bezier-js";
import { normalizeVector, rotateVector90CW, subVectors } from "./vector.js";

// Contour geometry that reads no skeleton field: the segment walk, the per-point
// normal, and the rule that decides which on-curves must travel together. The
// skeleton layers its own concerns on top of these — the rib tied-flag opt-out,
// the serif terminals, and the per-point rib-angle override — and shares the
// construction itself, so there is one copy of it (rail R-B).

export function buildContourSegments(points, closed) {
  const segments = [];
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  if (onCurveIndices.length < 2) {
    return segments;
  }
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    segments.push(makeSegment(points, onCurveIndices[i], onCurveIndices[i + 1]));
  }
  if (closed) {
    const lastIdx = onCurveIndices[onCurveIndices.length - 1];
    const firstIdx = onCurveIndices[0];
    segments.push(makeWrappingSegment(points, lastIdx, firstIdx));
  }
  return segments;
}

/**
 * Is this on-curve point a smooth point whose only handle sits on `curveSegment`,
 * with a straight segment on the other side?
 *
 * Such a point cannot take its direction from its own handle: smoothness means
 * the handle has to be colinear with the straight segment, so the straight sets
 * the direction and the handle follows. Shared by contour generation and by rib
 * rendering/hit-testing, which must agree.
 * @param {Object} point - The shared on-curve point
 * @param {Object} straightSegment - The segment with no control points
 * @param {Object} curveSegment - The segment carrying the point's one handle
 * @returns {boolean}
 */
export function isStraightControlledSmoothPoint(point, straightSegment, curveSegment) {
  return (
    point?.smooth === true &&
    straightSegment?.controlPoints.length === 0 &&
    curveSegment?.controlPoints.length > 0
  );
}

/**
 * Does this segment couple the points at its two ends to a shared offset?
 *
 * It does when it is a straight carrying at least one straight-controlled smooth
 * point (above). Such a point's normal is perpendicular to the straight, and the
 * generated handle leaving it stays colinear with the projected straight to keep
 * the outline smooth — so unless the far end sits at the same offset, the
 * projected straight tilts and takes the handle with it. One such point anywhere
 * on the straight is enough: the whole projected straight has to move as a unit.
 *
 * It also does when a straight ends on a point the caller has named as forcing
 * the coupling. The skeleton passes its serif terminals there: a serif sits on
 * the end of a straight run of stem, and that run is one wall with one thickness.
 *
 * Either end may opt out through `isCoupled`, which frees the segment.
 * @param {Object} segment - Candidate segment
 * @param {Object} prevSegment - Segment before it, or null
 * @param {Object} nextSegment - Segment after it, or null
 * @param {Function} isCoupled - Reads a point's opt-out flag
 * @param {Set} forcedCouplingPoints - Points that couple a straight they end
 * @returns {boolean}
 */
function couplesItsEnds(
  segment,
  prevSegment,
  nextSegment,
  isCoupled,
  forcedCouplingPoints
) {
  const startPoint = segment?.startPoint;
  const endPoint = segment?.endPoint;
  if (!startPoint || !endPoint || startPoint === endPoint) {
    return false;
  }
  if (!isCoupled(startPoint) || !isCoupled(endPoint)) {
    return false;
  }
  if (
    segment.controlPoints.length === 0 &&
    (forcedCouplingPoints.has(startPoint) || forcedCouplingPoints.has(endPoint))
  ) {
    return true;
  }
  return (
    isStraightControlledSmoothPoint(startPoint, segment, prevSegment) ||
    isStraightControlledSmoothPoint(endPoint, segment, nextSegment)
  );
}

/**
 * On-curve points whose offsets must be shared, keyed by point. Each value is the
 * whole group, the key point included; points that are free are absent.
 *
 * The rule is per straight segment (above); segments that share an end point
 * merge, because that shared point has one position and cannot sit at two
 * offsets at once. This is the single definition of the coupling — the generator
 * resolves widths through it, rendering and hit-testing read it back through
 * getTiedRibGroup, and the base-curve drag expands its selection through it.
 * @param {Array} segments - The contour's segments, in order
 * @param {boolean} isClosed - Whether the contour is closed
 * @param {Function} isCoupled - Reads a point's opt-out flag; defaults to always coupled
 * @param {Set} forcedCouplingPoints - Points that couple a straight they end
 * @returns {Map} point -> array of points
 */
export function collectCoupledPointGroups(
  segments,
  isClosed,
  isCoupled = () => true,
  forcedCouplingPoints = new Set()
) {
  const groupByPoint = new Map();
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const prevSegment =
      isClosed || i > 0 ? segments[(i - 1 + segments.length) % segments.length] : null;
    const nextSegment =
      isClosed || i < segments.length - 1 ? segments[(i + 1) % segments.length] : null;
    if (
      !couplesItsEnds(
        segment,
        prevSegment,
        nextSegment,
        isCoupled,
        forcedCouplingPoints
      )
    ) {
      continue;
    }
    const group = [];
    for (const point of [
      ...(groupByPoint.get(segment.startPoint) || [segment.startPoint]),
      ...(groupByPoint.get(segment.endPoint) || [segment.endPoint]),
    ]) {
      if (!group.includes(point)) {
        group.push(point);
      }
    }
    for (const point of group) {
      groupByPoint.set(point, group);
    }
  }
  return groupByPoint;
}

/**
 * The normal for a point whose direction comes from a straight segment:
 * perpendicular to that segment, with no miter averaging against the handle.
 * @param {Object} straightSegment - The straight segment setting the direction
 * @returns {Object} Normal {x, y}
 */
export function straightSegmentNormal(straightSegment) {
  return rotateVector90CW(
    normalizeVector(subVectors(straightSegment.endPoint, straightSegment.startPoint))
  );
}

/**
 * The outward-ish normal at an on-curve point of any contour: the CW rotation of
 * the miter bisector of its two segment directions. A smooth point carrying a
 * single handle has no direction of its own — the straight on its other side
 * sets one — so its normal is perpendicular to that straight instead.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {number} pointIndex - Index of the on-curve point
 * @returns {Object} Normal {x, y}
 */
export function calculateContourNormalAtPoint(points, closed, pointIndex) {
  if (!points || points.length < 2) {
    return { x: 0, y: 1 };
  }
  const point = points[pointIndex];
  if (!point || point.type) {
    return { x: 0, y: 1 };
  }

  const segments = buildContourSegments(points, closed);
  let incomingSegment = null;
  let outgoingSegment = null;
  for (const segment of segments) {
    if (segment.endPoint === point) {
      incomingSegment = segment;
    }
    if (segment.startPoint === point) {
      outgoingSegment = segment;
    }
  }

  const dir1 = incomingSegment ? segmentEndDirection(incomingSegment) : null;
  const dir2 = outgoingSegment ? segmentStartDirection(outgoingSegment) : null;

  if (!dir1 && dir2) {
    return rotateVector90CW(dir2);
  }
  if (dir1 && !dir2) {
    return rotateVector90CW(dir1);
  }
  if (!dir1 && !dir2) {
    return { x: 0, y: 1 };
  }

  if (isStraightControlledSmoothPoint(point, incomingSegment, outgoingSegment)) {
    return straightSegmentNormal(incomingSegment);
  }
  if (isStraightControlledSmoothPoint(point, outgoingSegment, incomingSegment)) {
    return straightSegmentNormal(outgoingSegment);
  }

  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;
  const halfAngle = Math.atan2(cross, dot) / 2;
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);
  const bisector = normalizeVector({
    x: dir1.x * cosH - dir1.y * sinH,
    y: dir1.x * sinH + dir1.y * cosH,
  });
  return rotateVector90CW(bisector);
}

function makeSegment(points, startIdx, endIdx) {
  return {
    startPoint: points[startIdx],
    endPoint: points[endIdx],
    controlPoints: points.slice(startIdx + 1, endIdx).filter((point) => point.type),
  };
}

function makeWrappingSegment(points, lastIdx, firstIdx) {
  return {
    startPoint: points[lastIdx],
    endPoint: points[firstIdx],
    controlPoints: [
      ...points.slice(lastIdx + 1).filter((point) => point.type),
      ...points.slice(0, firstIdx).filter((point) => point.type),
    ],
  };
}

function segmentStartDirection(segment) {
  if (!segment.controlPoints.length) {
    return normalizeVector(subVectors(segment.endPoint, segment.startPoint));
  }
  const bezier = createBezierFromSegment(segment);
  const deriv = bezier.derivative(0);
  return normalizeVector({ x: deriv.x, y: deriv.y });
}

function segmentEndDirection(segment) {
  if (!segment.controlPoints.length) {
    return normalizeVector(subVectors(segment.endPoint, segment.startPoint));
  }
  const bezier = createBezierFromSegment(segment);
  const deriv = bezier.derivative(1);
  return normalizeVector({ x: deriv.x, y: deriv.y });
}

function createBezierFromSegment(segment) {
  return new Bezier(segment.startPoint, ...segment.controlPoints, segment.endPoint);
}
