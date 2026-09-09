import { Bezier } from "bezier-js";
import { VarPackedPath } from "./var-path.js";

// How far past the corner each side runs. One number, in font units, the same
// for every selected point.
const OVERLAP_DISTANCE = 30;

// Adding an overlap means each side of a corner keeps going past it, on its own
// path, so the two sides cross. "On its own path" is the whole point: a curve
// arriving at the corner must leave the corner still curving the way it was.
//
// So a curved side is EXTRAPOLATED, not given a straight tail. The extension is
// the same cubic evaluated outside its own domain: de Casteljau at t past 1
// beyond the end, at t below 0 before the start. That is one curve, so its
// curvature at the corner is unchanged and the extension continues it. Taking
// the corner point and sliding it along the chord instead -- what this did
// before -- leaves the two handles where they were, which bends the curve into
// the tail and reads as the overlap changing the letter.
//
// A straight side is just lengthened. There is nothing to continue.
function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// de Casteljau at t, both halves. t outside [0, 1] is legal and is what the
// extrapolation is: the algebra does not care, and the halves it returns are
// the curve continued rather than cut.
function splitCubicAtT(points, t) {
  const [p1, p2, p3, p4] = points;
  const p12 = lerpPoint(p1, p2, t);
  const p23 = lerpPoint(p2, p3, t);
  const p34 = lerpPoint(p3, p4, t);
  const p123 = lerpPoint(p12, p23, t);
  const p234 = lerpPoint(p23, p34, t);
  const p1234 = lerpPoint(p123, p234, t);
  return [
    [p1, p12, p123, p1234],
    [p1234, p234, p34, p4],
  ];
}

function cubicArcLength(points) {
  const [p1, p2, p3, p4] = points;
  return new Bezier(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y).length();
}

function extendLine(from, to, distance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) {
    return { x: to.x, y: to.y };
  }
  return {
    x: to.x + (dx / length) * distance,
    y: to.y + (dy / length) * distance,
  };
}

// Both sides of a segment, in font units past each end. Either may be zero.
function extendSegment(segment, startDistance, endDistance) {
  if (segment.kind !== "cubic") {
    // A line, or a quadratic, which has no exact cubic extension worth the
    // code here: both are extended along the chord they already run on.
    const [first] = segment.points;
    const last = segment.points[segment.points.length - 1];
    const points = [...segment.points];
    if (endDistance) {
      points[points.length - 1] = extendLine(first, last, endDistance);
    }
    if (startDistance) {
      points[0] = extendLine(last, first, startDistance);
    }
    return { ...segment, points };
  }
  let points = segment.points;
  if (endDistance) {
    points = extendCubic(points, endDistance, true);
  }
  if (startDistance) {
    points = extendCubic(points, startDistance, false);
  }
  return { ...segment, points };
}

// How far past the domain to run, for a given distance in font units.
//
// A curve's parameter is not its arc length: it runs faster where the curve is
// flatter, and at a corner it is usually running fast. Treating the parameter
// as length -- stepping t by the distance over the whole curve's length -- then
// overshoots, and an extrapolated cubic bends harder the further out it goes,
// so a small overshoot in t reads as a large change of curvature. Asking for 30
// units of a short arc could carry the end nearly 50 and curl it.
//
// So the step is searched rather than assumed: how much arc the extension adds
// grows with the step, so a bisection settles it. The cost is a few length
// measurements on a curve, once per corner.
const EXTENSION_SEARCH_STEPS = 40;

function extendCubic(points, distance, atEnd) {
  const base = cubicArcLength(points);
  if (!base) {
    return points;
  }
  const extendedBy = (step) => {
    const extended = atEnd
      ? splitCubicAtT(points, 1 + step)[0]
      : splitCubicAtT(points, -step)[1];
    return { extended, added: cubicArcLength(extended) - base };
  };
  // A bracket first. The parameter step is never more than the distance over
  // the length, because the curve runs at least that fast somewhere, but it can
  // be much less, so the upper bound is grown until it is one.
  let high = distance / base;
  for (
    let i = 0;
    i < EXTENSION_SEARCH_STEPS && extendedBy(high).added < distance;
    i++
  ) {
    high *= 2;
  }
  let low = 0;
  for (let i = 0; i < EXTENSION_SEARCH_STEPS; i++) {
    const middle = (low + high) / 2;
    if (extendedBy(middle).added < distance) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return extendedBy((low + high) / 2).extended;
}

// The contour as segments between on-curve points. Each carries the index of
// the on-curve point it starts at and the one it ends at, so a selection of
// points becomes a statement about segment ends.
function contourSegments(points, isClosed) {
  const onCurveIndices = points
    .map((point, index) => (point.type ? -1 : index))
    .filter((index) => index >= 0);
  if (onCurveIndices.length < 2) {
    return [];
  }
  const segments = [];
  const lastPair = isClosed ? onCurveIndices.length : onCurveIndices.length - 1;
  for (let i = 0; i < lastPair; i++) {
    const startIndex = onCurveIndices[i];
    const endIndex = onCurveIndices[(i + 1) % onCurveIndices.length];
    const controlIndices = [];
    for (
      let j = (startIndex + 1) % points.length;
      j !== endIndex;
      j = (j + 1) % points.length
    ) {
      controlIndices.push(j);
    }
    const controls = controlIndices.map((j) => points[j]);
    segments.push({
      startIndex,
      endIndex,
      controlIndices,
      kind: controls.length === 2 ? "cubic" : controls.length === 1 ? "quad" : "line",
      points: [points[startIndex], ...controls, points[endIndex]],
    });
  }
  return segments;
}

function overlapContour(unpacked, selectedIndices) {
  const { points, isClosed } = unpacked;
  const segments = contourSegments(points, isClosed);
  if (!segments.length) {
    return null;
  }
  // A corner is only a corner where two segments meet, so an end of an open
  // contour is left alone: there is no second side to cross.
  const corners = new Set(
    [...selectedIndices].filter(
      (index) =>
        !points[index]?.type &&
        segments.some((segment) => segment.startIndex === index) &&
        segments.some((segment) => segment.endIndex === index)
    )
  );
  if (!corners.size) {
    return null;
  }
  const extended = segments.map((segment) =>
    extendSegment(
      segment,
      corners.has(segment.startIndex) ? OVERLAP_DISTANCE : 0,
      corners.has(segment.endIndex) ? OVERLAP_DISTANCE : 0
    )
  );

  // Every point keeps the point it came from: its curve type, its name, its
  // smooth flag. Only the coordinates are the extension's to state. Rebuilding
  // them as bare positions turned each extended handle into an on-curve point,
  // which is a curve replaced by two corners.
  const newPoints = [];
  const carry = (index, position) => ({
    ...points[index],
    x: position.x,
    y: position.y,
  });
  for (const segment of extended) {
    const [start, ...rest] = segment.points;
    const end = rest.pop();
    // A corner point splits in two: this segment's own end, and the next
    // segment's own start. Both are emitted, and they are what cross. Neither
    // is smooth any more -- the two sides now run past each other, and a smooth
    // flag would ask the editor to keep two crossing tangents aligned. Every
    // other point's flag is left as the designer set it.
    newPoints.push({
      ...carry(segment.startIndex, start),
      ...(corners.has(segment.startIndex) ? { smooth: false } : {}),
    });
    rest.forEach((control, i) => {
      newPoints.push(carry(segment.controlIndices[i], control));
    });
    if (corners.has(segment.endIndex)) {
      newPoints.push({ ...carry(segment.endIndex, end), smooth: false });
    } else if (!isClosed && segment === extended.at(-1)) {
      newPoints.push(carry(segment.endIndex, end));
    }
  }
  return { points: newPoints, isClosed };
}

export function addOverlap(path, selectedPointIndices) {
  if (!(path instanceof VarPackedPath)) {
    throw new Error("Path is not a VarPackedPath instance");
  }
  if (!Array.isArray(selectedPointIndices) || !selectedPointIndices.length) {
    return path;
  }
  const newPath = path.copy();
  const selected = new Set(selectedPointIndices);
  for (let contourIndex = 0; contourIndex < newPath.numContours; contourIndex++) {
    const startPoint = newPath.getAbsolutePointIndex(contourIndex, 0);
    const numPoints = newPath.getNumPointsOfContour(contourIndex);
    const contourSelection = [];
    for (let i = 0; i < numPoints; i++) {
      if (selected.has(startPoint + i)) {
        contourSelection.push(i);
      }
    }
    if (!contourSelection.length) {
      continue;
    }
    const result = overlapContour(
      newPath.getUnpackedContour(contourIndex),
      contourSelection
    );
    if (result) {
      newPath.setUnpackedContour(contourIndex, result);
    }
  }
  return newPath;
}
