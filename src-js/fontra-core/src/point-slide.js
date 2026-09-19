import { Bezier } from "bezier-js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";

// Point slide: move one on-curve point along its own contour without changing
// the drawn shape. The destination is a new split location on the existing
// curve, so the operation is exact: de Casteljau on a cubic, linear
// interpolation on a straight. Nothing is refitted and nothing is
// approximated.
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
// - Metadata (`smooth` and any custom attributes) rides on the point object.
//   A slide changes the point count, so index-based readers (selection,
//   markers) follow their own existing rules for a topology change; this
//   module only reports where the moved point landed.

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
 * The moved point keeps the original point's full attribute set: the identity
 * slides. The leftover on-curve at the old position is new scaffolding from
 * the split and carries only the position and the smooth flag, which is the
 * geometry of the joint it inherits. A corner therefore keeps its angle at
 * the old position, and the moved point keeps its flag at the new one; the
 * handles at the new position come from the split, because exactness decides
 * them (the spec's decision 4 outranks the corner's two tangents).
 *
 * The parameter is clamped to 0 and 1 and no further in. Zero and one are
 * legal destinations: the point collapses onto its neighbour and is emitted
 * anyway, and the shape still holds.
 *
 * @param {Object} contour - {points, isClosed}, never mutated
 * @param {number} pointIndex - array index of the on-curve point
 * @param {string} side - "previous" or "next"
 * @param {number} t - the parameter along that side's segment
 * @returns {Object|null} {points, isClosed, movedPointIndex} or null where
 *   the point or the side does not exist
 */
export function makeSlideCandidate(contour, pointIndex, side, t) {
  const adjacent = getAdjacentSegments(contour, pointIndex);
  const segment = side === "previous" ? adjacent.previous : adjacent.next;
  const point = contour.points?.[pointIndex];
  if (!segment || !point || point.type) {
    return null;
  }
  const { replacement, point: destination } = splitSegmentAt(segment.points, t);
  const moved = { ...point, x: destination.x, y: destination.y };
  const leftover = { x: point.x, y: point.y, smooth: point.smooth };
  const { points, isClosed } = contour;
  const leftHandles = replacement.length === 1 ? [] : replacement.slice(0, 2);
  const rightHandles = replacement.length === 1 ? [] : replacement.slice(3);
  const wraps = segment.endIndex <= segment.startIndex;

  let newPoints;
  let movedPointIndex;
  if (side === "previous") {
    if (!wraps) {
      // A -> moved -> leftover -> B. The previous segment's handles, at
      // startIndex+1 .. pointIndex-1, are replaced by the split.
      newPoints = [
        ...points.slice(0, segment.startIndex + 1),
        ...leftHandles,
        moved,
        ...rightHandles,
        leftover,
        ...points.slice(pointIndex + 1),
      ];
      movedPointIndex = segment.startIndex + 1 + leftHandles.length;
    } else {
      // The previous segment wraps: A is the last on-curve and its handles
      // trail the array. The contour still opens with the leftover (the old
      // point-0 position), and the split lands in the tail behind A.
      newPoints = [
        leftover,
        ...points.slice(1, segment.startIndex + 1),
        ...leftHandles,
        moved,
        ...rightHandles,
      ];
      movedPointIndex = segment.startIndex + 1 + leftHandles.length;
    }
  } else {
    if (!wraps) {
      // A -> leftover -> moved -> B. The next segment's handles are replaced
      // by the split, and the leftover takes the point's old slot.
      newPoints = [
        ...points.slice(0, pointIndex),
        leftover,
        ...leftHandles,
        moved,
        ...rightHandles,
        ...points.slice(segment.endIndex),
      ];
      movedPointIndex = pointIndex + 1 + leftHandles.length;
    } else {
      // The point is the last on-curve and the next segment wraps to index 0.
      // The split lands in the tail behind the leftover.
      newPoints = [
        ...points.slice(0, pointIndex),
        leftover,
        ...leftHandles,
        moved,
        ...rightHandles,
      ];
      movedPointIndex = pointIndex + 1 + leftHandles.length;
    }
  }
  return { points: newPoints, isClosed, movedPointIndex };
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
 *   slide is refused: the point is an open contour's endpoint, is off-curve,
 *   or has no interval to slide on
 */
export function slidePointOnContour(contour, pointIndex, pointer, options = {}) {
  const adjacent = getAdjacentSegments(contour, pointIndex);
  // An open endpoint has one segment and nothing bounding its far side: there
  // is no interval to slide within, so the gesture is refused outright.
  if (!adjacent.previous || !adjacent.next) {
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
