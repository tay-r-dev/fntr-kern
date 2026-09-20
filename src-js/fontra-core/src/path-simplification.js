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

function hasNonEmptyAttrs(point) {
  return !!point.attrs && Object.keys(point.attrs).length > 0;
}

// Analyze one unpacked contour: split cubic pieces at interior extrema and
// classify which points must survive simplification.
//
// Returns {pieces, protectedPointKeys, sourcePointMap, isClosed}:
// - pieces: segment pieces in contour order. Cubic pieces are split at every
//   interior extremum, so no piece contains an extremum. Each piece carries
//   startKey/endKey identifying its on-curve boundary points.
// - protectedPointKeys: Set of point keys that must not be removed.
//   Original points are keyed by their contour point index (a number);
//   inserted extrema points get a generated string key.
// - sourcePointMap: Map from inserted extrema key to
//   {point, sourceSegmentIndex, t}.
export function classifySimplifyContour(contour, options = {}) {
  const { points, isClosed } = contour;
  const basePieces = contourToCubicPieces(contour);
  const protectedPointKeys = new Set();
  const sourcePointMap = new Map();

  const onCurveIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i].type) {
      onCurveIndices.push(i);
    }
  }

  for (const [onCurveOrdinal, pointIndex] of onCurveIndices.entries()) {
    const point = points[pointIndex];
    const isOpenEndpoint =
      !isClosed &&
      (onCurveOrdinal === 0 || onCurveOrdinal === onCurveIndices.length - 1);
    if (isOpenEndpoint || point.smooth !== true || hasNonEmptyAttrs(point)) {
      protectedPointKeys.add(pointIndex);
    }
  }

  const pieces = [];
  let insertedCounter = 0;
  for (const piece of basePieces) {
    const startKey = piece.startPointIndex;
    if (piece.kind !== "cubic") {
      pieces.push({ ...piece, startKey, endKey: piece.endPointIndex });
      continue;
    }
    const extremaTs = cubicExtremaParameters(piece.points);
    if (!extremaTs.length) {
      pieces.push({ ...piece, startKey, endKey: piece.endPointIndex });
      continue;
    }
    // Split the piece at each extremum, left to right.
    let currentPoints = piece.points;
    let currentStartKey = startKey;
    let currentStartPointIndex = piece.startPointIndex;
    let tOffset = 0;
    let tScale = 1;
    for (const [i, t] of extremaTs.entries()) {
      // t is relative to the original piece; convert to the current remainder.
      const localT = (t - tOffset) / tScale;
      const { left, right } = splitCubic(currentPoints, localT);
      const extremaKey = `extrema-${piece.sourceSegmentIndex}-${i}-${insertedCounter++}`;
      const extremaPoint = left[3];
      sourcePointMap.set(extremaKey, {
        point: extremaPoint,
        sourceSegmentIndex: piece.sourceSegmentIndex,
        t,
      });
      protectedPointKeys.add(extremaKey);
      pieces.push({
        kind: "cubic",
        mergeable: true,
        points: left,
        startPointIndex: currentStartPointIndex,
        endPointIndex: null,
        startKey: currentStartKey,
        endKey: extremaKey,
        sourceSegmentIndex: piece.sourceSegmentIndex,
      });
      currentPoints = right;
      currentStartKey = extremaKey;
      currentStartPointIndex = null;
      tOffset = t;
      tScale = 1 - t;
    }
    pieces.push({
      kind: "cubic",
      mergeable: true,
      points: currentPoints,
      startPointIndex: currentStartPointIndex,
      endPointIndex: piece.endPointIndex,
      startKey: currentStartKey,
      endKey: piece.endPointIndex,
      sourceSegmentIndex: piece.sourceSegmentIndex,
    });
  }

  return { pieces, protectedPointKeys, sourcePointMap, isClosed };
}

// Group neighboring mergeable cubic pieces into runs bounded by protected
// points, line segments, or contour endpoints. Runs with fewer than two
// pieces are dropped: a single piece is copied unchanged.
export function buildSimplifyRuns(analysis) {
  const { pieces, protectedPointKeys } = analysis;
  const runs = [];
  let currentRun = null;

  const flushRun = () => {
    if (currentRun && currentRun.pieces.length >= 2) {
      runs.push(currentRun);
    }
    currentRun = null;
  };

  for (const piece of pieces) {
    if (piece.kind !== "cubic" || !piece.mergeable) {
      flushRun();
      continue;
    }
    if (!currentRun) {
      currentRun = { pieces: [], startKey: piece.startKey };
    }
    currentRun.pieces.push(piece);
    if (protectedPointKeys.has(piece.endKey)) {
      currentRun.endKey = piece.endKey;
      flushRun();
    }
  }
  flushRun();
  // Do not wrap a run across the closed-contour seam (piece order boundary).
  return runs;
}

const SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];
const DEFAULT_MAX_TANGENT_ANGLE = 1; // degrees

function vectorLength(v) {
  return Math.hypot(v.x, v.y);
}

// Measure the largest distance between a run of original cubic pieces and a
// candidate replacement cubic, at fixed sample parameters.
export function maxCubicDeviation(originalPieces, candidate) {
  const n = originalPieces.length;
  let maxDistance = 0;
  for (const [i, piece] of originalPieces.entries()) {
    for (const t of SAMPLE_TS) {
      const originalPoint = cubicPoint(piece.points, t);
      // Map the sample to the candidate's normalized span parameter.
      const candidateT = (i + t) / n;
      const candidatePoint = cubicPoint(candidate, candidateT);
      const distance = Math.hypot(
        originalPoint.x - candidatePoint.x,
        originalPoint.y - candidatePoint.y
      );
      maxDistance = Math.max(maxDistance, distance);
    }
  }
  return maxDistance;
}

// Fit a single cubic to a run of cubic pieces. Endpoint positions and
// endpoint tangent directions are fixed; only the two handle lengths are
// searched (deterministically: a coarse grid, then local refinement).
// `originalPieces` are the run's pieces; tangents are direction vectors
// (their magnitudes are ignored). Returns [p0, c1, c2, p3] or null.
export function fitCubicToSpan(originalPieces, startTangent, endTangent) {
  const p0 = originalPieces[0].points[0];
  const p3 = originalPieces.at(-1).points[3];
  const startLength = vectorLength(startTangent);
  const endLength = vectorLength(endTangent);
  if (startLength === 0 || endLength === 0) {
    return null;
  }
  const startDir = { x: startTangent.x / startLength, y: startTangent.y / startLength };
  const endDir = { x: endTangent.x / endLength, y: endTangent.y / endLength };

  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const base = chord / 3 || Math.max(startLength, endLength) / 3 || 1;

  const buildCandidate = (alphaL, alphaR) => [
    p0,
    { x: p0.x + startDir.x * alphaL, y: p0.y + startDir.y * alphaL },
    { x: p3.x - endDir.x * alphaR, y: p3.y - endDir.y * alphaR },
    p3,
  ];

  let best = null;
  let bestError = Infinity;

  // Coarse deterministic grid: 20 multipliers per handle length.
  const multipliers = [];
  for (let i = 0; i < 20; i++) {
    multipliers.push(0.05 + (3.0 - 0.05) * (i / 19));
  }
  for (const mulL of multipliers) {
    for (const mulR of multipliers) {
      const error = maxCubicDeviation(
        originalPieces,
        buildCandidate(base * mulL, base * mulR)
      );
      if (error < bestError) {
        bestError = error;
        best = [base * mulL, base * mulR];
      }
    }
  }

  // Local refinement around the grid winner.
  let stepL = (base * (3.0 - 0.05)) / 19;
  let stepR = stepL;
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (let dL = -2; dL <= 2; dL++) {
      for (let dR = -2; dR <= 2; dR++) {
        const alphaL = best[0] + dL * stepL * 0.5;
        const alphaR = best[1] + dR * stepR * 0.5;
        if (alphaL <= 0 || alphaR <= 0) {
          continue;
        }
        const error = maxCubicDeviation(
          originalPieces,
          buildCandidate(alphaL, alphaR)
        );
        if (error < bestError) {
          bestError = error;
          best = [alphaL, alphaR];
          improved = true;
        }
      }
    }
    if (!improved) {
      stepL /= 4;
      stepR /= 4;
    }
  }

  return buildCandidate(best[0], best[1]);
}

function tangentAngleDegrees(candidate, originalPieces) {
  const first = originalPieces[0].points;
  const last = originalPieces.at(-1).points;
  const angleAt = (candidateVector, originalVector) => {
    const angle = (v) => Math.atan2(v.y, v.x);
    let delta = Math.abs(angle(candidateVector) - angle(originalVector));
    if (delta > Math.PI) {
      delta = 2 * Math.PI - delta;
    }
    return (delta * 180) / Math.PI;
  };
  const startError = angleAt(
    { x: candidate[1].x - candidate[0].x, y: candidate[1].y - candidate[0].y },
    { x: first[1].x - first[0].x, y: first[1].y - first[0].y }
  );
  const endError = angleAt(
    { x: candidate[3].x - candidate[2].x, y: candidate[3].y - candidate[2].y },
    { x: last[3].x - last[2].x, y: last[3].y - last[2].y }
  );
  return Math.max(startError, endError);
}

// Fit a single cubic to the run and check it against the tolerance and the
// maximum tangent angle error.
export function canMergeCubicPieces(originalPieces, tolerance, options = {}) {
  const maxTangentAngle = options.maxTangentAngle ?? DEFAULT_MAX_TANGENT_ANGLE;
  const first = originalPieces[0].points;
  const last = originalPieces.at(-1).points;
  const startTangent = { x: first[1].x - first[0].x, y: first[1].y - first[0].y };
  const endTangent = { x: last[3].x - last[2].x, y: last[3].y - last[2].y };
  const candidate = fitCubicToSpan(originalPieces, startTangent, endTangent);
  if (!candidate) {
    return false;
  }
  if (maxCubicDeviation(originalPieces, candidate) > tolerance) {
    return false;
  }
  if (tangentAngleDegrees(candidate, originalPieces) > maxTangentAngle) {
    return false;
  }
  return true;
}

// Greedily simplify one run: try the longest candidate first, shorten the
// end on rejection, emit the first original piece when nothing merges.
// Returns the replacement list of pieces (cubic piece records).
export function simplifyRun(run, options = {}) {
  const pieces = run.pieces;
  const tolerance = options.tolerance ?? 0.5;
  const result = [];
  let start = 0;
  while (start < pieces.length) {
    let merged = false;
    for (let end = pieces.length; end > start + 1; end--) {
      const candidatePieces = pieces.slice(start, end);
      const first = candidatePieces[0].points;
      const last = candidatePieces.at(-1).points;
      const startTangent = {
        x: first[1].x - first[0].x,
        y: first[1].y - first[0].y,
      };
      const endTangent = {
        x: last[3].x - last[2].x,
        y: last[3].y - last[2].y,
      };
      const candidate = fitCubicToSpan(candidatePieces, startTangent, endTangent);
      if (!candidate) {
        continue;
      }
      const maxTangentAngle =
        options.maxTangentAngle ?? DEFAULT_MAX_TANGENT_ANGLE;
      if (
        maxCubicDeviation(candidatePieces, candidate) <= tolerance &&
        tangentAngleDegrees(candidate, candidatePieces) <= maxTangentAngle
      ) {
        result.push({
          kind: "cubic",
          mergeable: true,
          points: candidate,
          startKey: candidatePieces[0].startKey,
          endKey: candidatePieces.at(-1).endKey,
          startPointIndex: candidatePieces[0].startPointIndex,
          endPointIndex: candidatePieces.at(-1).endPointIndex,
          sourceSegmentIndex: candidatePieces[0].sourceSegmentIndex,
          merged: true,
          mergedPieces: candidatePieces,
        });
        start = end;
        merged = true;
        break;
      }
    }
    if (!merged) {
      result.push(pieces[start]);
      start++;
    }
  }
  return result;
}
