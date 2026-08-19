import { isStraightControlledSmoothPoint } from "./offset-contour.js";
import { calculateTunniPoint } from "./tunni-calculations.js";
import {
  addVectors,
  distance,
  dotVector,
  mulVectorScalar,
  normalizeVector,
  subVectors,
} from "./vector.js";

// Tension-aware editing, as pure geometry. Three rules: no handle turns, every
// handle keeps its tension, and a tension point slides along its straight. The
// editor supplies the path as it stood before the edit and the path as the
// ordinary rules left it; this module corrects the second one.

const EPSILON = 1e-9;

// Past this the crossing is so far away that a small input move swings the
// answer, so the chord is the steadier measure. Stated as a multiple of the
// chord, the same shape of bound the offset construction uses for its own
// coordinate scale.
const MAX_REACH_CHORDS = 2;

/**
 * The contour's segments, as indices into its point list. `offset-contour.js`
 * builds the same segments as point objects for its own readers. A write path
 * needs indices, and neither shape can serve the other.
 * @param {Array} points - Unpacked contour points
 * @param {boolean} closed - Whether the contour is closed
 * @returns {Array} `[{startIndex, endIndex, controlIndices}]`
 */
export function buildIndexedSegments(points, closed) {
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  const segments = [];
  if (onCurveIndices.length < 2) {
    return segments;
  }
  const controlsBetween = (from, to) => {
    const controls = [];
    for (let i = from; i < to; i++) {
      if (points[i]?.type) {
        controls.push(i);
      }
    }
    return controls;
  };
  for (let i = 0; i < onCurveIndices.length - 1; i++) {
    const startIndex = onCurveIndices[i];
    const endIndex = onCurveIndices[i + 1];
    segments.push({
      startIndex,
      endIndex,
      controlIndices: controlsBetween(startIndex + 1, endIndex),
    });
  }
  if (closed) {
    const startIndex = onCurveIndices[onCurveIndices.length - 1];
    const endIndex = onCurveIndices[0];
    segments.push({
      startIndex,
      endIndex,
      controlIndices: [
        ...controlsBetween(startIndex + 1, points.length),
        ...controlsBetween(0, endIndex),
      ],
    });
  }
  return segments;
}

export function isCubicSegment(segment) {
  return segment?.controlIndices?.length === 2;
}

export function samePosition(pointA, pointB) {
  return pointA.x === pointB.x && pointA.y === pointB.y;
}

// The direction a handle leaves its own on-curve point. Null where the handle
// sits on the point, which is a collapsed handle and carries no direction.
function handleDirection(handlePoint, onCurvePoint) {
  const delta = subVectors(handlePoint, onCurvePoint);
  if (Math.hypot(delta.x, delta.y) < EPSILON) {
    return null;
  }
  return normalizeVector(delta);
}

// How far the tangent crossing lies along each handle's own axis. Null where
// the crossing cannot carry a measurement: no crossing, a crossing behind
// either end, or one further than twice the chord.
function tangentReaches(startPoint, startDirection, endPoint, endDirection) {
  if (!startDirection || !endDirection) {
    return null;
  }
  // The crossing goes through the one function that owns it (R-B). It reads a
  // segment's four points and uses only the two handle directions, so a
  // synthetic handle one unit out states the direction exactly.
  const crossing = calculateTunniPoint([
    startPoint,
    addVectors(startPoint, startDirection),
    addVectors(endPoint, endDirection),
    endPoint,
  ]);
  if (!crossing) {
    return null;
  }
  const startReach = dotVector(subVectors(crossing, startPoint), startDirection);
  const endReach = dotVector(subVectors(crossing, endPoint), endDirection);
  if (startReach < EPSILON || endReach < EPSILON) {
    return null;
  }
  const chord = distance(startPoint, endPoint);
  if (chord < EPSILON) {
    return null;
  }
  if (startReach > MAX_REACH_CHORDS * chord || endReach > MAX_REACH_CHORDS * chord) {
    return null;
  }
  return { crossing, startReach, endReach, chord };
}

/**
 * Both handle tensions of a cubic segment: each handle's length as a fraction
 * of the way to the segment's Tunni point.
 * @returns {Object|null} `{start, end}`, or null where the crossing is unusable
 */
export function segmentTensions(points, segment) {
  if (!isCubicSegment(segment)) {
    return null;
  }
  const [firstControl, secondControl] = segment.controlIndices;
  const startPoint = points[segment.startIndex];
  const endPoint = points[segment.endIndex];
  const startDirection = handleDirection(points[firstControl], startPoint);
  const endDirection = handleDirection(points[secondControl], endPoint);
  const reaches = tangentReaches(startPoint, startDirection, endPoint, endDirection);
  if (!reaches) {
    return null;
  }
  return {
    start: distance(points[firstControl], startPoint) / reaches.startReach,
    end: distance(points[secondControl], endPoint) / reaches.endReach,
  };
}

function writeHandle(
  afterPoints,
  controlIndex,
  onCurvePoint,
  direction,
  length,
  round
) {
  const target = addVectors(
    onCurvePoint,
    mulVectorScalar(direction, Math.max(length, 0))
  );
  const x = round(target.x);
  const y = round(target.y);
  const handle = afterPoints[controlIndex];
  if (handle.x === x && handle.y === y) {
    return false;
  }
  afterPoints[controlIndex] = { ...handle, x, y };
  return true;
}

/**
 * Rules 1 and 2. For every cubic segment whose ends moved, set both handle
 * lengths so that each keeps the tension it had, along the direction the
 * ordinary edit left it. Where the crossing is unusable at either the before or
 * the after state, scale the handle by the chord's own ratio instead.
 *
 * `afterPoints` is mutated. `beforePoints` is read only.
 * @returns {boolean} Whether anything moved
 */
export function restoreSegmentTensions(
  beforePoints,
  afterPoints,
  closed,
  { round = Math.round } = {}
) {
  let changed = false;
  for (const segment of buildIndexedSegments(beforePoints, closed)) {
    if (!isCubicSegment(segment)) {
      continue;
    }
    const [firstControl, secondControl] = segment.controlIndices;
    const beforeStart = beforePoints[segment.startIndex];
    const beforeEnd = beforePoints[segment.endIndex];
    const afterStart = afterPoints[segment.startIndex];
    const afterEnd = afterPoints[segment.endIndex];
    // A segment whose two ends take the same delta is inside the selection as a
    // whole. It moves and keeps its shape, so nothing needs correcting.
    const startDelta = subVectors(afterStart, beforeStart);
    const endDelta = subVectors(afterEnd, beforeEnd);
    if (
      Math.abs(startDelta.x - endDelta.x) < EPSILON &&
      Math.abs(startDelta.y - endDelta.y) < EPSILON
    ) {
      continue;
    }
    // A handle that is still on its own point after the edit carries no
    // direction, so it keeps the one it had before. A handle that was collapsed
    // before stays collapsed, because its stored tension is zero.
    const startDirection =
      handleDirection(afterPoints[firstControl], afterStart) ||
      handleDirection(beforePoints[firstControl], beforeStart);
    const endDirection =
      handleDirection(afterPoints[secondControl], afterEnd) ||
      handleDirection(beforePoints[secondControl], beforeEnd);
    if (!startDirection || !endDirection) {
      continue;
    }
    const beforeChord = distance(beforeStart, beforeEnd);
    const afterChord = distance(afterStart, afterEnd);
    if (beforeChord < EPSILON || afterChord < EPSILON) {
      continue;
    }
    const tensions = segmentTensions(beforePoints, segment);
    const afterReaches = tensions
      ? tangentReaches(afterStart, startDirection, afterEnd, endDirection)
      : null;
    let startLength;
    let endLength;
    if (tensions && afterReaches) {
      startLength = tensions.start * afterReaches.startReach;
      endLength = tensions.end * afterReaches.endReach;
    } else {
      const ratio = afterChord / beforeChord;
      startLength = distance(beforePoints[firstControl], beforeStart) * ratio;
      endLength = distance(beforePoints[secondControl], beforeEnd) * ratio;
    }
    changed =
      writeHandle(
        afterPoints,
        firstControl,
        afterStart,
        startDirection,
        startLength,
        round
      ) || changed;
    changed =
      writeHandle(
        afterPoints,
        secondControl,
        afterEnd,
        endDirection,
        endLength,
        round
      ) || changed;
  }
  return changed;
}

// A straight may not be run below this, and a slide may not cross its far end.
const MIN_STRAIGHT_LENGTH = 1;

// The shape `isStraightControlledSmoothPoint` reads: it wants the segments as
// point objects, and this module carries them as indices.
function segmentAsPoints(points, segment) {
  return {
    controlPoints: segment.controlIndices.map((index) => points[index]),
  };
}

// The segment on the other side of `pointIndex` from `segment`.
function neighbourSegment(segments, segmentIndex, atStart, closed) {
  const count = segments.length;
  if (atStart) {
    if (segmentIndex === 0 && !closed) {
      return null;
    }
    return segments[(segmentIndex - 1 + count) % count];
  }
  if (segmentIndex === count - 1 && !closed) {
    return null;
  }
  return segments[(segmentIndex + 1) % count];
}

/**
 * Rule 3. A smooth on-curve point with one handle and a straight on its other
 * side owns no direction of its own, so it may slide along that straight. It
 * slides until its segment's tangent corner is back in proportion: the near leg
 * takes the same ratio the far leg took.
 *
 * `afterPoints` is mutated. `beforePoints` is read only.
 * @returns {boolean} Whether anything moved
 */
export function slideTensionPoints(
  beforePoints,
  afterPoints,
  closed,
  { round = Math.round } = {}
) {
  const segments = buildIndexedSegments(beforePoints, closed);
  let changed = false;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (!isCubicSegment(segment)) {
      continue;
    }
    for (const atStart of [true, false]) {
      const straight = neighbourSegment(segments, segmentIndex, atStart, closed);
      if (!straight) {
        continue;
      }
      const nearIndex = atStart ? segment.startIndex : segment.endIndex;
      const farIndex = atStart ? segment.endIndex : segment.startIndex;
      const nearControl = segment.controlIndices[atStart ? 0 : 1];
      const farControl = segment.controlIndices[atStart ? 1 : 0];
      if (
        !isStraightControlledSmoothPoint(
          beforePoints[nearIndex],
          segmentAsPoints(beforePoints, straight),
          segmentAsPoints(beforePoints, segment)
        )
      ) {
        continue;
      }
      // A point the edit already moved travels with the edit. It does not also
      // slide. A far end that did not move asks for no slide at all.
      if (!samePosition(beforePoints[nearIndex], afterPoints[nearIndex])) {
        continue;
      }
      if (samePosition(beforePoints[farIndex], afterPoints[farIndex])) {
        continue;
      }
      const nearPoint = beforePoints[nearIndex];
      const nearDirection =
        handleDirection(afterPoints[nearControl], nearPoint) ||
        handleDirection(beforePoints[nearControl], nearPoint);
      const beforeFar = beforePoints[farIndex];
      const afterFar = afterPoints[farIndex];
      const beforeFarDirection = handleDirection(beforePoints[farControl], beforeFar);
      const afterFarDirection =
        handleDirection(afterPoints[farControl], afterFar) || beforeFarDirection;
      const beforeReaches = tangentReaches(
        nearPoint,
        nearDirection,
        beforeFar,
        beforeFarDirection
      );
      const afterReaches = tangentReaches(
        nearPoint,
        nearDirection,
        afterFar,
        afterFarDirection
      );
      if (!beforeReaches || !afterReaches) {
        continue;
      }
      const ratio = afterReaches.endReach / beforeReaches.endReach;
      const nearReach = beforeReaches.startReach * ratio;
      let target = subVectors(
        afterReaches.crossing,
        mulVectorScalar(nearDirection, nearReach)
      );
      // The straight's far end holds the slide. Keep the straight at least one
      // unit long and on the side it started.
      const anchor =
        straight.startIndex === nearIndex
          ? beforePoints[straight.endIndex]
          : beforePoints[straight.startIndex];
      const axis = normalizeVector(subVectors(nearPoint, anchor));
      const travel = dotVector(subVectors(target, anchor), axis);
      if (travel < MIN_STRAIGHT_LENGTH) {
        target = addVectors(anchor, mulVectorScalar(axis, MIN_STRAIGHT_LENGTH));
      }
      const x = round(target.x);
      const y = round(target.y);
      if (afterPoints[nearIndex].x !== x || afterPoints[nearIndex].y !== y) {
        // The point carries its own handle, the same way the ordinary rules do.
        // A handle left behind would end up on the wrong side of its point and
        // the restore would then rebuild it pointing backwards.
        const slide = subVectors({ x, y }, afterPoints[nearIndex]);
        afterPoints[nearIndex] = { ...afterPoints[nearIndex], x, y };
        const handle = afterPoints[nearControl];
        afterPoints[nearControl] = {
          ...handle,
          x: handle.x + slide.x,
          y: handle.y + slide.y,
        };
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * The whole correction, in the order it has to run: the slide moves an on-curve
 * point, and the restore reads every on-curve position, so the slide goes first.
 * @returns {boolean} Whether anything moved
 */
export function applyTensionAwareEdit(beforePoints, afterPoints, closed, options = {}) {
  const slid = slideTensionPoints(beforePoints, afterPoints, closed, options);
  const restored = restoreSegmentTensions(beforePoints, afterPoints, closed, options);
  return slid || restored;
}

// No curved segment's bounding box may go under this in either direction. The
// scale stops when the first one gets there.
export const MIN_CURVE_EXTENT = 2;

function bodiesOfContour(points, closed) {
  const segments = buildIndexedSegments(points, closed);
  const bodyOf = new Map();
  const bodies = [];
  const join = (indexA, indexB) => {
    const bodyA = bodyOf.get(indexA);
    const bodyB = bodyOf.get(indexB);
    if (bodyA && bodyB) {
      if (bodyA === bodyB) return;
      for (const index of bodyB) {
        bodyA.add(index);
        bodyOf.set(index, bodyA);
      }
      bodies.splice(bodies.indexOf(bodyB), 1);
      return;
    }
    const body = bodyA || bodyB || new Set();
    if (!bodyA && !bodyB) bodies.push(body);
    for (const index of [indexA, indexB]) {
      body.add(index);
      bodyOf.set(index, body);
    }
  };
  for (const segment of segments) {
    if (!isCubicSegment(segment)) {
      join(segment.startIndex, segment.endIndex);
    }
  }
  return { segments, bodies, bodyOf };
}

// A run is a maximal chain of curve segments. Its two ends are on-curve points
// that belong to bodies, and its interior on-curves belong to no body.
function runsOfContour(segments, bodyOf) {
  const runs = [];
  let current = null;
  const flush = () => {
    if (current) runs.push(current);
    current = null;
  };
  for (const segment of segments) {
    if (!isCubicSegment(segment)) {
      flush();
      continue;
    }
    if (!current) {
      current = { startIndex: segment.startIndex, interior: [], endIndex: null };
    } else {
      current.interior.push(segment.startIndex);
    }
    current.endIndex = segment.endIndex;
  }
  flush();
  // On a closed contour a run that ends where another begins is one run.
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (last.endIndex === first.startIndex && !bodyOf.get(first.startIndex)) {
      last.interior.push(first.startIndex, ...first.interior);
      last.endIndex = first.endIndex;
      runs.shift();
    }
  }
  return runs;
}

/**
 * Rule 4. Straights are rigid links along the axis being scaled, and the curves
 * absorb the change.
 * @param {Array} contours - `[{points, isClosed}]`, the contours in the selection
 * @param {string} axis - "x" or "y"
 * @param {number} factor - The scale factor the transform box asks for
 * @param {number} origin - The coordinate the scale is taken about
 * @returns {Array|null} One Map per contour of point index to new coordinate,
 *   or null where the rule has nothing to distribute and must stand down
 */
export function solveRigidLinkScale(contours, axis, factor, origin) {
  const perContour = contours.map(({ points, isClosed }) => {
    const { segments, bodies, bodyOf } = bodiesOfContour(points, isClosed);
    return {
      points,
      isClosed,
      segments,
      bodies,
      bodyOf,
      runs: runsOfContour(segments, bodyOf),
    };
  });

  const allBodies = [];
  let hasDistributableRun = false;
  for (const contour of perContour) {
    for (const body of contour.bodies) {
      const coordinates = [...body].map((index) => contour.points[index][axis]);
      allBodies.push({
        body,
        min: Math.min(...coordinates),
        max: Math.max(...coordinates),
        displacement: 0,
      });
    }
    for (const run of contour.runs) {
      if (contour.bodyOf.get(run.startIndex) !== contour.bodyOf.get(run.endIndex)) {
        hasDistributableRun = true;
      }
    }
  }
  if (!hasDistributableRun || allBodies.length < 2) {
    return null;
  }

  allBodies.sort((a, b) => a.min - b.min);
  const gaps = [];
  let gapTotal = 0;
  for (let i = 0; i < allBodies.length - 1; i++) {
    const gap = Math.max(0, allBodies[i + 1].min - allBodies[i].max);
    gaps.push(gap);
    gapTotal += gap;
  }
  if (gapTotal < EPSILON) {
    return null;
  }

  const lowest = allBodies[0].min;
  const highest = allBodies[allBodies.length - 1].max;
  const scaled = (coordinate) => origin + (coordinate - origin) * factor;
  const change = scaled(highest) - scaled(lowest) - (highest - lowest);

  allBodies[0].displacement = scaled(lowest) - lowest;
  for (let i = 0; i < gaps.length; i++) {
    allBodies[i + 1].displacement =
      allBodies[i].displacement + (change * gaps[i]) / gapTotal;
  }
  const displacementOf = new Map();
  for (const entry of allBodies) {
    displacementOf.set(entry.body, entry.displacement);
  }

  return perContour.map((contour) => {
    const coordinates = new Map();
    const place = (index, value) => coordinates.set(index, value);
    for (const body of contour.bodies) {
      const displacement = displacementOf.get(body);
      for (const index of body) {
        place(index, contour.points[index][axis] + displacement);
      }
    }
    for (const run of contour.runs) {
      const startBefore = contour.points[run.startIndex][axis];
      const endBefore = contour.points[run.endIndex][axis];
      const startAfter = coordinates.get(run.startIndex) ?? startBefore;
      const endAfter = coordinates.get(run.endIndex) ?? endBefore;
      const span = endBefore - startBefore;
      for (const index of run.interior) {
        if (Math.abs(span) < EPSILON) {
          place(index, contour.points[index][axis] + (startAfter - startBefore));
          continue;
        }
        const t = (contour.points[index][axis] - startBefore) / span;
        place(index, startAfter + t * (endAfter - startAfter));
      }
    }
    return coordinates;
  });
}

/**
 * Does every cubic segment still measure at least `MIN_CURVE_EXTENT` in both
 * directions? The scale stops at the first one that does not.
 */
export function curvesAreAboveFloor(points, closed) {
  for (const segment of buildIndexedSegments(points, closed)) {
    if (!isCubicSegment(segment)) continue;
    const involved = [
      segment.startIndex,
      ...segment.controlIndices,
      segment.endIndex,
    ].map((index) => points[index]);
    const xs = involved.map((point) => point.x);
    const ys = involved.map((point) => point.y);
    if (
      Math.max(...xs) - Math.min(...xs) < MIN_CURVE_EXTENT &&
      Math.max(...ys) - Math.min(...ys) < MIN_CURVE_EXTENT
    ) {
      return false;
    }
  }
  return true;
}
