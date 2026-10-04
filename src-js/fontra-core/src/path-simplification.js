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
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
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

  const numSegments = isClosed ? onCurveIndices.length : onCurveIndices.length - 1;

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

// Two points this close together are the same point as far as rounding is
// concerned. Used for comparing results, not for deciding where points go.
const SAME_POINT_DISTANCE = 0.01;

// Default spacing below which an extremum is not worth its own point. The
// caller normally passes the tolerance instead.
const DEFAULT_EXTREMA_MIN_DISTANCE = 1;

// A tangent pointing straight along x or y marks a turning point of the
// curve. The test is relative to the tangent's own length, so it holds at any
// drawing scale.
function isAxisAligned(tangent) {
  const length = Math.hypot(tangent.x, tangent.y);
  if (length === 0) {
    return false;
  }
  return (
    Math.abs(tangent.x) / length < AXIS_ALIGNED_RATIO ||
    Math.abs(tangent.y) / length < AXIS_ALIGNED_RATIO
  );
}

// A fold that reproduces the run this closely, with handles this even, is
// taken as the answer rather than a starting guess. Not zero, because a
// drawing on whole units is a rounded drawing: the pieces of what was once a
// single curve no longer fold back to it exactly, and half a unit covers that
// while staying inside the smallest tolerance the command will use.
const FIT_EXACT_ENOUGH = 0.5;
const FIT_BALANCED_RATIO = 1.5;

// The coarse grid of starting handle lengths, as multiples of a third of the
// run's chord, and how many of its best cells are refined.
const FIT_GRID_STEPS = 8;
const FIT_REFINED_STARTS = 2;

// A single cubic cannot hold much more than a quarter turn without sagging
// away from what it replaces, so a span that turns further than this is
// refused before it is fitted. Fitting it and measuring the result costs
// hundreds of times more than adding up its tangents, and the answer is the
// same: no.
const MAX_SPAN_TURN_DEGREES = 170;

// How far the outline's direction turns from one end of a run to the other,
// following each piece and each joint between them.
function spanTurnDegrees(pieces) {
  let total = 0;
  let previousTangent = null;
  for (const piece of pieces) {
    const start = pieceStartTangent(piece);
    const end = pieceEndTangent(piece);
    if (previousTangent) {
      total += angleBetweenDegrees(previousTangent, start);
    }
    total += angleBetweenDegrees(start, end);
    previousTangent = end;
  }
  return total;
}

function fitGridMultiplier(index) {
  return 0.15 + (3.0 - 0.15) * (index / (FIT_GRID_STEPS - 1));
}

// Two fits whose largest distance differs by less than this are as good as
// each other, and the evener one wins.
const FIT_ERROR_TIE = 0.05;

// About a third of a degree off axis still counts as on axis.
const AXIS_ALIGNED_RATIO = 0.006;

function hasNonEmptyAttrs(point) {
  return !!point.attrs && Object.keys(point.attrs).length > 0;
}

// What Simplify writes has to FIT the curve it replaces, not only lie near it.
// A curve can stay inside the tolerance and still be broken: one handle
// collapsed beside a long one draws a hook smaller than a unit, and the
// distance never sees it. So a written curve also has to leave and arrive with
// the curvature the original had there, within this share, and no handle may
// pass the point where the tangents cross.
//
// Equal handles were tried as the test and refused a plain arch: halving a
// curve at its apex leaves halves whose own handles are not equal, so a rule
// on the handles judges the drawing, not the fit. The curvature at the ends is
// what a broken fit gets wrong.
const FIT_ALLOWANCE = 0.2;

// Curvatures are compared as bends: curvature times the curve's chord, which
// is the angle the curve would turn if it kept that curvature along its
// length, so the comparison means the same at any drawing size. Below this
// bend a curve is nearly straight there, and comparing two nearly-zero
// curvatures as a ratio measures noise.
//
// ponytail: a fixed floor on the bend; tie it to the grid's own resolution
// if near-straight joints start refusing or passing for the wrong reason.
const FLAT_BEND = 0.05;

function signedCurvature(points, t) {
  const [p0, p1, p2, p3] = points;
  const d = cubicDerivative(points, t);
  const u = 1 - t;
  const dd = {
    x: 6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
    y: 6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
  };
  const speed = Math.hypot(d.x, d.y);
  return speed === 0 ? 0 : (d.x * dd.y - d.y * dd.x) / speed ** 3;
}

function chordOf(points) {
  return Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y);
}

// How far a curvature misses the original's, as a share of the original's.
// Where the original is nearly straight the share is taken of the flat bend
// instead, so two nearly-zero curvatures are not compared as a ratio of noise.
function curvatureMiss(k, originalK, length) {
  return Math.abs(k - originalK) / Math.max(Math.abs(originalK), FLAT_BEND / length);
}

function curvaturesAgree(k, originalK, length) {
  return curvatureMiss(k, originalK, length) <= FIT_ALLOWANCE;
}

// How far each handle of a cubic may reach: the distance from its end to the
// point where the two end tangents cross, when they cross ahead of both ends.
// Otherwise the chord, the length a handle of a gentle curve is measured
// against. `startDir` leaves p0 and `endDir` arrives at p3.
function handleReaches(p0, startDir, p3, endDir) {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const den = startDir.x * endDir.y - startDir.y * endDir.x;
  if (Math.abs(den) > 1e-12) {
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const s = (dx * endDir.y - dy * endDir.x) / den;
    const u = (dx * startDir.y - dy * startDir.x) / den;
    if (s > 0 && u > 0) {
      return [s, u];
    }
  }
  return [chord, chord];
}

function unitVector(v) {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? null : { x: v.x / length, y: v.y / length };
}

function startDirection(points) {
  return (
    unitVector(directionBetween(points[0], points[1])) ??
    unitVector(directionBetween(points[0], points[2]))
  );
}

function endDirection(points) {
  return (
    unitVector(directionBetween(points[2], points[3])) ??
    unitVector(directionBetween(points[1], points[3]))
  );
}

// The two tensions of a cubic, each handle's length over its reach.
function handleTensionsOf(points) {
  const startDir = startDirection(points);
  const endDir = endDirection(points);
  if (!startDir || !endDir) {
    return null;
  }
  const [r0, r3] = handleReaches(points[0], startDir, points[3], endDir);
  return [
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) / r0,
    Math.hypot(points[3].x - points[2].x, points[3].y - points[2].y) / r3,
  ];
}

// Tension a hair over 1 is the grid, not a curve doubling back.
const TENSION_CEILING = 1.02;

// Whether a cubic's two tensions are within the allowance of each other.
function isBalanced(points) {
  const tensions = handleTensionsOf(points);
  if (!tensions) {
    return false;
  }
  const [t1, t2] = tensions;
  const mean = (t1 + t2) / 2;
  return mean > 0 && Math.abs(t1 - t2) <= FIT_ALLOWANCE * mean;
}

function withinCeiling(points) {
  const tensions = handleTensionsOf(points);
  return !!tensions && tensions[0] <= TENSION_CEILING && tensions[1] <= TENSION_CEILING;
}

function endCurvaturesAgree(candidate, originalPieces) {
  const length = chordOf(candidate);
  return (
    curvaturesAgree(
      signedCurvature(candidate, 0),
      signedCurvature(originalPieces[0].points, 0),
      length
    ) &&
    curvaturesAgree(
      signedCurvature(candidate, 1),
      signedCurvature(originalPieces.at(-1).points, 1),
      length
    )
  );
}

// Whether a whole-unit cubic fits the original curve it stands for. The
// original is the exact curve as a list of pieces, so its end curvatures are
// read off its first and last piece.
function fitsOriginal(candidate, originalPieces, tolerance) {
  return (
    withinCeiling(candidate) &&
    endCurvaturesAgree(candidate, originalPieces) &&
    maxCubicDeviation(originalPieces, candidate) <= tolerance
  );
}

// The whole-unit cubic from p0 to p3, with the given end directions, that
// fits the original: it leaves and arrives with the original's curvature,
// within the allowance, and among those lies nearest it. With both end
// directions held, two handle lengths and two end curvatures leave nothing
// free, so the search looks for the lengths that match the curvatures and
// then for the whole-unit handles next to them. Null when nothing on whole
// units fits: the curve is too small for the grid to hold its shape.
function gridFit(originalPieces, p0, startDir, p3, endDir, options = {}) {
  const requireBalance = options.balanced ?? false;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (chord === 0) {
    return null;
  }
  const k0 = signedCurvature(originalPieces[0].points, 0);
  const k3 = signedCurvature(originalPieces.at(-1).points, 1);
  const build = (a, b, round) => {
    const h1 = { x: p0.x + startDir.x * a, y: p0.y + startDir.y * a };
    const h2 = { x: p3.x - endDir.x * b, y: p3.y - endDir.y * b };
    return round ? [p0, roundPoint(h1), roundPoint(h2), p3] : [p0, h1, h2, p3];
  };
  const miss = (candidate) =>
    Math.max(
      curvatureMiss(signedCurvature(candidate, 0), k0, chord),
      curvatureMiss(signedCurvature(candidate, 1), k3, chord)
    );

  // Lengths that fit, in floating point. An exact match of both curvatures
  // often does not exist, and where it does there can be several, so the
  // search keeps every length pair that fits within the allowance and prefers
  // the ones nearest the original. Failing any, the closest match is refined
  // from the best few, in case the fitting region is narrower than the look.
  const STEPS = 30;
  const searchPolyline = piecesPolyline(originalPieces, SEARCH_POLYLINE_STEPS);
  const coarse = [];
  for (let i = 1; i <= STEPS; i++) {
    for (let j = 1; j <= STEPS; j++) {
      const a = (chord * 1.2 * i) / STEPS;
      const b = (chord * 1.2 * j) / STEPS;
      coarse.push({ a, b, miss: miss(build(a, b, false)) });
    }
  }
  const fitting = coarse
    .filter((cell) => cell.miss <= FIT_ALLOWANCE)
    .map((cell) => ({
      ...cell,
      error: deviationAgainst(
        originalPieces,
        build(cell.a, cell.b, false),
        searchPolyline,
        SEARCH_POLYLINE_STEPS
      ),
    }))
    .sort((x, y) => x.error - y.error);
  coarse.sort((x, y) => x.miss - y.miss);
  const matched = [
    ...fitting.slice(0, 3),
    ...coarse.slice(0, 3).map((start) => {
      let { a, b, miss: best } = start;
      let step = (chord * 1.2) / STEPS / 2;
      for (let round = 0; round < 60 && step > 0.01; round++) {
        let improved = false;
        for (const [da, db] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ]) {
          const na = a + da * step;
          const nb = b + db * step;
          if (na <= 0 || nb <= 0) {
            continue;
          }
          const m = miss(build(na, nb, false));
          if (m < best) {
            ({ a, b } = { a: na, b: nb });
            best = m;
            improved = true;
          }
        }
        if (!improved) {
          step /= 2;
        }
      }
      return { a, b };
    }),
  ];

  // The whole-unit handles around each match. Rounding a handle moves the
  // curvature, so the neighbours are tried and the fitting one nearest the
  // original is kept.
  const polyline = piecesPolyline(originalPieces);
  let best = null;
  const tried = new Set();
  for (const { a, b } of matched) {
    // The coarse look steps a fortieth of the chord, so the neighbourhood
    // covers at least one step either way.
    const reach = Math.max(2, (chord * 1.2) / STEPS);
    for (let da = -reach; da <= reach; da += 0.5) {
      for (let db = -reach; db <= reach; db += 0.5) {
        if (a + da <= 0 || b + db <= 0) {
          continue;
        }
        const candidate = build(a + da, b + db, true);
        const key = `${candidate[1].x},${candidate[1].y},${candidate[2].x},${candidate[2].y}`;
        if (tried.has(key)) {
          continue;
        }
        tried.add(key);
        if (
          miss(candidate) > FIT_ALLOWANCE ||
          !withinCeiling(candidate) ||
          (requireBalance && !isBalanced(candidate))
        ) {
          continue;
        }
        const error = deviationAgainst(originalPieces, candidate, polyline);
        if (!best || error < best.error) {
          best = { candidate, error };
        }
      }
    }
  }
  return best?.candidate ?? null;
}

// The part of a cubic between parameters a and b.
function subCubic(points, a, b) {
  const right = a > 0 ? splitCubic(points, a).right : points;
  return b < 1 ? splitCubic(right, (b - a) / (1 - a)).left : right;
}

// Split one cubic at its extrema and fit each part on whole units, with the
// new points' handles on the axis. Returns the fitted parts, or null when any
// part does not fit: then an orthogonal point there would break the curve,
// and what does fit there is not the extremum.
//
// A part that runs from a corner has one more condition: its two handles are
// balanced. A corner's handle is the designer's statement of how the curve
// leaves the corner, and an extremum close to it is usually the curve
// leaning a unit or two past the corner on its way out rather than a turn of
// its own; the part between them then fits only with one handle doing all the
// work. `corners` says which ends of the cubic are corners.
function fitExtremaSplit(points, ts, tolerance, corners = {}) {
  const bounds = [0, ...ts, 1];
  const ends = bounds.map((t, i) => {
    if (i === 0) {
      return { point: points[0], leave: startDirection(points) };
    }
    if (i === bounds.length - 1) {
      return { point: points[3], arrive: endDirection(points) };
    }
    const exact = cubicPoint(points, t);
    const tangent = cubicDerivative(points, t);
    const axis =
      Math.abs(tangent.x) < Math.abs(tangent.y)
        ? { x: 0, y: Math.sign(tangent.y) }
        : { x: Math.sign(tangent.x), y: 0 };
    const point = { x: roundCoordinate(exact.x), y: roundCoordinate(exact.y) };
    return { point, leave: axis, arrive: axis };
  });
  if (ends.some((end) => (end.leave ?? end.arrive) === null)) {
    return null;
  }
  const parts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const original = [{ points: subCubic(points, bounds[i], bounds[i + 1]) }];
    const fitted = gridFit(
      original,
      ends[i].point,
      ends[i].leave,
      ends[i + 1].point,
      ends[i + 1].arrive,
      {
        balanced:
          (i === 0 && !!corners.start) || (i === bounds.length - 2 && !!corners.end),
      }
    );
    if (!fitted || !fitsOriginal(fitted, original, tolerance)) {
      return null;
    }
    parts.push({ points: fitted, sourcePoints: original[0].points, t: bounds[i + 1] });
  }
  return parts;
}

// The extrema of one cubic that get a point: each one, in order, is kept only
// when the cubic still splits into fitting parts with it. Returns the kept
// parameters and the fitted parts for them.
function fittingExtrema(points, tolerance, corners = {}) {
  let kept = [];
  let parts = null;
  for (const t of interiorExtremaParameters(points, tolerance)) {
    const tried = fitExtremaSplit(points, [...kept, t], tolerance, corners);
    if (tried) {
      kept = [...kept, t];
      parts = tried;
    }
  }
  return { ts: kept, parts };
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
  const insertExtrema = options.insertExtrema ?? true;
  const extremaMinDistance = options.tolerance ?? DEFAULT_EXTREMA_MIN_DISTANCE;
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

  // A point that already sits on an extremum is protected as firmly as one we
  // would have inserted there. Without this a circle, whose four points are
  // all extrema and all smooth, has nothing holding its runs apart: the whole
  // outline becomes one run, merges at the wrong places, and the extrema pass
  // then scatters fresh points near the old ones.
  for (const piece of basePieces) {
    if (piece.kind !== "cubic") {
      continue;
    }
    if (isAxisAligned(cubicDerivative(piece.points, 0))) {
      protectedPointKeys.add(piece.startPointIndex);
    }
    if (isAxisAligned(cubicDerivative(piece.points, 1))) {
      protectedPointKeys.add(piece.endPointIndex);
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
    const { ts: extremaTs, parts } = insertExtrema
      ? fittingExtrema(piece.points, extremaMinDistance, {
          start: points[piece.startPointIndex].smooth !== true,
          end: points[piece.endPointIndex].smooth !== true,
        })
      : { ts: [], parts: null };
    if (!extremaTs.length) {
      pieces.push({ ...piece, startKey, endKey: piece.endPointIndex });
      continue;
    }
    // One piece per fitted part. A part is written as fitted, and measured
    // against as the exact curve it stands for.
    let currentStartKey = startKey;
    let currentStartPointIndex = piece.startPointIndex;
    for (const [i, part] of parts.entries()) {
      const isLast = i === parts.length - 1;
      let endKey = piece.endPointIndex;
      if (!isLast) {
        endKey = `extrema-${piece.sourceSegmentIndex}-${i}-${insertedCounter++}`;
        sourcePointMap.set(endKey, {
          point: part.points[3],
          sourceSegmentIndex: piece.sourceSegmentIndex,
          t: part.t,
        });
        protectedPointKeys.add(endKey);
      }
      pieces.push({
        kind: "cubic",
        mergeable: true,
        points: part.points,
        sourcePoints: part.sourcePoints,
        startPointIndex: currentStartPointIndex,
        endPointIndex: isLast ? piece.endPointIndex : null,
        startKey: currentStartKey,
        endKey,
        sourceSegmentIndex: piece.sourceSegmentIndex,
      });
      currentStartKey = endKey;
      currentStartPointIndex = null;
    }
  }

  // Runs never wrap around the end of a closed contour, so whatever point the
  // contour happens to start on can never be merged away. Start the walk on a
  // protected point instead: then the seam falls where a run would have ended
  // anyway, and no point is privileged by the accident of being written first.
  // The shape is unchanged; the points are listed from a different starting
  // place. Every master rotates to the same place, because they share which
  // points are protected.
  const rotated =
    isClosed && pieces.length && !protectedPointKeys.has(pieces[0].startKey)
      ? rotateToProtectedStart(pieces, protectedPointKeys)
      : pieces;

  return { pieces: rotated, protectedPointKeys, sourcePointMap, isClosed };
}

function rotateToProtectedStart(pieces, protectedPointKeys) {
  const start = pieces.findIndex((piece) => protectedPointKeys.has(piece.startKey));
  if (start <= 0) {
    // Nothing is protected anywhere: leave the order alone.
    return pieces;
  }
  return [...pieces.slice(start), ...pieces.slice(0, start)];
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

// Distance from a point to a line segment.
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
    t = Math.min(1, Math.max(0, t));
  }
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// ponytail: 64-segment polyline approximation of the candidate; raise the
// count if sub-0.01-unit tolerances ever need to be trusted.
const CANDIDATE_POLYLINE_STEPS = 64;

function candidatePolyline(candidate, steps = CANDIDATE_POLYLINE_STEPS) {
  const polyline = [];
  for (let i = 0; i <= steps; i++) {
    polyline.push(cubicPoint(candidate, i / steps));
  }
  return polyline;
}

// While searching, the two curves are compared at a quarter of the detail.
// The search only needs to know which of two candidates is better, and the
// winner is measured again at full detail before it is accepted.
//
// Cutting this further to make long runs cheaper was tried and reverted: at
// 4 steps a 96-point circle came back as 24 points instead of 12, because a
// coarsely ranked fit is a worse fit and the longer merges stop being
// accepted.
const SEARCH_POLYLINE_STEPS = 16;

// Measure the largest distance between a run of original cubic pieces and a
// candidate replacement cubic. The two curves are not parameterized alike --
// a piece covering a short arc still spans t=0..1 -- so each original sample
// is measured against the *closest* point on the candidate, not against a
// guessed parameter.
//
// `reverse` also measures the candidate against the original. Without it a
// candidate with over-long handles can bulge away and still pass, because
// every original sample happens to lie near some part of it. The inner fit
// search skips it for speed; acceptance always uses it.
export function maxCubicDeviation(originalPieces, candidate, options = {}) {
  const reverse = options.reverse ?? true;
  return deviationAgainst(
    originalPieces,
    candidate,
    reverse ? (options.originalPolyline ?? piecesPolyline(originalPieces)) : null
  );
}

// `originalPolyline` is the original run drawn out as a polyline, or null to
// skip the reverse direction. The caller passes it in when it is about to
// measure many candidates against the same run: building it per candidate
// costs more than everything else here put together.
function deviationAgainst(originalPieces, candidate, originalPolyline, steps) {
  const polyline = candidatePolyline(candidate, steps);
  let maxDistance = 0;
  for (const piece of originalPieces) {
    for (const t of SAMPLE_TS) {
      maxDistance = Math.max(
        maxDistance,
        nearestDistance(cubicPoint(piece.points, t), polyline)
      );
    }
  }
  if (originalPolyline) {
    for (const point of polyline) {
      maxDistance = Math.max(maxDistance, nearestDistance(point, originalPolyline));
    }
  }
  return maxDistance;
}

function nearestDistance(point, polyline) {
  let nearest = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    nearest = Math.min(nearest, distanceToSegment(point, polyline[i], polyline[i + 1]));
  }
  return nearest;
}

function piecesPolyline(pieces, steps = CANDIDATE_POLYLINE_STEPS) {
  const polyline = [];
  for (const piece of pieces) {
    for (let i = 0; i <= steps; i++) {
      polyline.push(cubicPoint(piece.points, i / steps));
    }
  }
  return polyline;
}

// Estimate the parameter at which a single cubic would have been split to
// produce these two adjacent pieces. The joint's two neighbouring handles are
// collinear for a true split, and the parameter is where the joint sits
// between them. Returns null when the geometry gives no usable answer.
function estimateSplitParameter(leftPoints, rightPoints) {
  const joint = leftPoints[3];
  const before =
    Math.abs(leftPoints[2].x - joint.x) + Math.abs(leftPoints[2].y - joint.y);
  const after =
    Math.abs(rightPoints[1].x - joint.x) + Math.abs(rightPoints[1].y - joint.y);
  const total = before + after;
  if (before === 0 || after === 0 || total === 0) {
    return null;
  }
  const t = before / total;
  return t > 0 && t < 1 ? t : null;
}

// Undo a de Casteljau split: given two adjacent pieces and the parameter that
// produced them, recover the single cubic they came from. The recovered
// handles stay on the original endpoint tangent lines, so a run's start and
// end tangent directions survive untouched.
function unsplitCubic(leftPoints, rightPoints, t) {
  const p0 = leftPoints[0];
  const p3 = rightPoints[3];
  return [
    p0,
    {
      x: p0.x + (leftPoints[1].x - p0.x) / t,
      y: p0.y + (leftPoints[1].y - p0.y) / t,
    },
    {
      x: p3.x + (rightPoints[2].x - p3.x) / (1 - t),
      y: p3.y + (rightPoints[2].y - p3.y) / (1 - t),
    },
    p3,
  ];
}

// Fit a single cubic to a run of cubic pieces. Endpoint positions and endpoint
// tangent directions are fixed; only the two handle lengths vary.
//
// The starting guess folds the run pairwise with `unsplitCubic`, which is
// exact whenever the run really is one curve that was cut up (the common case
// after extrema insertion). A short pattern search then refines the two
// lengths for runs that were never one curve. `originalPieces` are the run's
// pieces; tangents are direction vectors (magnitudes ignored). Returns
// [p0, c1, c2, p3] or null.
// Fitting depends only on the geometry handed to it, never on the tolerance,
// yet the command asks for the same fits again at every tolerance it tries.
// The answers are kept here, keyed by that geometry.
//
// ponytail: a plain Map with a size cap, cleared wholesale when it fills.
// An LRU would be better if this ever holds a whole font's worth of fits.
const fitCache = new Map();
const FIT_CACHE_LIMIT = 4096;

function fitCacheKey(pieces, startTangent, endTangent) {
  const parts = [startTangent.x, startTangent.y, endTangent.x, endTangent.y];
  for (const piece of pieces) {
    for (const point of piece.points) {
      parts.push(point.x, point.y);
    }
    parts.push("|");
  }
  return parts.join(",");
}

export function fitCubicToSpan(originalPieces, startTangent, endTangent) {
  if (
    originalPieces.length > 1 &&
    spanTurnDegrees(originalPieces) > MAX_SPAN_TURN_DEGREES
  ) {
    return null;
  }
  const cacheKey = fitCacheKey(originalPieces, startTangent, endTangent);
  if (fitCache.has(cacheKey)) {
    return fitCache.get(cacheKey);
  }
  const fitted = fitCubicToSpanUncached(originalPieces, startTangent, endTangent);
  if (fitCache.size >= FIT_CACHE_LIMIT) {
    fitCache.clear();
  }
  fitCache.set(cacheKey, fitted);
  return fitted;
}

function fitCubicToSpanUncached(originalPieces, startTangent, endTangent) {
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

  // The full two-way measure, the same one acceptance uses. A one-way
  // measure is blind to a candidate that bulges away from the original while
  // every sample of the original still lies near some part of it, and the
  // search walks straight into exactly that: lopsided handles that score well
  // one way and badly the other.
  const searchSteps = SEARCH_POLYLINE_STEPS;
  const searchPolyline = piecesPolyline(originalPieces, searchSteps);
  const measure = (alphaL, alphaR) =>
    deviationAgainst(
      originalPieces,
      buildCandidate(alphaL, alphaR),
      searchPolyline,
      searchSteps
    );

  // Pattern search from one starting pair: halve the step whenever no
  // neighbour improves.
  const search = (start) => {
    let best = start;
    let bestError = measure(best[0], best[1]);
    let step = Math.max(best[0], best[1]) / 4;
    const minStep = base * 1e-6;
    // ponytail: the round cap also bounds a search that keeps improving by
    // vanishing amounts; raise it only if fits visibly stop short.
    for (let round = 0; round < 200 && step > minStep; round++) {
      let improved = false;
      for (const [dL, dR] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const alphaL = best[0] + dL * step;
        const alphaR = best[1] + dR * step;
        if (alphaL <= 0 || alphaR <= 0) {
          continue;
        }
        const error = measure(alphaL, alphaR);
        if (error < bestError) {
          bestError = error;
          best = [alphaL, alphaR];
          improved = true;
        }
      }
      if (!improved) {
        step /= 2;
      }
    }
    return { lengths: best, error: bestError };
  };

  // Folding the run back into a single cubic, pair by pair, is exact when the
  // run really was one curve that got cut up — which is the common case,
  // since inserting extrema cuts curves. When that start already reproduces
  // the run to well under a hundredth of a unit there is nothing left to
  // look for, and the grid below is skipped.
  const starts = [];
  let folded = originalPieces[0].points;
  for (const piece of originalPieces.slice(1)) {
    const t = estimateSplitParameter(folded, piece.points);
    if (t === null) {
      folded = null;
      break;
    }
    folded = unsplitCubic(folded, piece.points, t);
  }
  if (folded) {
    const alphaL = Math.hypot(folded[1].x - p0.x, folded[1].y - p0.y);
    const alphaR = Math.hypot(folded[2].x - p3.x, folded[2].y - p3.y);
    if (
      alphaL > 0 &&
      alphaR > 0 &&
      Number.isFinite(alphaL) &&
      Number.isFinite(alphaR)
    ) {
      // Judged at full detail, not by the coarse search measure, whose own
      // 16-step chord error is on the same scale as this threshold.
      //
      // Accurate is not enough on its own: the fold that had to be hunted
      // down with the grid was wrong by 0.42, inside any threshold loose
      // enough to cover rounding, and its handles were 86 against 37. An
      // evenly built fold that reproduces the run is the answer; a lopsided
      // one is a guess, however well it scores, so it goes to the grid.
      const foldedCandidate = buildCandidate(alphaL, alphaR);
      const lopsided =
        Math.max(alphaL, alphaR) / Math.min(alphaL, alphaR) > FIT_BALANCED_RATIO;
      if (
        !lopsided &&
        maxCubicDeviation(originalPieces, foldedCandidate) < FIT_EXACT_ENOUGH
      ) {
        return foldedCandidate;
      }
      starts.push([alphaL, alphaR]);
    }
  }

  // Otherwise the run was never one curve. The error surface then has narrow
  // valleys: on a real contour 63 and 63 scores 0.10 while 60 and 60 scores
  // 1.62, so a search that walks downhill from one guess steps straight over
  // the good answer. A coarse grid finds which valleys exist, and the best
  // few are refined.
  const gridErrors = [];
  for (let i = 0; i < FIT_GRID_STEPS; i++) {
    for (let j = 0; j < FIT_GRID_STEPS; j++) {
      const lengths = [base * fitGridMultiplier(i), base * fitGridMultiplier(j)];
      gridErrors.push({ lengths, error: measure(lengths[0], lengths[1]) });
    }
  }
  gridErrors.sort((a, b) => a.error - b.error);
  starts.push(...gridErrors.slice(0, FIT_REFINED_STARTS).map((entry) => entry.lengths));

  const results = starts.map(search).map((result) => ({
    ...result,
    // Judged again at full detail: the coarse search only ranked candidates.
    error: maxCubicDeviation(
      originalPieces,
      buildCandidate(result.lengths[0], result.lengths[1])
    ),
  }));
  const lowestError = Math.min(...results.map((result) => result.error));
  // The objective is the LARGEST distance, and it has a flat floor: many pairs
  // of handle lengths score within a hair of each other, one of them wildly
  // lopsided. Among those that fit equally well, take the evenest pair, which
  // is the one that draws the curve a designer would have drawn.
  const imbalance = ({ lengths: [left, right] }) =>
    Math.abs(left - right) / (left + right);
  const best = results
    .filter((result) => result.error <= lowestError + FIT_ERROR_TIE)
    .sort((a, b) => imbalance(a) - imbalance(b))[0].lengths;

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
  return applyRunPlan(run, planRunMerges(run, options), options);
}

// Points live on whole units, the same as everywhere else in the editor. The
// fitting above works in floating point throughout; this is the one place the
// result is written back, which is where it lands on the grid.
function roundCoordinate(value) {
  return Math.round(value);
}

function directionBetween(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function angleBetweenDegrees(v1, v2) {
  if (vectorLength(v1) === 0 || vectorLength(v2) === 0) {
    return 0;
  }
  let delta = Math.abs(Math.atan2(v1.y, v1.x) - Math.atan2(v2.y, v2.x));
  if (delta > Math.PI) {
    delta = 2 * Math.PI - delta;
  }
  return (delta * 180) / Math.PI;
}

// The tangent direction with which a piece arrives at its end point.
function pieceEndTangent(piece) {
  const points = piece.points;
  return directionBetween(points.at(-2), points.at(-1));
}

// The tangent direction with which a piece leaves its start point.
function pieceStartTangent(piece) {
  return directionBetween(piece.points[0], piece.points[1]);
}

// Drop on-curve points that sit in the middle of a straight.
//
// Two line segments meeting in a straight line need no point between them:
// the point adds nothing to the shape and everything to the editing. A point
// is only dropped when it is off the straight by no more than the tolerance,
// carries no attributes, and is not an endpoint of an open contour.
//
// Several contours are passed together when they are interpolation-compatible
// masters, and a point goes only when every master agrees it is redundant, so
// the masters keep identical point counts.
export function removeStraightLinePoints(contours, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_EXTREMA_MIN_DISTANCE;

  const removablePerContour = contours.map((contour) => {
    const { points, isClosed } = contour;
    const onCurveIndices = points
      .map((point, i) => (point.type ? -1 : i))
      .filter((i) => i >= 0);
    const removable = new Set();
    // A closed contour needs three corners to enclose anything; an open one
    // needs its two ends.
    const minimum = isClosed ? 3 : 2;
    if (onCurveIndices.length <= minimum) {
      return removable;
    }
    for (const [ordinal, pointIndex] of onCurveIndices.entries()) {
      const isEnd = ordinal === 0 || ordinal === onCurveIndices.length - 1;
      if ((!isClosed && isEnd) || hasNonEmptyAttrs(points[pointIndex])) {
        continue;
      }
      // Both neighbours must be on-curve, which is what makes both of this
      // point's segments straight lines.
      const previous = points[(pointIndex - 1 + points.length) % points.length];
      const next = points[(pointIndex + 1) % points.length];
      if (previous.type || next.type) {
        continue;
      }
      if (distanceToSegment(points[pointIndex], previous, next) <= tolerance) {
        removable.add(pointIndex);
      }
    }
    return removable;
  });

  // Every master has to agree, and they only line up at all if their point
  // counts already match.
  const counts = contours.map((contour) => contour.points.length);
  if (counts.some((count) => count !== counts[0])) {
    return contours;
  }
  const agreed = [...removablePerContour[0]].filter((pointIndex) =>
    removablePerContour.every((removable) => removable.has(pointIndex))
  );
  if (!agreed.length) {
    return contours;
  }
  const drop = new Set(agreed);
  return contours.map((contour) => ({
    points: contour.points.filter((_, i) => !drop.has(i)),
    isClosed: contour.isClosed,
  }));
}

// Put an on-curve point at every interior extremum of every cubic segment.
//
// This runs last, on the already-merged contour, because a merge can create
// an extremum that none of the original segments had. Running it here instead
// of only up front also makes Simplify a fixed point: a second run finds
// every extremum already occupied and changes nothing.
//
// Several contours are passed together when they are interpolation-compatible
// masters. A segment is only split when every master finds the same number of
// extrema in it, so the masters keep identical point counts.
export function insertExtremaPoints(contours, options = {}) {
  const minDistance = options.tolerance ?? DEFAULT_EXTREMA_MIN_DISTANCE;
  const piecesPerContour = contours.map((contour) =>
    contour.points.length && !contour.points[0].type
      ? contourToCubicPieces(contour)
      : null
  );
  if (piecesPerContour.some((pieces) => pieces === null)) {
    // A contour starting on an off-curve point is not something this walker
    // can index safely; leave every master alone rather than guess.
    return contours;
  }

  // Each segment's extrema that fit, with the fitted parts they split it into.
  const splitsPerContour = piecesPerContour.map((pieces, contourIndex) =>
    pieces.map((piece) => {
      const points = contours[contourIndex].points;
      return piece.kind === "cubic"
        ? fittingExtrema(piece.points, minDistance, {
            start: points[piece.startPointIndex].smooth !== true,
            end: points[piece.endPointIndex].smooth !== true,
          })
        : { ts: [], parts: null };
    })
  );
  const rootsPerContour = splitsPerContour.map((splits) =>
    splits.map((split) => split.ts)
  );
  const numSegments = rootsPerContour[0].length;
  if (rootsPerContour.some((roots) => roots.length !== numSegments)) {
    return contours;
  }
  // Drop a segment's extrema unless every master agrees on how many there are.
  for (let s = 0; s < numSegments; s++) {
    const count = rootsPerContour[0][s].length;
    if (rootsPerContour.some((roots) => roots[s].length !== count)) {
      for (const roots of rootsPerContour) {
        roots[s] = [];
      }
    }
  }
  if (rootsPerContour.every((roots) => roots.every((ts) => !ts.length))) {
    return contours;
  }

  return contours.map((contour, contourIndex) => {
    const pieces = piecesPerContour[contourIndex];
    const roots = rootsPerContour[contourIndex];
    const points = [];
    for (const [s, piece] of pieces.entries()) {
      // The segment's start on-curve point, kept exactly as it was.
      points.push(contour.points[piece.startPointIndex]);
      if (piece.kind !== "cubic" || !roots[s].length) {
        points.push(...piece.points.slice(1, -1));
        continue;
      }
      const parts = splitsPerContour[contourIndex][s].parts;
      for (const [i, part] of parts.entries()) {
        points.push(
          { ...part.points[1], type: "cubic" },
          { ...part.points[2], type: "cubic" }
        );
        if (i < parts.length - 1) {
          points.push({ x: part.points[3].x, y: part.points[3].y, smooth: true });
        }
      }
    }
    if (!contour.isClosed) {
      points.push(contour.points.at(-1));
    }
    return { points: points.map(roundPoint), isClosed: contour.isClosed };
  });
}

// Interior extrema of one cubic that are worth a point of their own.
//
// An extremum closer than `minDistance` to one of the segment's own end
// points is dropped: the outline already turns there as far as anyone can
// see, and inserting a point on top of an existing one is how a "simplify"
// command ends up adding points. Extrema that crowd each other are thinned
// the same way, which matters on an overshooting segment where the curve
// doubles back on itself near a cusp.
function interiorExtremaParameters(points, minDistance = DEFAULT_EXTREMA_MIN_DISTANCE) {
  const kept = [];
  const keptPoints = [points[0], points[3]];
  for (const t of cubicExtremaParameters(points)) {
    const splitPoint = cubicPoint(points, t);
    const crowded = keptPoints.some(
      (other) =>
        Math.hypot(splitPoint.x - other.x, splitPoint.y - other.y) <= minDistance
    );
    if (!crowded) {
      kept.push(t);
      keptPoints.push(splitPoint);
    }
  }
  return kept;
}

// Two unpacked contours describe the same outline: same points, same flags.
function sameContour(a, b) {
  return (
    !!a &&
    !!b &&
    a.isClosed === b.isClosed &&
    a.points.length === b.points.length &&
    a.points.every((point, i) => {
      const other = b.points[i];
      return (
        Math.abs(point.x - other.x) <= SAME_POINT_DISTANCE &&
        Math.abs(point.y - other.y) <= SAME_POINT_DISTANCE &&
        (point.type ?? null) === (other.type ?? null)
      );
    })
  );
}

function roundPoint(point) {
  const out = { ...point, x: roundCoordinate(point.x), y: roundCoordinate(point.y) };
  if (out.type === undefined) {
    delete out.type;
  }
  return out;
}

// Rebuild an unpacked contour ({points, isClosed}) from the analysis and the
// final sequence of pieces (merged replacements and untouched originals).
export function rebuildSimplifiedContour(analysis, simplifiedPieces) {
  const { sourcePointMap, isClosed } = analysis;
  const originalPoints = analysis.contour.points;

  const makeOnCurvePoint = (key, incomingPiece, outgoingPiece) => {
    let point;
    if (typeof key === "number") {
      const original = originalPoints[key];
      point = { x: roundCoordinate(original.x), y: roundCoordinate(original.y) };
      if (original.smooth === true) {
        // Keep smooth only when the new joint is still tangent-continuous.
        // Rounding a handle to whole units turns it by up to atan(0.7 / its
        // length), so a short or fractional handle written back can bend a
        // smooth joint by more than the tangent limit without anything having
        // changed. That much bend is the grid's, and does not cost the flag.
        const gridBend = (tangent) =>
          (Math.atan(0.7 / Math.max(vectorLength(tangent), 0.7)) * 180) / Math.PI;
        const stillSmooth =
          incomingPiece &&
          outgoingPiece &&
          angleBetweenDegrees(
            pieceEndTangent(incomingPiece),
            pieceStartTangent(outgoingPiece)
          ) <=
            Math.max(
              DEFAULT_MAX_TANGENT_ANGLE,
              gridBend(pieceEndTangent(incomingPiece)) +
                gridBend(pieceStartTangent(outgoingPiece))
            );
        if (stillSmooth) {
          point.smooth = true;
        }
      }
      if (hasNonEmptyAttrs(original)) {
        point.attrs = original.attrs;
      }
    } else {
      // Inserted extrema point: fresh point, smooth by construction (the
      // split preserves the tangent on both sides).
      const inserted = sourcePointMap.get(key).point;
      point = {
        x: roundCoordinate(inserted.x),
        y: roundCoordinate(inserted.y),
        smooth: true,
      };
    }
    return point;
  };

  const points = [];
  const numPieces = simplifiedPieces.length;
  for (const [i, piece] of simplifiedPieces.entries()) {
    const prevPiece = simplifiedPieces[(i - 1 + numPieces) % numPieces];
    const nextPiece = simplifiedPieces[(i + 1) % numPieces];
    if (i === 0) {
      points.push(makeOnCurvePoint(piece.startKey, isClosed ? prevPiece : null, piece));
    }
    // Interior off-curve points.
    for (const handle of piece.points.slice(1, -1)) {
      const out = {
        x: roundCoordinate(handle.x),
        y: roundCoordinate(handle.y),
      };
      // Fitted candidate handles carry no `type`; take it from the piece.
      const type = handle.type ?? (piece.kind === "cubic" ? "cubic" : undefined);
      if (type) {
        out.type = type;
      }
      points.push(out);
    }
    // End on-curve point, except for the closing piece of a closed contour
    // (its end point is the contour's first point).
    const isClosingPiece = isClosed && i === numPieces - 1;
    if (!isClosingPiece) {
      points.push(makeOnCurvePoint(piece.endKey, piece, nextPiece));
    }
  }

  return { points, isClosed };
}

// Simplify one unpacked contour. Returns a new {points, isClosed} contour,
// or null when nothing can be merged.
export function simplifyContour(contour, options = {}) {
  const analysis = classifySimplifyContour(contour, options);
  analysis.contour = contour;
  const runs = buildSimplifyRuns(analysis);

  const runByFirstPiece = new Map();
  for (const run of runs) {
    runByFirstPiece.set(run.pieces[0], run);
  }

  const finalPieces = [];
  for (let i = 0; i < analysis.pieces.length; i++) {
    const piece = analysis.pieces[i];
    const run = runByFirstPiece.get(piece);
    if (run) {
      const simplifiedRun = simplifyRun(run, options);
      finalPieces.push(...simplifiedRun);
      i += run.pieces.length - 1;
    } else {
      finalPieces.push(piece);
    }
  }

  const rebuilt = insertExtremaPoints(
    removeStraightLinePoints(
      [rebuildSimplifiedContour(analysis, finalPieces)],
      options
    ),
    options
  )[0];
  // Inserting the extrema points is itself a result worth writing, even when
  // no run merges. Conversely a merge that the extrema pass splits straight
  // back apart is no result at all, so the outcome is judged by comparing the
  // finished contour with the original, not by whether a merge happened.
  return sameContour(rebuilt, contour) ? null : rebuilt;
}

// Decide the merge boundaries for one run: a covering list of [start, end)
// spans (relative piece indices). Spans longer than one piece are accepted
// merges; single-piece spans are copies. Greedy, longest-first.
// Fit one span of a run, remembering the answer. Deciding a merge and then
// applying it asks for the same fit twice, and every master asks again, so
// the fit is kept on the run it belongs to.
function fitSpan(run, start, end) {
  const cache = (run.fits ??= new Map());
  const key = `${start}:${end}`;
  if (!cache.has(key)) {
    const candidatePieces = run.pieces.slice(start, end);
    // Measured against the exact curves the pieces stand for, not against
    // their whole-unit fits.
    const targets = candidatePieces.map((piece) =>
      piece.sourcePoints ? { ...piece, points: piece.sourcePoints } : piece
    );
    const first = targets[0].points;
    const last = targets.at(-1).points;
    // The merge is written between the run's own written end points.
    const p0 = candidatePieces[0].points[0];
    const p3 = candidatePieces.at(-1).points[3];
    const fitted = fitCubicToSpan(
      targets,
      { x: first[1].x - first[0].x, y: first[1].y - first[0].y },
      { x: last[3].x - last[2].x, y: last[3].y - last[2].y }
    );
    const startDir = startDirection(first);
    const endDir = endDirection(last);
    cache.set(key, {
      pieces: candidatePieces,
      targets,
      candidate: fitted && [p0, roundPoint(fitted[1]), roundPoint(fitted[2]), p3],
      // The closest fit is often lopsided and breaks the curve at an end.
      // When it does, the closest fit that does not is the merge, if anything
      // is; built only when it is asked for.
      keeping: () =>
        startDir &&
        endDir &&
        (targets.length < 2 || spanTurnDegrees(targets) <= MAX_SPAN_TURN_DEGREES)
          ? gridFit(targets, p0, startDir, p3, endDir)
          : null,
    });
  }
  return cache.get(key);
}

// The cubic a span of a run merges into, or null when nothing fits it. The
// closest fit first; failing that the closest one that keeps the curvature. Either has to fit
// the original, not only lie near it.
function acceptedMerge(run, start, end, tolerance, maxTangentAngle) {
  const span = fitSpan(run, start, end);
  const accepts = (candidate) =>
    candidate &&
    fitsOriginal(candidate, span.targets, tolerance) &&
    tangentAngleDegrees(candidate, span.targets) <= maxTangentAngle;
  if (accepts(span.candidate)) {
    return span.candidate;
  }
  if (span.keepingCandidate === undefined) {
    span.keepingCandidate = span.keeping();
  }
  return accepts(span.keepingCandidate) ? span.keepingCandidate : null;
}

export function planRunMerges(run, options = {}) {
  const pieces = run.pieces;
  const tolerance = options.tolerance ?? 0.5;
  const maxTangentAngle = options.maxTangentAngle ?? DEFAULT_MAX_TANGENT_ANGLE;
  const spans = [];
  let start = 0;
  while (start < pieces.length) {
    let acceptedEnd = start + 1;
    for (let end = pieces.length; end > start + 1; end--) {
      if (acceptedMerge(run, start, end, tolerance, maxTangentAngle)) {
        acceptedEnd = end;
        break;
      }
    }
    spans.push([start, acceptedEnd]);
    start = acceptedEnd;
  }
  return spans;
}

// Apply a merge plan to a run, fitting each accepted span to this contour's
// own geometry.
export function applyRunPlan(run, spans, options = {}) {
  const pieces = run.pieces;
  const result = [];
  for (const [start, end] of spans) {
    if (end - start === 1) {
      result.push(pieces[start]);
      continue;
    }
    const candidatePieces = run.pieces.slice(start, end);
    const candidate = acceptedMerge(
      run,
      start,
      end,
      options.tolerance ?? 0.5,
      options.maxTangentAngle ?? DEFAULT_MAX_TANGENT_ANGLE
    );
    if (!candidate) {
      result.push(...candidatePieces);
      continue;
    }
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
  }
  return result;
}

// Simplify the same contour across several masters. `contours` is an array
// of unpacked contours ({points, isClosed}), one per compatible master.
// A run is merged only when every master accepts the same merge boundaries;
// otherwise that run is left unchanged in every master. Returns an array of
// new contours (same order), or null when the masters are structurally
// incompatible or nothing can be merged.
export function simplifyContourCompatible(contours, options = {}) {
  if (!contours.length) {
    return null;
  }
  const analyze = (insertExtrema) =>
    contours.map((contour) => {
      const analysis = classifySimplifyContour(contour, { ...options, insertExtrema });
      analysis.contour = contour;
      return analysis;
    });
  const structurallyEqual = (analyses) =>
    analyses.every(
      (analysis) =>
        analysis.pieces.length === analyses[0].pieces.length &&
        analysis.pieces.every((piece, i) => piece.kind === analyses[0].pieces[i].kind)
    );

  // Masters can have extrema in different places, which would give them
  // different point counts. Rather than refuse the whole contour, fall back
  // to leaving the extrema alone and merging only.
  let analyses = analyze(options.insertExtrema ?? true);
  if (!structurallyEqual(analyses)) {
    analyses = analyze(false);
    if (!structurallyEqual(analyses)) {
      return null;
    }
  }

  const runsPerMaster = analyses.map(buildSimplifyRuns);
  const referenceRuns = runsPerMaster[0];
  const runSpanKey = (run) =>
    `${run.pieces[0].sourceSegmentIndex}:${run.pieces.length}`;
  for (const runs of runsPerMaster.slice(1)) {
    if (
      runs.length !== referenceRuns.length ||
      runs.some((run, i) => runSpanKey(run) !== runSpanKey(referenceRuns[i]))
    ) {
      return null;
    }
  }

  // Shared merge plans: a run is simplified only when every master plans the
  // identical boundaries.
  const sharedPlans = referenceRuns.map((referenceRun, runIndex) => {
    const plans = runsPerMaster.map((runs) => planRunMerges(runs[runIndex], options));
    const referencePlan = plans[0];
    const allAgree = plans.every(
      (plan) =>
        plan.length === referencePlan.length &&
        plan.every(
          ([s, e], i) => s === referencePlan[i][0] && e === referencePlan[i][1]
        )
    );
    if (allAgree) {
      return referencePlan;
    }
    // Disagreement: leave the run unchanged in every master.
    return referenceRun.pieces.map((_, i) => [i, i + 1]);
  });

  const results = analyses.map((analysis, masterIndex) => {
    const runs = runsPerMaster[masterIndex];
    const runByFirstPiece = new Map();
    for (const [runIndex, run] of runs.entries()) {
      runByFirstPiece.set(run.pieces[0], { run, runIndex });
    }
    const finalPieces = [];
    for (let i = 0; i < analysis.pieces.length; i++) {
      const piece = analysis.pieces[i];
      const entry = runByFirstPiece.get(piece);
      if (entry) {
        const simplifiedRun = applyRunPlan(
          entry.run,
          sharedPlans[entry.runIndex],
          options
        );
        finalPieces.push(...simplifiedRun);
        i += entry.run.pieces.length - 1;
      } else {
        finalPieces.push(piece);
      }
    }
    return rebuildSimplifiedContour(analysis, finalPieces);
  });

  const finalResults = insertExtremaPoints(
    removeStraightLinePoints(results, options),
    options
  );
  const changed = finalResults.some((result, i) => !sameContour(result, contours[i]));
  return changed ? finalResults : null;
}
