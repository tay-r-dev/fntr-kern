import {
  addVectors,
  distance,
  dotVector,
  intersect,
  normalizeVector,
  subVectors,
} from "./vector.js";

// Grid Snap Utility Function
export function snapToGrid(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

// Private: infinite-line intersection carried from distance-angle.js so
// calculateSegmentTension matches the former local tension behavior.
function lineIntersection(p1, p2, p3, p4) {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x;
  const dy2 = p4.y - p3.y;
  const det = dx1 * dy2 - dy1 * dx2;
  const epsilon = 1e-10;
  if (Math.abs(det) < epsilon) {
    return null;
  }
  const dx3 = p1.x - p3.x;
  const dy3 = p1.y - p3.y;
  const t = (dy3 * dx2 - dx3 * dy2) / det;
  const intersection = { x: p1.x + t * dx1, y: p1.y + t * dy1 };
  intersection.t1 = t;
  intersection.t2 = (dx1 * dy3 - dy1 * dx3) / -det;
  return intersection;
}

// Single canonical Tunni tension source (D5). tau = 2(a*c) / (a*d + b*c)
// a=AC, b=AT, c=BD, d=BT, T = intersection of lines AC and BD.
export function calculateSegmentTension(
  offCurvePointA,
  onCurvePointA,
  offCurvePointB,
  onCurvePointB
) {
  const epsilon = 1e-10;
  const a = Math.hypot(
    offCurvePointA.x - onCurvePointA.x,
    offCurvePointA.y - onCurvePointA.y
  );
  if (Math.abs(a) < epsilon) {
    return 0;
  }
  const pointT = lineIntersection(
    onCurvePointA,
    offCurvePointA,
    onCurvePointB,
    offCurvePointB
  );
  if (!pointT) {
    return 0;
  }
  const b = Math.hypot(pointT.x - onCurvePointA.x, pointT.y - onCurvePointA.y);
  const c = Math.hypot(
    offCurvePointB.x - onCurvePointB.x,
    offCurvePointB.y - onCurvePointB.y
  );
  if (Math.abs(c) < epsilon) {
    return 0;
  }
  const d = Math.hypot(pointT.x - onCurvePointB.x, pointT.y - onCurvePointB.y);
  const numerator = 2 * (a * c);
  const denominator = a * d + b * c;
  if (Math.abs(denominator) < epsilon) {
    return 0;
  }
  return numerator / denominator;
}

export function calculateControlHandlePoint(segmentPoints) {
  // segmentPoints should be an array of 4 points: [start, control1, control2, end]
  if (segmentPoints.length !== 4) {
    throw new Error("Segment must have exactly 4 points");
  }

  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate a point along the line segment between the two control points (p2 and p3)
  // This is the midpoint by default, but can be adjusted as needed
  const tunniPoint = {
    x: (p2.x + p3.x) / 2,
    y: (p2.y + p3.y) / 2,
  };

  return tunniPoint;
}

/**
 * Calculate the true intersection-based Tunni point where rays from on-curve points intersect
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @returns {Object|null} The intersection point or null if lines are parallel
 */
export function calculateTunniPoint(segmentPoints) {
  // segmentPoints should be an array of 4 points: [start, control1, control2, end]
  if (segmentPoints.length !== 4) {
    throw new Error("Segment must have exactly 4 points");
  }

  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate unit vectors for the original directions
  const dir1 = normalizeVector(subVectors(p2, p1));
  const dir2 = normalizeVector(subVectors(p3, p4));

  // Calculate the intersection point of the lines along the fixed directions
  // This represents where the lines would intersect if extended infinitely
  const line1Start = p1;
  const line1End = addVectors(p1, dir1);
  const line2Start = p4;
  const line2End = addVectors(p4, dir2);

  // Calculate intersection of the lines along the fixed directions
  const intersection = intersect(line1Start, line1End, line2Start, line2End);

  return intersection;
}

/**
 * Calculate new control points based on a Tunni point and segment points.
 *
 * @param {Object} tunniPoint - The Tunni point that defines the desired curve shape
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @param {boolean} equalizeDistances - If true, makes additional distances beyond intersection point equal
 * @param {boolean} useArithmeticMean - If true, makes both control points distances an arithmetic mean of the original distances
 * @returns {Array} Array of 2 new control points
 */
export function calculateControlPointsFromTunni(
  tunniPoint,
  segmentPoints,
  equalizeDistances = false,
  useArithmeticMean = false,
  gridSnapEnabled = false
) {
  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate unit vectors for the original directions
  const dir1 = normalizeVector(subVectors(p2, p1));
  const dir2 = normalizeVector(subVectors(p3, p4));

  // Calculate the intersection point of the lines along the fixed directions
  // This represents where the lines would intersect if extended infinitely
  const line1Start = p1;
  const line1End = addVectors(p1, dir1);
  const line2Start = p4;
  const line2End = addVectors(p4, dir2);

  // Calculate intersection of the lines along the fixed directions
  const intersection = intersect(line1Start, line1End, line2Start, line2End);

  if (!intersection) {
    // Lines are parallel, return original control points
    return [p2, p3];
  }

  // Calculate original distances from on-curve points to off-curve points
  const origDist1 = distance(p1, p2);
  const origDist2 = distance(p4, p3);

  // If using arithmetic mean of original distances, calculate the mean
  let targetDist1 = origDist1;
  let targetDist2 = origDist2;

  if (useArithmeticMean) {
    const arithmeticMean = (origDist1 + origDist2) / 2;
    targetDist1 = arithmeticMean;
    targetDist2 = arithmeticMean;
  }

  // Calculate distances from on-curve points to the intersection point
  const distToIntersection1 = distance(p1, intersection);
  const distToIntersection2 = distance(p4, intersection);

  // Calculate distances from on-curve points to the new Tunni point
  const distToTunni1 = distance(p1, tunniPoint);
  const distToTunni2 = distance(p4, tunniPoint);

  // Calculate additional distances beyond the intersection point
  const additionalDist1 = distToTunni1 - distToIntersection1;
  const additionalDist2 = distToTunni2 - distToIntersection2;

  // If equalizing distances, make additional distances equal
  let finalAdditionalDist1 = additionalDist1;
  let finalAdditionalDist2 = additionalDist2;

  if (equalizeDistances) {
    const avgAdditionalDist = (additionalDist1 + additionalDist2) / 2;
    finalAdditionalDist1 = avgAdditionalDist;
    finalAdditionalDist2 = avgAdditionalDist;
  }

  // Calculate new distances along fixed direction vectors
  // The new distance is the target distance plus the (possibly equalized) additional distance
  const newDistance1 = targetDist1 + finalAdditionalDist1;
  const newDistance2 = targetDist2 + finalAdditionalDist2;

  // Calculate new control points along fixed direction vectors
  const newP2 = {
    x: p1.x + newDistance1 * dir1.x,
    y: p1.y + newDistance1 * dir1.y,
  };

  const newP3 = {
    x: p4.x + newDistance2 * dir2.x,
    y: p4.y + newDistance2 * dir2.y,
  };

  // Apply grid snapping if enabled
  if (gridSnapEnabled) {
    return [snapToGrid(newP2), snapToGrid(newP3)];
  }

  return [newP2, newP3];
}

/**
 * Calculate new control points with equalized tensions using arithmetic mean
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @returns {Array} Array of 2 new control points
 */
export function calculateEqualizedControlPoints(segmentPoints) {
  const [p1, p2, p3, p4] = segmentPoints;

  const pt = calculateTunniPoint(segmentPoints); // <- true Tunni point
  if (!pt) return [p2, p3];

  const dist1ToPt = distance(p1, pt);
  const dist4ToPt = distance(p4, pt);
  if (dist1ToPt <= 0 || dist4ToPt <= 0) return [p2, p3];

  // current tensions
  const t1 = distance(p1, p2) / dist1ToPt;
  const t2 = distance(p4, p3) / dist4ToPt;

  const targetTension = (t1 + t2) / 2;

  // directions are fixed
  const dir1 = normalizeVector(subVectors(p2, p1));
  const dir2 = normalizeVector(subVectors(p3, p4));

  // new distances to hit equal tension
  const newDist1 = targetTension * dist1ToPt;
  const newDist2 = targetTension * dist4ToPt;

  const newP2 = {
    x: p1.x + newDist1 * dir1.x,
    y: p1.y + newDist1 * dir1.y,
  };

  const newP3 = {
    x: p4.x + newDist2 * dir2.x,
    y: p4.y + newDist2 * dir2.y,
  };

  return [newP2, newP3];
}

export function balanceSegment(segmentPoints) {
  const tunniPoint = calculateTunniPoint(segmentPoints);
  if (!tunniPoint) {
    const [p1, p2, p3, p4] = segmentPoints;
    return [p1, p2, p3, p4]; // Can't balance if lines are parallel
  }

  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate distances
  const sDistance = distance(p1, tunniPoint);
  const eDistance = distance(p4, tunniPoint);

  // If either distance is zero, we can't balance
  if (sDistance <= 0 || eDistance <= 0) {
    return [p1, p2, p3, p4];
  }

  // Calculate percentages
  const xPercent = distance(p1, p2) / sDistance;
  const yPercent = distance(p3, p4) / eDistance;

  // Calculate average percentage
  const avgPercent = (xPercent + yPercent) / 2;

  // Calculate new control points
  const newP2 = {
    x: p1.x + avgPercent * (tunniPoint.x - p1.x),
    y: p1.y + avgPercent * (tunniPoint.y - p1.y),
  };

  const newP3 = {
    x: p4.x + avgPercent * (tunniPoint.x - p4.x),
    y: p4.y + avgPercent * (tunniPoint.y - p4.y),
  };

  return [p1, newP2, newP3, p4];
}

/**
 * Check if the distances of control points in a segment are already equalized
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @returns {boolean} - True if distances are already equalized, false otherwise
 */
export function areDistancesEqualized(segmentPoints) {
  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate distances from on-curve points to off-curve points
  const dist1 = distance(p1, p2);
  const dist2 = distance(p4, p3);

  // Check if distances are equal within a small tolerance
  const tolerance = 0.01; // Small tolerance for floating point comparison
  return Math.abs(dist1 - dist2) < tolerance;
}

export function areTensionsEqualized(segmentPoints, tolerance = 0.01) {
  const [p1, p2, p3, p4] = segmentPoints;
  const trueTunni = calculateTunniPoint(segmentPoints);
  if (!trueTunni) {
    return true;
  }
  const distStartToTunni = distance(p1, trueTunni);
  const distEndToTunni = distance(p4, trueTunni);
  if (distStartToTunni <= 0 || distEndToTunni <= 0) {
    return true;
  }
  const tension1 = distance(p1, p2) / distStartToTunni;
  const tension2 = distance(p4, p3) / distEndToTunni;
  return Math.abs(tension1 - tension2) < tolerance;
}

/**
 * Calculate the Euclidean distance between the two control points of a cubic segment
 * @param {Array} segmentPoints - Array of 4 points representing a cubic segment: [start, control1, control2, end]
 * @returns {number} The Euclidean distance between the two control points
 */
export function calculateControlHandleDistance(segmentPoints) {
  // Validate that the segment is cubic (4 points)
  if (!Array.isArray(segmentPoints) || segmentPoints.length !== 4) {
    throw new Error("Segment must be an array of exactly 4 points");
  }

  // Extract the control points (indices 1 and 2)
  const controlPoint1 = segmentPoints[1];
  const controlPoint2 = segmentPoints[2];

  // Validate that control points exist and have x,y coordinates
  if (
    !controlPoint1 ||
    !controlPoint2 ||
    typeof controlPoint1.x !== "number" ||
    typeof controlPoint1.y !== "number" ||
    typeof controlPoint2.x !== "number" ||
    typeof controlPoint2.y !== "number"
  ) {
    throw new Error("Control points must have valid x and y coordinates");
  }

  // Calculate and return the Euclidean distance between the control points
  return distance(controlPoint1, controlPoint2);
}

/**
 * Calculate new on-curve point positions based on a moved Tunni point.
 *
 * @param {Object} tunniPoint - The new Tunni point position
 * @param {Array} segmentPoints - Array of 4 points: [start, control1, control2, end]
 * @param {boolean} equalizeDistances - If true, makes distances from on-curve to Tunni point equal
 * @returns {Array} Array of 4 points with new on-curve positions
 */
export function calculateOnCurvePointsFromTunni(
  tunniPoint,
  segmentPoints,
  equalizeDistances = true,
  gridSnapEnabled = false
) {
  const [p1, p2, p3, p4] = segmentPoints;

  // Calculate unit vectors for the original directions (from on-curve to off-curve)
  const dir1 = normalizeVector(subVectors(p2, p1));
  const dir2 = normalizeVector(subVectors(p3, p4));

  // Calculate original distances from on-curve points to their respective off-curve points
  const origDist1 = distance(p1, p2);
  const origDist2 = distance(p4, p3);

  // Calculate distances from on-curve points to the new Tunni point
  const distToTunni1 = distance(p1, tunniPoint);
  const distToTunni2 = distance(p4, tunniPoint);

  // Calculate the ratio of original distance to distance to Tunni point for each on-curve point
  const ratio1 = origDist1 / distToTunni1;
  const ratio2 = origDist2 / distToTunni2;

  let finalRatio1, finalRatio2;

  if (equalizeDistances) {
    // Use average ratio to maintain equal distances
    const avgRatio = (ratio1 + ratio2) / 2;
    finalRatio1 = avgRatio;
    finalRatio2 = avgRatio;
  } else {
    // Use individual ratios to allow uncoupled distances
    finalRatio1 = ratio1;
    finalRatio2 = ratio2;
  }

  // Calculate new distances from Tunni point to on-curve points
  const newDist1 = distToTunni1 * finalRatio1;
  const newDist2 = distToTunni2 * finalRatio2;

  // Calculate new on-curve point positions along the fixed direction vectors
  // The new on-curve points are positioned along the opposite direction from Tunni point
  const newP1 = {
    x: tunniPoint.x - newDist1 * dir1.x,
    y: tunniPoint.y - newDist1 * dir1.y,
  };

  const newP4 = {
    x: tunniPoint.x - newDist2 * dir2.x,
    y: tunniPoint.y - newDist2 * dir2.y,
  };

  // Return with original control points unchanged
  if (gridSnapEnabled) {
    return [snapToGrid(newP1), p2, p3, snapToGrid(newP4)];
  }
  return [newP1, p2, p3, newP4];
}

//
// Tension algebra: a segment's tension is the harmonic mean of its handles'.
//
// With T the tangent intersection, b = |P1T| and d = |P4T| the two reaches and
// a, c the two handle lengths, the canonical tension above, tau = 2ac/(ad+bc),
// rewrites as 2*t1*t2/(t1+t2) for t1 = a/b and t2 = c/d — the harmonic mean,
// exactly. Verified against calculateSegmentTension to floating point.
//
// That identity splits a segment's two handle lengths into two quantities that
// do not interact: the MAGNITUDE, which is what the curvature gizmo sets and
// pins, and the SPLIT, which is what equalization moves. Because they are
// orthogonal, the generator can apply one after the other with no precedence
// rule between them.
//
// Everything below works in RECIPROCAL tension, where both operations are
// linear: the harmonic mean is 2/(r1+r2), so holding the mean fixed is holding
// r1+r2 fixed, and equalizing is sliding both reciprocals toward their average
// along that constraint. The mean therefore cannot drift by construction rather
// than by correction afterwards.
//

const TENSION_EPSILON = 1e-10;

// `handleTensions` used to live here: lengths over reaches, returning null where
// a reach was not ahead of its own on-curve point, so that its one caller could
// skip the whole shaping stage rather than substitute a guess. The offset
// construction now gives every end a reach that is finite and positive by
// definition (`feasibleBox` in offset-cubic.js), so there is no "no answer" case
// left to spell, and the caller that skipped is gone with it.

export function harmonicMeanTension(tensions) {
  const sum = tensions.start + tensions.end;
  return sum > TENSION_EPSILON ? (2 * tensions.start * tensions.end) / sum : 0;
}

// Move the two tensions `amount` of the way toward equal — 0 leaves them alone,
// 1 makes them equal — holding their harmonic mean exactly fixed.
export function equalizeTensions(tensions, amount) {
  const r1 = 1 / tensions.start;
  const r2 = 1 / tensions.end;
  const mid = (r1 + r2) / 2;
  return {
    start: 1 / (r1 + amount * (mid - r1)),
    end: 1 / (r2 + amount * (mid - r2)),
  };
}

// Shift both tensions by one shared increment, optionally saturating each end
// independently. Once one handle reaches its ceiling the other remains
// responsive until it reaches the same ceiling.
export function shiftTensions(tensions, increment, maxTension = Infinity) {
  return {
    start: Math.min(tensions.start + increment, Math.max(tensions.start, maxTension)),
    end: Math.min(tensions.end + increment, Math.max(tensions.end, maxTension)),
  };
}

// The shared increment that puts the harmonic mean at `target`.
//
// No closed form — the mean is a ratio of quadratics in the increment — but it
// is monotone in it and easily bracketed. With a finite ceiling, the upper
// bracket saturates both ends and the target is limited to that ceiling. Fixed
// trip count, no convergence test, the same continuity contract the rest of the
// generation path lives under.
const TENSION_SHIFT_STEPS = 40;

export function shiftTensionsToMean(tensions, target, maxTension = Infinity) {
  if (!Number.isFinite(target) || target < 0) {
    return tensions;
  }
  // Zero is the bottom of the shared shift, not "no mean stated": it puts the
  // shorter handle exactly on its point and leaves the longer one holding the
  // difference. The mean says nothing below that — it reads zero for every
  // length the survivor could have — so that is where the shift ends and a
  // per-handle displacement takes the survivor the rest of the way down.
  if (target <= TENSION_EPSILON) {
    return shiftTensions(tensions, -Math.min(tensions.start, tensions.end), maxTension);
  }
  const saturated = shiftTensions(tensions, Infinity, maxTension);
  target = Math.min(target, harmonicMeanTension(saturated));
  let low = -Math.min(tensions.start, tensions.end);
  let high = Number.isFinite(maxTension)
    ? Math.max(saturated.start - tensions.start, saturated.end - tensions.end)
    : target + Math.max(tensions.start, tensions.end);
  for (let step = 0; step < TENSION_SHIFT_STEPS; step++) {
    const middle = (low + high) / 2;
    if (harmonicMeanTension(shiftTensions(tensions, middle, maxTension)) < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return shiftTensions(tensions, (low + high) / 2, maxTension);
}

//
// The curvature gizmo: "make this curve fuller or flatter".
//
// Do not confuse it with calculateControlHandlePoint above. That one anchors on
// the midpoint of the two HANDLES and is dragged along a fixed 45-degree vector.
// This one anchors on the CURVE and is dragged along the ray toward the true
// Tunni point, which is the direction the curve actually swells in. What the two
// share — moving both tensions by the same amount — lives in
// calculateControlPointsFromCurvatureDelta and is the part worth reusing.
//

const CURVATURE_EPSILON = 1e-10;

// Where the gizmo sits: the curve at t = 0.5. Writing the Bernstein weights out
// rather than reaching for a general evaluator, because half is the only
// parameter this control ever needs.
export function calculateCurvatureGizmoPoint(segmentPoints) {
  const [p1, p2, p3, p4] = segmentPoints;
  return {
    x: (p1.x + 3 * p2.x + 3 * p3.x + p4.x) / 8,
    y: (p1.y + 3 * p2.y + 3 * p3.y + p4.y) / 8,
  };
}

// Null when the two handle lines are parallel: there is no Tunni point to aim
// at, so the control has no axis and must not be offered.
export function calculateCurvatureGizmoAxis(segmentPoints) {
  const tunniPoint = calculateTunniPoint(segmentPoints);
  if (!tunniPoint) {
    return null;
  }
  const toTunni = subVectors(tunniPoint, calculateCurvatureGizmoPoint(segmentPoints));
  const reach = Math.hypot(toTunni.x, toTunni.y);
  if (!(reach > CURVATURE_EPSILON)) {
    return null;
  }
  return { x: toTunni.x / reach, y: toTunni.y / reach };
}

//
// Drag the curvature gizmo by `delta`. Returns the two new control points, or
// null where the control does not exist.
//
// Only the component along the axis counts — this is a one-degree-of-freedom
// control, and movement across the axis is discarded rather than interpreted.
//
// Both tensions change by the SAME amount, so their difference survives the
// drag through most of the range. That matters: a generated segment's two
// tensions differ when the skeleton is asymmetric, and that asymmetry is
// faithful — equalizing it measurably degrades the fit.
//
// Both tensions share the increment until one reaches 1. That end then
// saturates independently while the trailing handle continues to 1. This keeps
// the whole available range reachable without either handle crossing its
// tangent intersection.
//
// The ceiling never forces a REDUCTION. Construction reaches and handles are
// independent of an emitted on-curve nudge, so grabbing is a no-op and the
// ceiling only limits where a positive drag can go.
//
// `allowCollapse` opens the same behaviour at the floor: the shared shift ends
// when the shorter handle lands on its point, and past that the survivor keeps
// coming down alone until both sit on their points. It is off by default
// because a caller storing only the shared mean cannot describe that tail —
// the mean reads zero throughout it.
//
export function calculateControlPointsFromCurvatureDelta(
  delta,
  segmentPoints,
  { maxTension = 1, axisSegmentPoints = segmentPoints, allowCollapse = false } = {}
) {
  const axis = calculateCurvatureGizmoAxis(axisSegmentPoints);
  if (!axis) {
    return null;
  }
  const tunniPoint = calculateTunniPoint(segmentPoints);
  const [startPoint, controlPoint1, controlPoint2, endPoint] = segmentPoints;
  // Reach must be measured ALONG the handle axis, not as a plain distance. When
  // the handles splay outward the tangent rays still meet, but behind both ends
  // — the distance to that meeting point is large and positive while the reach
  // is negative. Taking the distance there invents a tension out of nothing,
  // and the ceiling built from it can pin the control before it has moved.
  // offset-cubic draws the same line: a reach that is not ahead is no limit.
  const startReach = signedReach(startPoint, controlPoint1, tunniPoint);
  const endReach = signedReach(endPoint, controlPoint2, tunniPoint);

  const startLength = distance(startPoint, controlPoint1);
  const endLength = distance(endPoint, controlPoint2);
  // Where there is no reach ahead, fall back to the handle's own length as the
  // unit, so the control keeps a sensible scale instead of dropping out.
  const startUnit = startReach > CURVATURE_EPSILON ? startReach : startLength;
  const endUnit = endReach > CURVATURE_EPSILON ? endReach : endLength;
  if (!(startUnit > CURVATURE_EPSILON) || !(endUnit > CURVATURE_EPSILON)) {
    return null;
  }

  const startTension = startLength / startUnit;
  const endTension = endLength / endUnit;

  // Half the summed reach converts a distance dragged in glyph units into a
  // tension increment: with the two ends alike, each handle tracks the pointer
  // one for one.
  let increment = (2 * dotVector(delta, axis)) / (startUnit + endUnit);

  increment = Math.max(
    increment,
    -(allowCollapse
      ? Math.max(startTension, endTension)
      : Math.min(startTension, endTension))
  );

  const place = (from, control, unit, tension, reach) => {
    const direction = normalizeVector(subVectors(control, from));
    const movedTension = Math.max(
      reach > CURVATURE_EPSILON
        ? Math.min(tension + increment, Math.max(tension, maxTension))
        : tension + increment,
      0
    );
    const length = movedTension * unit;
    return { x: from.x + direction.x * length, y: from.y + direction.y * length };
  };
  return [
    place(startPoint, controlPoint1, startUnit, startTension, startReach),
    place(endPoint, controlPoint2, endUnit, endTension, endReach),
  ];
}

// Whether the tangent intersection lies AHEAD of both endpoints.
//
// Tension is a fraction of the reach to that intersection, so it only means
// anything while the intersection is ahead. Where it sits behind an endpoint
// there is no ceiling for a handle to be a fraction of, and the ratio is
// negative. calculateSegmentTension builds its answer from plain distances,
// so it drops that sign and returns a plausible-looking number instead —
// which is how a segment with nothing overshooting reported a tension of
// 1.38. Callers that present or bound a tension must ask this first.
export function hasForwardTangentIntersection(segmentPoints) {
  if (segmentPoints?.length !== 4 || segmentPoints.some((point) => !point)) {
    return false;
  }
  const [startPoint, controlPoint1, controlPoint2, endPoint] = segmentPoints;
  const tunniPoint = calculateTunniPoint(segmentPoints);
  if (!tunniPoint) {
    return false;
  }
  return (
    signedReach(startPoint, controlPoint1, tunniPoint) > CURVATURE_EPSILON &&
    signedReach(endPoint, controlPoint2, tunniPoint) > CURVATURE_EPSILON
  );
}

// How far the tangent intersection lies ALONG the handle's own axis. Negative
// when it sits behind the on-curve point, which is the case a plain distance
// cannot tell apart.
function signedReach(onCurvePoint, controlPoint, tunniPoint) {
  const axis = normalizeVector(subVectors(controlPoint, onCurvePoint));
  return dotVector(subVectors(tunniPoint, onCurvePoint), axis);
}
