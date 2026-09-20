// Pure geometry for the "Simplify contour" feature.
//
// A Fontra contour is an ordered list of unpacked points
// ({x, y, type?: "cubic"|"quad", smooth?: true, attrs?}), where on-curve
// points have no `type`. This module analyzes such contours and merges runs
// of adjacent cubic segments into fewer cubics, within a tolerance.

export function cubicPoint(points, t) {
  const [p0, p1, p2, p3] = points;
  const u = 1 - t;
  return {
    x:
      u ** 3 * p0.x +
      3 * u ** 2 * t * p1.x +
      3 * u * t ** 2 * p2.x +
      t ** 3 * p3.x,
    y:
      u ** 3 * p0.y +
      3 * u ** 2 * t * p1.y +
      3 * u * t ** 2 * p2.y +
      t ** 3 * p3.y,
  };
}

export function cubicDerivative(points, t) {
  const [p0, p1, p2, p3] = points;
  const u = 1 - t;
  return {
    x:
      3 * u ** 2 * (p1.x - p0.x) +
      6 * u * t * (p2.x - p1.x) +
      3 * t ** 2 * (p3.x - p2.x),
    y:
      3 * u ** 2 * (p1.y - p0.y) +
      6 * u * t * (p2.y - p1.y) +
      3 * t ** 2 * (p3.y - p2.y),
  };
}

// Solve the quadratic a t^2 + b t + c = 0, returning interior roots only.
function interiorQuadraticRoots(a, b, c) {
  const roots = [];
  const EPS = 1e-12;
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) {
      return roots;
    }
    const t = -c / b;
    if (t > 0 && t < 1) {
      roots.push(t);
    }
    return roots;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return roots;
  }
  const sqrtD = Math.sqrt(discriminant);
  for (const t of [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)]) {
    if (t > 0 && t < 1) {
      roots.push(t);
    }
  }
  return roots;
}

export function cubicExtremaParameters(points) {
  const [p0, p1, p2, p3] = points;
  // d/dt of the cubic for one axis is a quadratic:
  //   a t^2 + b t + c with
  //   a = 3 (-p0 + 3 p1 - 3 p2 + p3)
  //   b = 6 (p0 - 2 p1 + p2)
  //   c = 3 (p1 - p0)
  const roots = [];
  for (const axis of ["x", "y"]) {
    const a = 3 * (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]);
    const b = 6 * (p0[axis] - 2 * p1[axis] + p2[axis]);
    const c = 3 * (p1[axis] - p0[axis]);
    roots.push(...interiorQuadraticRoots(a, b, c));
  }
  roots.sort((a, b) => a - b);
  // Remove duplicates within 1e-9.
  return roots.filter((t, i) => i === 0 || t - roots[i - 1] > 1e-9);
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function splitCubic(points, t) {
  const p01 = lerpPoint(points[0], points[1], t);
  const p12 = lerpPoint(points[1], points[2], t);
  const p23 = lerpPoint(points[2], points[3], t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const middle = lerpPoint(p012, p123, t);

  return {
    left: [points[0], p01, p012, middle],
    right: [middle, p123, p23, points[3]],
  };
}

// Convert one unpacked contour ({points, isClosed}) into an ordered list of
// segment pieces. Cubic pieces carry the original contour point indices of
// their on-curve endpoints. Line segments are returned unchanged, marked
// non-mergeable.
export function contourToCubicPieces(contour) {
  const { points, isClosed } = contour;
  const pieces = [];

  // Indices of the on-curve points, in contour order.
  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }
  if (onCurveIndices.length === 0) {
    return pieces;
  }

  const numSegments = isClosed
    ? onCurveIndices.length
    : onCurveIndices.length - 1;

  for (let s = 0; s < numSegments; s++) {
    const startPointIndex = onCurveIndices[s];
    const endPointIndex = onCurveIndices[(s + 1) % onCurveIndices.length];
    // Off-curve points between the two on-curves. For the closing segment of
    // a closed contour they sit between endPointIndex and the contour end.
    const offCurves = [];
    if (s + 1 < onCurveIndices.length) {
      for (let i = startPointIndex + 1; i < endPointIndex; i++) {
        offCurves.push(points[i]);
      }
    } else {
      for (let i = startPointIndex + 1; i < points.length; i++) {
        offCurves.push(points[i]);
      }
    }
    const p0 = points[startPointIndex];
    const p3 = points[endPointIndex];
    if (offCurves.length === 0) {
      pieces.push({
        kind: "line",
        mergeable: false,
        points: [p0, p3],
        startPointIndex,
        endPointIndex,
        sourceSegmentIndex: s,
      });
    } else if (offCurves.length === 2 && offCurves.every((p) => p.type === "cubic")) {
      pieces.push({
        kind: "cubic",
        mergeable: true,
        points: [p0, offCurves[0], offCurves[1], p3],
        startPointIndex,
        endPointIndex,
        sourceSegmentIndex: s,
      });
    } else {
      // Quad or mixed segment: keep, but never merge.
      pieces.push({
        kind: "other",
        mergeable: false,
        points: [p0, ...offCurves, p3],
        startPointIndex,
        endPointIndex,
        sourceSegmentIndex: s,
      });
    }
  }
  return pieces;
}
