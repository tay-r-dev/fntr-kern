import { Bezier } from "bezier-js";
import {
  chordLengthParameterize,
  generateBezier,
  parameterizeAgainstCubic,
} from "./fit-cubic.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";

// Point slide: move one on-curve point along its own contour. The point the
// user drags is the point that moves: it keeps its array index, its
// attributes, and its identity, and the point count never changes. The two
// neighbouring on-curves are the anchors. The segment traveled keeps its
// exact shape through the split's kept piece: de Casteljau on a cubic, linear
// interpolation on a straight. The far segment is refit to keep drawing the
// old path between the moved point and its far anchor.
//
// The path representation this module works on, confirmed against
// `VarPackedPath.getUnpackedContour` / `setUnpackedContour`:
//
// - A contour is {points, isClosed}. On-curve points have no `type`; a cubic's
//   two off-curves carry `type: "cubic"` and sit between their segment's two
//   on-curves, in travel order.
// - A straight segment is two on-curves with nothing between them.
// - On a closed contour the closing segment wraps: it runs from the last
//   on-curve back to the first, and its handles sit at the TAIL of the array,
//   behind the last on-curve. An open contour's first and last points are
//   on-curves with one neighbour each.
// - Metadata (`smooth` and any custom attributes) rides on the point object
//   and travels with it, because the point object itself is reused.

/**
 * The two segments beside an on-curve point.
 *
 * @param {Object} contour - {points, isClosed}
 * @param {number} pointIndex - array index of the on-curve point
 * @returns {Object} {previous, next}, each a segment or null where the contour
 *   is open and the point has no neighbour on that side. A segment is
 *   {startIndex, endIndex, handles, points, kind}: the array indices of its
 *   two on-curves, its handles, its full point list, and "line" or "cubic".
 */
export function getAdjacentSegments(contour, pointIndex) {
  const { points, isClosed } = contour;
  const point = points?.[pointIndex];
  if (!point || point.type) {
    return { previous: null, next: null };
  }
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  const k = onCurveIndices.indexOf(pointIndex);
  if (k < 0) {
    return { previous: null, next: null };
  }
  const segment = (fromK, toK) => {
    const startIndex = onCurveIndices[fromK];
    const endIndex = onCurveIndices[toK];
    // The wrapping segment's handles trail the array. Every other segment's
    // handles sit between its two on-curves.
    const handles =
      endIndex > startIndex
        ? points.slice(startIndex + 1, endIndex)
        : points.slice(startIndex + 1);
    return {
      startIndex,
      endIndex,
      handles,
      points: [points[startIndex], ...handles, points[endIndex]],
      kind: handles.length === 0 ? "line" : "cubic",
    };
  };
  const last = onCurveIndices.length - 1;
  return {
    previous:
      k > 0 ? segment(k - 1, k) : isClosed && last > 0 ? segment(last, k) : null,
    next: k < last ? segment(k, k + 1) : isClosed && last > 0 ? segment(k, 0) : null,
  };
}

/**
 * Project a pointer position onto one segment.
 *
 * @param {Object} segment - a segment from getAdjacentSegments
 * @param {Object} pointer - {x, y}
 * @returns {Object} {t, point}: the segment parameter, clamped to 0 and 1,
 *   and the projected position on the curve
 */
export function projectPointToSegment(segment, pointer) {
  if (segment.kind === "line") {
    const [a, b] = segment.points;
    const span = { x: b.x - a.x, y: b.y - a.y };
    const length2 = span.x * span.x + span.y * span.y;
    const t = length2
      ? Math.min(
          1,
          Math.max(
            0,
            ((pointer.x - a.x) * span.x + (pointer.y - a.y) * span.y) / length2
          )
        )
      : 0;
    return { t, point: { x: a.x + span.x * t, y: a.y + span.y * t } };
  }
  const projected = new Bezier(segment.points).project(pointer);
  const t = Math.min(1, Math.max(0, projected.t));
  return { t, point: { x: projected.x, y: projected.y } };
}

/**
 * Choose the destination on the interval between the two neighbouring
 * on-curves: the nearer of the two projections. Both projections are computed
 * on the contour as it stood at mouse-down, and the answer is used against
 * that same snapshot for the whole gesture.
 *
 * @param {Object} adjacent - {previous, next} from getAdjacentSegments
 * @param {Object} pointer - {x, y}
 * @param {Object} originalPoint - the point being slid, for distance reference
 * @returns {Object|null} {side, t, point} or null where neither side exists
 */
export function chooseSlideInterval(adjacent, pointer, originalPoint) {
  const candidates = [];
  for (const side of ["previous", "next"]) {
    const segment = adjacent[side];
    if (!segment) {
      continue;
    }
    const { t, point } = projectPointToSegment(segment, pointer);
    candidates.push({
      side,
      t,
      point,
      distance: Math.hypot(pointer.x - point.x, pointer.y - point.y),
    });
  }
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const { side, t, point } = candidates[0];
  return { side, t, point };
}

/**
 * Split a segment at a parameter.
 *
 * The return is the splice the segment's handles are replaced with: five
 * points for a cubic (two handles, the new on-curve, two handles), one for a
 * straight (the new on-curve alone, so the two pieces stay straights).
 *
 * @param {Array} segmentPoints - the segment's full point list
 * @param {number} t - the parameter, clamped to 0 and 1
 * @returns {Object} {replacement, point}: the splice and the split location
 */
export function splitSegmentAt(segmentPoints, t) {
  const parameter = Math.min(1, Math.max(0, t));
  if (segmentPoints.length === 2) {
    const [a, b] = segmentPoints;
    const point = {
      x: a.x + (b.x - a.x) * parameter,
      y: a.y + (b.y - a.y) * parameter,
    };
    return { replacement: [point], point };
  }
  const { first, second } = splitCubicAt(segmentPoints, parameter);
  const [, h1, h2, at] = first;
  const [, h3, h4] = second;
  const point = { x: at.x, y: at.y };
  return {
    replacement: [
      { x: h1.x, y: h1.y, type: "cubic" },
      { x: h2.x, y: h2.y, type: "cubic" },
      point,
      { x: h3.x, y: h3.y, type: "cubic" },
      { x: h4.x, y: h4.y, type: "cubic" },
    ],
    point,
  };
}

/**
 * Build the contour with the point slid to a new split location.
 *
 * The dragged point itself moves: it keeps its array slot and its full
 * attribute set, only its coordinates change, and the point count never
 * changes. The anchors are the two neighbouring on-curves: they do not move,
 * and nothing is left at the point's old position.
 *
 * The segment traveled takes the split's exact piece: toward the previous
 * on-curve that is the split's first piece, toward the next it is the second
 * piece. Its handles overwrite the segment's own slots one for one, which is
 * the anchor's handle length adjusting to the cut. The far segment is refit
 * to draw the old path from the moved point to the far anchor: see
 * refitFarSegment.
 *
 * The parameter is clamped to 0 and 1 and no further in. Zero and one are
 * legal destinations: the point lands on its neighbour and the traveled
 * segment degenerates, but the count still holds.
 *
 * @param {Object} contour - {points, isClosed}, never mutated
 * @param {number} pointIndex - array index of the on-curve point
 * @param {string} side - "previous" or "next"
 * @param {number} t - the parameter along that side's segment
 * @param {Object} options - optional fitIterations for provisional search candidates;
 *   omit it for the normal fully refined V-slide.
 * @returns {Object|null} {points, isClosed, movedPointIndex} or null where
 *   the point or the side does not exist. movedPointIndex always equals
 *   pointIndex: the dragged point keeps its slot
 */
export function makeSlideCandidate(contour, pointIndex, side, t, options = {}) {
  const adjacent = getAdjacentSegments(contour, pointIndex);
  const segment = side === "previous" ? adjacent.previous : adjacent.next;
  const point = contour.points?.[pointIndex];
  if (!segment || !point || point.type) {
    return null;
  }
  const { replacement, point: destination } = splitSegmentAt(segment.points, t);
  // Toward the previous on-curve the contour keeps the split's FIRST piece.
  // Toward the next it keeps the SECOND piece. A straight has no handles
  // either way.
  const handles =
    replacement.length === 1
      ? []
      : side === "previous"
        ? replacement.slice(0, 2)
        : replacement.slice(3);
  const newPoints = [...contour.points];
  newPoints[pointIndex] = { ...point, x: destination.x, y: destination.y };
  // The wrapping segment's handles trail the array. Every other segment's
  // handles sit between its two on-curves. Either way the kept piece's
  // handles overwrite the segment's own slots one for one, keeping each slot's
  // own attributes (a skeleton handle's id among them).
  const firstHandleIndex = segment.startIndex + 1;
  for (let i = 0; i < handles.length; i++) {
    const slot = firstHandleIndex + i;
    newPoints[slot] = { ...contour.points[slot], x: handles[i].x, y: handles[i].y };
  }
  refitFarSegment(
    newPoints,
    adjacent,
    side,
    replacement,
    destination,
    options.fitIterations ?? FIT_ITERATIONS
  );
  return { points: newPoints, isClosed: contour.isClosed, movedPointIndex: pointIndex };
}

/**
 * Refit the far segment so it keeps drawing the path it now spans. The piece
 * of the traveled segment the point slid past joins the far segment: when P
 * slides toward A, P' -> B must draw the rest of the old A -> P curve followed
 * by the old P -> B curve. The far segment's handle directions are pinned to
 * that path's tangents at both ends (so the join with the traveled piece
 * stays exactly as smooth as the curve the point sits on, and the far anchor
 * keeps its angle); only the two handle lengths are solved, by least squares
 * against samples of the path. A cubic cannot always draw two cubics
 * exactly, so this is a best fit, exact whenever the point slides nowhere.
 *
 * A corner is different. Where the two segments meet at an angle, the far
 * segment cannot draw the bend at the point's old position, and chasing the
 * passed piece would swing the corner's handle onto the traveled side's
 * direction. So at a corner the far segment keeps both of its own handle
 * directions and is refit to its own old shape with the point's end dragged
 * to the new position; only its handle lengths adapt.
 *
 * The far segment's handles always sit at startIndex + 1 and + 2, trailing
 * the array when it wraps.
 */
function refitFarSegment(
  newPoints,
  adjacent,
  side,
  replacement,
  destination,
  fitIterations
) {
  const far = side === "previous" ? adjacent.next : adjacent.previous;
  const traveled = side === "previous" ? adjacent.previous : adjacent.next;
  if (!far?.handles.length) return;
  if (isCornerBetween(traveled, far, side)) {
    dragCornerFarSegment(newPoints, far, side, destination);
    return;
  }
  const fit = passedFitTarget(far, traveled, side, replacement, destination);
  if (!fit) return;
  const { samples, leftTangent, rightTangent } = fit;
  // fitCubic stops refining once its squared error improves by under half a
  // unit, which leaves visible drift here; iterate to convergence instead.
  let parameters = chordLengthParameterize(samples);
  let bezier;
  for (let i = 0; i < fitIterations; i++) {
    bezier = generateBezier(samples, parameters, leftTangent, rightTangent);
    parameters = parameterizeAgainstCubic(bezier.points, samples, parameters);
  }
  const [, h1, h2] = bezier.points;
  const first = far.startIndex + 1;
  newPoints[first] = { ...newPoints[first], x: h1.x, y: h1.y };
  newPoints[first + 1] = { ...newPoints[first + 1], x: h2.x, y: h2.y };
}

/**
 * Carry the insertion points on the two slid segments along with a slide.
 * An insertion is {pointId, t, ...}: it sits on the segment that starts at
 * the on-curve with that id, at source parameter t. One on the kept piece of
 * the traveled segment stays exactly where it was on the curve, its t rescaled
 * to the shorter segment. Every other one (on the passed piece, or on the far
 * segment) keeps its old position as nearly as the refit far segment allows:
 * it is projected onto that segment and addressed to it.
 *
 * @param {Object} contour - the contour before the slide; points carry `id`
 * @param {Object} candidate - makeSlideCandidate's result for that contour
 * @param {string} side - the side the candidate was built for
 * @param {number} t - the parameter the candidate was built for
 * @param {Array} insertions - the contour's insertions, never mutated
 * @returns {Array} the insertions after the slide, same order, same fields
 */
export function slideInsertions(contour, candidate, side, t, insertions) {
  const pointIndex = candidate.movedPointIndex;
  const before = getAdjacentSegments(contour, pointIndex);
  const after = getAdjacentSegments(candidate, pointIndex);
  const traveled = side === "previous" ? before.previous : before.next;
  const oldFar = side === "previous" ? before.next : before.previous;
  const newFar = side === "previous" ? after.next : after.previous;
  const idAt = (index) => contour.points[index].id;
  const traveledId = idAt(traveled.startIndex);
  // An open endpoint has no far segment. What the point slid past is beyond
  // the new end, so an insertion there is held at that end.
  const farId = oldFar ? idAt(oldFar.startIndex) : null;
  return insertions.map((insertion) => {
    let segment;
    if (insertion.pointId === traveledId) {
      if (side === "previous" && insertion.t <= t) {
        return { ...insertion, t: t ? insertion.t / t : 0 };
      }
      if (side === "next" && insertion.t >= t) {
        return { ...insertion, t: t < 1 ? (insertion.t - t) / (1 - t) : 0 };
      }
      if (!oldFar) {
        return { ...insertion, t: side === "previous" ? 1 : 0 };
      }
      segment = traveled;
    } else if (farId !== null && insertion.pointId === farId) {
      segment = oldFar;
    } else {
      return insertion;
    }
    const position = evaluatePiece(segment.points, insertion.t);
    return {
      ...insertion,
      pointId: farId,
      t: projectPointToSegment(newFar, position).t,
    };
  });
}

// The slid point is a corner when the two segments leave it in directions
// that are not opposite: read from the geometry, since a drawn contour's
// `smooth` flag is often unset on points that are smooth in fact.
function isCornerBetween(traveled, far, side) {
  const point = side === "previous" ? far.points[0] : far.points.at(-1);
  const alongTraveled =
    side === "previous"
      ? unitToward(point, [...traveled.points].reverse())
      : unitToward(point, traveled.points);
  const alongFar =
    side === "previous"
      ? unitToward(point, far.points)
      : unitToward(point, [...far.points].reverse());
  if (!alongTraveled || !alongFar) return false;
  const dot = alongTraveled.x * alongFar.x + alongTraveled.y * alongFar.y;
  return dot > -Math.cos(CORNER_ANGLE_TOLERANCE);
}

// A smooth point: the far segment takes over the passed piece of the traveled
// segment, so the path it has to draw runs through both.
function passedFitTarget(far, traveled, side, replacement, destination) {
  const passed =
    traveled.kind === "line"
      ? side === "previous"
        ? [destination, traveled.points.at(-1)]
        : [traveled.points[0], destination]
      : side === "previous"
        ? [destination, replacement[3], replacement[4], traveled.points.at(-1)]
        : [traveled.points[0], replacement[0], replacement[1], destination];
  const pieces = side === "previous" ? [passed, far.points] : [far.points, passed];
  const leftTangent = unitToward(pieces[0][0], pieces[0]);
  const rightTangent = unitToward(pieces[1].at(-1), [...pieces[1]].reverse());
  if (!leftTangent || !rightTangent) return null;
  const samples = [];
  for (const [p, piece] of pieces.entries()) {
    for (let i = p ? 1 : 0; i <= FIT_SAMPLES; i++) {
      samples.push(evaluatePiece(piece, i / FIT_SAMPLES));
    }
  }
  return { samples, leftTangent, rightTangent };
}

// A corner: the far segment's own old shape with its point end dragged to the
// new position, the drag fading linearly to nothing at the far anchor. That
// dragged curve is itself a cubic, its handles shifted by a third and two
// thirds of the drag. Each handle is then projected onto its own old
// direction, so the directions hold and only the lengths change; with no drag
// it is the old segment exactly.
function dragCornerFarSegment(newPoints, far, side, destination) {
  const [p0, p1, p2, p3] = far.points;
  const point = side === "previous" ? p0 : p3;
  const shift = { x: destination.x - point.x, y: destination.y - point.y };
  const [w1, w2] = side === "previous" ? [2 / 3, 1 / 3] : [1 / 3, 2 / 3];
  const start = side === "previous" ? destination : p0;
  const end = side === "previous" ? p3 : destination;
  const handleAlong = (anchor, oldAnchor, handle, weight) => {
    const direction = unitToward(oldAnchor, [handle]);
    if (!direction) return { x: anchor.x, y: anchor.y };
    const dragged = { x: handle.x + shift.x * weight, y: handle.y + shift.y * weight };
    const length = Math.max(
      0,
      (dragged.x - anchor.x) * direction.x + (dragged.y - anchor.y) * direction.y
    );
    return { x: anchor.x + direction.x * length, y: anchor.y + direction.y * length };
  };
  const h1 = handleAlong(start, p0, p1, w1);
  const h2 = handleAlong(end, p3, p2, w2);
  const first = far.startIndex + 1;
  newPoints[first] = { ...newPoints[first], x: h1.x, y: h1.y };
  newPoints[first + 1] = { ...newPoints[first + 1], x: h2.x, y: h2.y };
}

// Radians. Two directions this close to opposite count as one smooth line.
const CORNER_ANGLE_TOLERANCE = 0.01;
const FIT_SAMPLES = 32;
const FIT_ITERATIONS = 50;

// Unit direction from `from` to the first point of `points` that differs
// from it, or null when every point coincides.
function unitToward(from, points) {
  for (const p of points) {
    const length = Math.hypot(p.x - from.x, p.y - from.y);
    if (length > 1e-9)
      return { x: (p.x - from.x) / length, y: (p.y - from.y) / length };
  }
  return null;
}

function evaluatePiece(piece, t) {
  if (piece.length === 2) {
    return {
      x: piece[0].x + (piece[1].x - piece[0].x) * t,
      y: piece[0].y + (piece[1].y - piece[0].y) * t,
    };
  }
  return cubicPointAt(piece, t);
}

/**
 * Whether two contours offer the same slide interval at a point: same sides
 * present, same segment kinds. Two masters that disagree here cannot take one
 * shared source parameter, so the gesture is refused rather than approximated.
 */
export function slideIntervalsCompatible(adjacentA, adjacentB) {
  for (const side of ["previous", "next"]) {
    const a = adjacentA?.[side];
    const b = adjacentB?.[side];
    if (!a !== !b || (a && b && a.kind !== b.kind)) {
      return false;
    }
  }
  return true;
}

/**
 * Slide one on-curve point along its contour, from a pointer position.
 *
 * @param {Object} contour - {points, isClosed}, never mutated
 * @param {number} pointIndex - array index of the on-curve point
 * @param {Object} pointer - {x, y}
 * @returns {Object|null} the candidate, plus {side, t}, or null where the
 *   slide is refused: the point is off-curve, or has no segment to slide on.
 *   An open contour's endpoint slides along its one segment.
 */
export function slidePointOnContour(contour, pointIndex, pointer, options = {}) {
  const adjacent = getAdjacentSegments(contour, pointIndex);
  if (!adjacent.previous && !adjacent.next) {
    return null;
  }
  const destination = chooseSlideInterval(
    adjacent,
    pointer,
    contour.points[pointIndex]
  );
  if (!destination) {
    return null;
  }
  const candidate = makeSlideCandidate(
    contour,
    pointIndex,
    destination.side,
    destination.t
  );
  return candidate ? { ...candidate, side: destination.side, t: destination.t } : null;
}

/**
 * Round a slide candidate to whole units without breaking a smooth point.
 * Only the points the slide moved are rounded: the contour may hold
 * fractional points the slide never touched. Rounding each moved point on its
 * own tilts the two handles of a smooth on-curve apart, so every on-curve
 * that was smooth before the slide (flagged, or in fact) gets its handles put back on one
 * line through its (rounded) position. The line is an unmoved handle's, when
 * one is left; else the longer handle's rounded direction, the shorter handle
 * keeping its rounded length along it.
 *
 * @param {Object} contour - the contour before the slide, never mutated
 * @param {Object} candidate - makeSlideCandidate's result for that contour
 * @returns {Object} the candidate with rounded points, same shape
 */
export function roundSlideCandidate(contour, candidate) {
  const original = contour.points;
  const moved = (i) =>
    candidate.points[i].x !== original[i]?.x ||
    candidate.points[i].y !== original[i]?.y;
  const points = candidate.points.map((point, i) =>
    moved(i) ? { ...point, x: Math.round(point.x), y: Math.round(point.y) } : point
  );
  const count = points.length;
  const at = (i) => (i + count) % count;
  for (let i = 0; i < count; i++) {
    if (original[i].type) continue;
    const before = at(i - 1);
    const after = at(i + 1);
    if (!contour.isClosed && (i === 0 || i === count - 1)) continue;
    if (!original[before].type || !original[after].type) continue;
    if (!moved(i) && !moved(before) && !moved(after)) continue;
    // Smooth before the slide: flagged smooth, or smooth in fact, read from
    // the geometry like isCornerBetween. A flagged point whose handles had
    // already drifted apart is straightened here too.
    const inward = unitToward(original[i], [original[before]]);
    const outward = unitToward(original[i], [original[after]]);
    if (!inward || !outward) continue;
    const straight =
      inward.x * outward.x + inward.y * outward.y <= -Math.cos(CORNER_ANGLE_TOLERANCE);
    if (!straight && original[i].smooth !== true) continue;
    const anchor = points[i];
    const length = (j) => Math.hypot(points[j].x - anchor.x, points[j].y - anchor.y);
    let keep;
    if (!moved(before) && !moved(i)) keep = before;
    else if (!moved(after) && !moved(i)) keep = after;
    else keep = length(before) >= length(after) ? before : after;
    const other = keep === before ? after : before;
    const direction = unitToward(anchor, [points[keep]]);
    if (!direction) continue;
    const reach = length(other);
    points[other] = {
      ...points[other],
      x: anchor.x - direction.x * reach,
      y: anchor.y - direction.y * reach,
    };
  }
  return { ...candidate, points };
}
