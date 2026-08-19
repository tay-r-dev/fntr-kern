import { Bezier } from "bezier-js";
import { offsetCubicSide } from "./offset-cubic.js";
import {
  normalizeVector,
  rotateVector90CW,
  subVectors,
  vectorLength,
} from "./vector.js";

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

// A corner cannot both travel the offset distance and leave its two edges at
// that distance: its normal splits the corner, so travelling along it moves each
// edge by only the cosine of half the turn. The corner must travel the miter
// length instead, which is the distance divided by that cosine. A smooth point's
// two directions agree, so its factor is exactly 1.
//
// The bound is what a cusp needs. Two segments doubling back have no miter at
// all — the cosine goes to zero and the factor to infinity — so past this much
// the corner is held and its edges fall short instead of the point leaving the
// glyph. It is the standard miter limit, and it is the only limit in this drag.
const MITER_TRAVEL_LIMIT = 4;

/**
 * How far a point must travel along its own normal for its two edges to end up
 * at the offset distance.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {number} pointIndex - Index of the on-curve point
 * @returns {number} The multiplier, between 1 and the miter limit
 */
export function miterTravelFactor(points, closed, pointIndex) {
  const point = points?.[pointIndex];
  if (!point || point.type) {
    return 1;
  }
  const segments = buildContourSegments(points, closed);
  let incomingSegment = null;
  let outgoingSegment = null;
  for (const segment of segments) {
    if (segment.endPoint === point) incomingSegment = segment;
    if (segment.startPoint === point) outgoingSegment = segment;
  }
  if (!incomingSegment || !outgoingSegment) {
    return 1;
  }
  const dir1 = segmentEndDirection(incomingSegment);
  const dir2 = segmentStartDirection(outgoingSegment);
  if (!dir1 || !dir2) {
    return 1;
  }
  const dot = dir1.x * dir2.x + dir1.y * dir2.y;
  const cross = dir1.x * dir2.y - dir1.y * dir2.x;
  const halfTurn = Math.atan2(cross, dot) / 2;
  const cosHalfTurn = Math.abs(Math.cos(halfTurn));
  if (!(cosHalfTurn > 1 / MITER_TRAVEL_LIMIT)) {
    return MITER_TRAVEL_LIMIT;
  }
  return 1 / cosHalfTurn;
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

/**
 * Move each listed on-curve along its own normal and rebuild the handles of every
 * segment that has an end moving, so each affected segment stays an offset of
 * itself — a constant-distance one where both ends move, a tapered one where one
 * does. Handle directions are preserved and their lengths scale by 1 + d·kappa,
 * the generator's own construction.
 * @param {Array} points - Original points, read-only
 * @param {boolean} closed - Whether the contour is closed
 * @param {Map} offsetsByIndex - Point index -> signed distance along its normal
 * @param {Array} workingPoints - Points to mutate, same length as `points`
 * @param {Object} options - `round`, `normalAt` to override the normal, and
 *   `rebuildHandles` to move the on-curves and leave the handles alone
 * @returns {boolean} Whether anything moved
 */
export function offsetContourAlongNormals(
  points,
  closed,
  offsetsByIndex,
  workingPoints,
  {
    round = Math.round,
    normalAt = null,
    rebuildHandles = true,
    miterCorrectTravel = false,
  } = {}
) {
  const pointDeltas = new Map();
  const pointOffsets = new Map();
  let changed = false;
  for (const [pointIndex, offset] of offsetsByIndex) {
    const original = points[pointIndex];
    const working = workingPoints?.[pointIndex];
    if (!original || !working || original.type) continue;
    const normal = normalAt
      ? normalAt(pointIndex)
      : calculateContourNormalAtPoint(points, closed, pointIndex);
    // The travel and the offset distance are two numbers at a corner. The
    // handle rebuild wants the offset distance, because that is what the
    // segment is moving by; the point wants the miter length, because that is
    // what puts its two edges there.
    const travel = miterCorrectTravel
      ? offset * miterTravelFactor(points, closed, pointIndex)
      : offset;
    const delta = { x: normal.x * travel, y: normal.y * travel };
    pointDeltas.set(pointIndex, delta);
    pointOffsets.set(pointIndex, offset);
    working.x = round(original.x + delta.x);
    working.y = round(original.y + delta.y);
    changed = true;
  }
  if (rebuildHandles && pointDeltas.size) {
    offsetSegmentHandles(
      points,
      closed,
      workingPoints,
      pointDeltas,
      pointOffsets,
      round
    );
  }
  return changed;
}

// Every moved on-curve travels the same distance along its own normal, so an
// affected segment is a constant-distance offset of itself — or a tapered one
// where only one of its ends moved. Both are what the outline generator already
// constructs, so the drag runs the same construction: handle directions are
// preserved and their lengths scale by 1 + d·kappa.
//
// Displacing the handles by an interpolation of the two endpoint deltas instead
// shears the segment, because it can never lengthen a handle. On a quarter arc of
// radius 100 pushed out 20 units the middle of the curve came up 6 units short of
// its ends, which is the curvature loss the whole tool is supposed to avoid.
function offsetSegmentHandles(
  points,
  closed,
  workingPoints,
  pointDeltas,
  pointOffsets,
  round
) {
  const onCurveIndices = points
    .map((point, index) => (point?.type ? null : index))
    .filter((index) => index !== null);
  const segmentCount = closed ? onCurveIndices.length : onCurveIndices.length - 1;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const startIndex = onCurveIndices[segmentIndex];
    const endIndex = onCurveIndices[(segmentIndex + 1) % onCurveIndices.length];
    const startMoved = pointDeltas.has(startIndex);
    const endMoved = pointDeltas.has(endIndex);
    if (!startMoved && !endMoved) continue;
    const controlIndices = getControlPointIndicesBetween(
      points,
      startIndex,
      endIndex,
      closed
    );
    if (!controlIndices.length) continue;
    if (
      controlIndices.length !== 2 ||
      !rebuildSegmentHandles(
        points,
        workingPoints,
        startIndex,
        endIndex,
        controlIndices,
        startMoved ? pointOffsets.get(startIndex) || 0 : 0,
        endMoved ? pointOffsets.get(endIndex) || 0 : 0,
        round
      )
    ) {
      // A segment with a single handle has no second length to receive, and a
      // degenerate one has no direction to keep. Carry those along with the
      // endpoints instead, which at least holds their relative position.
      carrySegmentHandles(
        points,
        workingPoints,
        controlIndices,
        pointDeltas.get(startIndex),
        pointDeltas.get(endIndex),
        round
      );
    }
  }
}

function rebuildSegmentHandles(
  points,
  workingPoints,
  startIndex,
  endIndex,
  controlIndices,
  d0,
  d3,
  round
) {
  const p0 = points[startIndex];
  const p3 = points[endIndex];
  const p1 = points[controlIndices[0]];
  const p2 = points[controlIndices[1]];
  const q0 = workingPoints?.[startIndex];
  const q3 = workingPoints?.[endIndex];
  const handle1 = workingPoints?.[controlIndices[0]];
  const handle2 = workingPoints?.[controlIndices[1]];
  if (!p0 || !p1 || !p2 || !p3 || !q0 || !q3 || !handle1 || !handle2) return false;
  const u0 = normalizeVector(subVectors(p1, p0));
  const u1 = normalizeVector(subVectors(p2, p3));
  if (!vectorLength(u0) || !vectorLength(u1)) return false;
  const { startLength, endLength } = offsetCubicSide({
    p0,
    p1,
    p2,
    p3,
    d0,
    d3,
    q0,
    q3,
    u0,
    u1,
  });
  handle1.x = round(q0.x + u0.x * startLength);
  handle1.y = round(q0.y + u0.y * startLength);
  handle2.x = round(q3.x + u1.x * endLength);
  handle2.y = round(q3.y + u1.y * endLength);
  return true;
}

function carrySegmentHandles(
  points,
  workingPoints,
  controlIndices,
  startDelta,
  endDelta,
  round
) {
  for (let i = 0; i < controlIndices.length; i++) {
    const controlIndex = controlIndices[i];
    const originalPoint = points[controlIndex];
    const workingPoint = workingPoints?.[controlIndex];
    if (!originalPoint || !workingPoint) continue;
    const t = controlIndices.length === 1 ? 0.5 : i / (controlIndices.length - 1);
    workingPoint.x = round(
      originalPoint.x + interpolateDelta(startDelta?.x || 0, endDelta?.x || 0, t)
    );
    workingPoint.y = round(
      originalPoint.y + interpolateDelta(startDelta?.y || 0, endDelta?.y || 0, t)
    );
  }
}

function getControlPointIndicesBetween(points, startIndex, endIndex, closed) {
  const indices = [];
  let index = startIndex + 1;
  while (index !== endIndex) {
    if (index >= points.length) {
      if (!closed) break;
      index = 0;
      if (index === endIndex) break;
    }
    if (points[index]?.type) indices.push(index);
    index++;
  }
  return indices;
}

const interpolateDelta = (a, b, t) => a + (b - a) * t;

/**
 * Grow a set of on-curve indices to include every point coupled to one of them.
 * A segment carrying a tension point — a smooth on-curve with a single handle —
 * has no direction of its own, so moving one of its ends alone would rotate it
 * rather than offset it. Groups sharing a point merge, so the coupling chains.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {Set} pointIndices - Selected on-curve indices
 * @returns {Set} The expanded index set
 */
export function expandIndicesToCoupledGroups(points, closed, pointIndices) {
  const groupByPoint = collectCoupledPointGroups(
    buildContourSegments(points, closed),
    closed
  );
  const expanded = new Set(pointIndices);
  if (!groupByPoint.size) return expanded;
  for (const pointIndex of pointIndices) {
    for (const member of groupByPoint.get(points[pointIndex]) || []) {
      const memberIndex = points.indexOf(member);
      if (memberIndex >= 0) expanded.add(memberIndex);
    }
  }
  return expanded;
}

/**
 * The signed distance each affected on-curve travels for one frame of a base
 * expansion drag: the cursor's travel projected onto the clicked point's normal,
 * given to every point in the expanded selection.
 *
 * There is no floor. A base curve has no width to run out of, so an inward drag
 * follows the cursor as far as it is pushed and cusps where the offset distance
 * passes the local radius — ordinary outline geometry, and undoable.
 * @param {Array} points - The contour's points
 * @param {boolean} closed - Whether the contour is closed
 * @param {Set} selectedIndices - Selected on-curve indices in this contour
 * @param {number} clickedIndex - Index of the point under the cursor, or -1
 * @param {Object} delta - Cursor travel {x, y} since mousedown
 * @returns {Map} Point index -> signed distance
 */
export function computeContourExpandOffsets(
  points,
  closed,
  selectedIndices,
  clickedIndex,
  delta
) {
  const offsets = new Map();
  const clicked = points?.[clickedIndex];
  if (!clicked || clicked.type || !selectedIndices?.size) return offsets;
  const normal = calculateContourNormalAtPoint(points, closed, clickedIndex);
  if (!(Math.hypot(normal.x, normal.y) > 1e-6)) return offsets;
  const projected = delta.x * normal.x + delta.y * normal.y;
  for (const pointIndex of expandIndicesToCoupledGroups(
    points,
    closed,
    selectedIndices
  )) {
    if (points[pointIndex] && !points[pointIndex].type) {
      offsets.set(pointIndex, projected);
    }
  }
  return offsets;
}
