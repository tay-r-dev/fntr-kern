// src-js/fontra-core/src/curvature.js
// --- Adapted from Speed Punk's Python logic to JavaScript ---
//
// Full helper set (position/derivatives, curvature sampling) with
// corrected curvatureToColor that supports per-segment normalization.
//
// Exports:
//  solveCubicBezier, solveQuadraticBezier,
//  solveCubicBezierCurvature, solveQuadraticBezierCurvature,
//  calculateCurvatureForSegment, calculateCurvatureForQuadraticSegment,
//  curvatureToColor

import { VarPackedPath } from "./var-path.js";

// --- cubic solver
export function solveCubicBezier(p1, p2, p3, p4, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  // Position r(t)
  const r_x =
    p1[0] * mt2 * mt + 3 * p2[0] * mt2 * t + 3 * p3[0] * mt * t2 + p4[0] * t2 * t;
  const r_y =
    p1[1] * mt2 * mt + 3 * p2[1] * mt2 * t + 3 * p3[1] * mt * t2 + p4[1] * t2 * t;

  // First derivative r'(t) * 3
  const r1_x =
    (p2[0] - p1[0]) * mt2 + 2 * (p3[0] - p2[0]) * mt * t + (p4[0] - p3[0]) * t2;
  const r1_y =
    (p2[1] - p1[1]) * mt2 + 2 * (p3[1] - p2[1]) * mt * t + (p4[1] - p3[1]) * t2;
  const r1 = [r1_x * 3, r1_y * 3];

  // Second derivative r''(t) * 6
  const r2_x = (p3[0] - 2 * p2[0] + p1[0]) * mt + (p4[0] - 2 * p3[0] + p2[0]) * t;
  const r2_y = (p3[1] - 2 * p2[1] + p1[1]) * mt + (p4[1] - 2 * p3[1] + p2[1]) * t;
  const r2 = [r2_x * 6, r2_y * 6];

  return { r: [r_x, r_y], r1: r1, r2: r2 };
}

// --- quadratic solver
export function solveQuadraticBezier(p1, p2, p3, t) {
  const mt = 1 - t;

  const r_x = p1[0] * mt * mt + 2 * p2[0] * mt * t + p3[0] * t * t;
  const r_y = p1[1] * mt * mt + 2 * p2[1] * mt * t + p3[1] * t * t;

  // first derivative *2 then scaled *2 (matching prior code)
  const r1_x = 2 * (p2[0] - p1[0]) * mt + 2 * (p3[0] - p2[0]) * t;
  const r1_y = 2 * (p2[1] - p1[1]) * mt + 2 * (p3[1] - p2[1]) * t;
  const r1 = [r1_x * 2, r1_y * 2];

  // second derivative constant *2 then scaled *2
  const r2_x = 2 * (p1[0] - 2 * p2[0] + p3[0]);
  const r2_y = 2 * (p1[1] - 2 * p2[1] + p3[1]);
  const r2 = [r2_x * 2, r2_y * 2];

  return { r: [r_x, r_y], r1: r1, r2: r2 };
}

// --- curvature calculation (signed or unsigned depending on needs)
// the existing code used absolute values in many places; keep returning ABS (old behavior),
// but callers may use Math.sign(...) if they want signed height.
export function solveCubicBezierCurvature(r1, r2) {
  const dx = r1[0],
    dy = r1[1];
  const d2x = r2[0],
    d2y = r2[1];
  const cross = dx * d2y - dy * d2x;
  const mag_r1_sq = dx * dx + dy * dy;
  if (mag_r1_sq === 0) {
    return 0;
  }
  const mag_r1 = Math.sqrt(mag_r1_sq);
  // curvature = |r' x r''| / |r'|^3
  return Math.abs(cross) / (mag_r1 * mag_r1 * mag_r1);
}

export function solveQuadraticBezierCurvature(r1, r2) {
  const dx = r1[0],
    dy = r1[1];
  const d2x = r2[0],
    d2y = r2[1];
  const cross = dx * d2y - dy * d2x;
  const mag_r1_sq = dx * dx + dy * dy;
  if (mag_r1_sq === 0) {
    return 0;
  }
  const mag_r1 = Math.sqrt(mag_r1_sq);
  return Math.abs(cross) / (mag_r1 * mag_r1 * mag_r1);
}

/**
 * Sample cubic segment; returns samples array:
 * [{ t, curvature, r?: [x,y], r1?: [dx,dy] }, ...]
 * (Note: the visualization code uses solveCubicBezier separately to get r/r1)
 */
export function calculateCurvatureForSegment(p1, p2, p3, p4, steps = 20) {
  const curvs = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { r1, r2 } = solveCubicBezier(p1, p2, p3, p4, t);
    const k = solveCubicBezierCurvature(r1, r2);
    curvs.push({ t, curvature: k });
  }
  return curvs;
}

/**
 * Sample quadratic segment; same shape as cubic.
 */
export function calculateCurvatureForQuadraticSegment(p1, p2, p3, steps = 20) {
  const curvs = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { r1, r2 } = solveQuadraticBezier(p1, p2, p3, t);
    const k = solveQuadraticBezierCurvature(r1, r2);
    curvs.push({ t, curvature: k });
  }
  return curvs;
}

/* ---------- color helpers ---------- */

// convert "#rrggbb" to [r,g,b]
function _hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function interpolateColor(color1, color2, t) {
  const a = _hexToRgb(color1);
  const b = _hexToRgb(color2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r}, ${g}, ${bl}, 1)`;
}

/**
 * Map absolute curvature -> colour, against a ramp between two named radii.
 *
 * `flatRadius` takes the first stop and `tightRadius` the last, and the ramp
 * runs geometrically between them, so equal ratios of radius are equal steps of
 * colour and the middle stop of a three-stop ramp lands on their geometric
 * mean. Past either end the colour pins.
 *
 * **The two radii are the whole of the design.** An absolute colour has to be
 * told which range to spend its stops on, and letters occupy a narrow one — the
 * two glyphs this was calibrated against sit between radius 170 and 370, about
 * 2.2 to 1. A ramp wider than that puts the whole drawing in the middle stop's
 * colour and makes the last stop unreachable. Deriving the ramp from the height
 * anchor instead is what produced exactly that, because the span of the ramp and
 * the anchor of the fringe length are unrelated quantities.
 *
 * Nothing here is read off the drawing. One curvature is one colour in every
 * glyph of the font, and no edit changes the colour of anything it did not move.
 */
export function curvatureToColor(
  curvatureAbs,
  flatRadius,
  tightRadius,
  colorStops = ["#8b939c", "#f29400", "#e3004f"]
) {
  if (!Array.isArray(colorStops) || colorStops.length === 0) {
    return "rgba(0,0,0,1)";
  }
  if (colorStops.length === 1) {
    return interpolateColor(colorStops[0], colorStops[0], 0);
  }

  const flat = Math.max(1e-6, flatRadius);
  const tight = Math.max(1e-6, tightRadius);
  // A straight line has no curvature and no radius, so it lands on the flat end.
  const radius = curvatureAbs > 0 ? 1 / curvatureAbs : Infinity;

  let t = 0;
  if (flat > tight) {
    t = Number.isFinite(radius) ? Math.log(flat / radius) / Math.log(flat / tight) : 0;
  } else {
    // A ramp with no width: everything at or past it takes the last stop.
    t = radius <= flat ? 1 : 0;
  }
  t = Math.max(0, Math.min(1, t));

  const segments = colorStops.length - 1;
  const segIndex = Math.min(Math.floor(t * segments), segments - 1);
  const localT = t * segments - segIndex;
  return interpolateColor(colorStops[segIndex], colorStops[segIndex + 1], localT);
}

// --- SpeedPunk sampling helpers (moved out of visualization-layer-definitions.js) ---

export function calculateSegmentBudget(
  numCurves,
  zoomFactor,
  baseSegments = 400,
  minSegmentsPerCurve = 5
) {
  const zoomAdjustedBudget = Math.ceil(baseSegments * Math.sqrt(zoomFactor));

  const stepsPerSegment = Math.max(
    Math.floor(zoomAdjustedBudget / Math.max(numCurves, 1)),
    minSegmentsPerCurve
  );

  return stepsPerSegment;
}

export function estimateCurveLength(p1, p2, p3, p4 = null) {
  if (p4) {
    return (
      Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
      Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) +
      Math.hypot(p4[0] - p3[0], p4[1] - p3[1])
    );
  } else {
    return (
      Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
      Math.hypot(p3[0] - p2[0], p3[1] - p2[1])
    );
  }
}

export function adjustStepsForCurve(
  baseSteps,
  curveLength,
  averageLength,
  maxAdjustment = 2.0
) {
  if (averageLength === 0) return baseSteps;

  const ratio = curveLength / averageLength;
  const adjustment = Math.min(Math.max(ratio, 1.0 / maxAdjustment), maxAdjustment);

  return Math.max(Math.floor(baseSteps * adjustment), 3);
}

export function countCurveSegments(path) {
  let count = 0;

  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const contour = path.getContour(contourIndex);
    const startPoint = path.getAbsolutePointIndex(contourIndex, 0);
    const numPoints = contour.pointTypes.length;

    for (let i = 0; i < numPoints; i++) {
      const pointIndex = startPoint + i;
      const pointType = path.pointTypes[pointIndex];

      if ((pointType & VarPackedPath.POINT_TYPE_MASK) !== VarPackedPath.ON_CURVE) {
        continue;
      }

      const next1 = path.getAbsolutePointIndex(contourIndex, (i + 1) % numPoints);
      const next2 = path.getAbsolutePointIndex(contourIndex, (i + 2) % numPoints);
      const next3 = path.getAbsolutePointIndex(contourIndex, (i + 3) % numPoints);

      const t1 = path.pointTypes[next1];
      const t2 = path.pointTypes[next2];
      const t3 = path.pointTypes[next3];

      const isCubic =
        (t1 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_CUBIC &&
        (t2 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_CUBIC &&
        (t3 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE;

      const isQuadratic =
        (t1 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_QUAD &&
        (t2 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE;

      if (isCubic || isQuadratic) {
        count++;
      }
    }
  }

  return count;
}

// --- SpeedPunk geometry: pure quad/color generation (consumed by the viz layer) ---

function _isOnCurve(t) {
  return (t & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE;
}

function _segmentKind(t1, t2, t3) {
  const isCubic =
    (t1 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_CUBIC &&
    (t2 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_CUBIC &&
    (t3 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE;
  const isQuadratic =
    (t1 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.OFF_CURVE_QUAD &&
    (t2 & VarPackedPath.POINT_TYPE_MASK) === VarPackedPath.ON_CURVE;
  return { isCubic, isQuadratic };
}

export function computeSpeedPunkSamples(path, params = {}) {
  const peakHeightGlyphUnits = params.peakHeightGlyphUnits ?? 24;
  // The anchor the height scale is stated in: a curve of this radius draws a
  // fringe of exactly the peak height.
  const referenceRadius = Math.max(1e-6, params.referenceRadiusGlyphUnits ?? 200);
  // The colour ramp's own two ends, independent of the height anchor above.
  const colorFlatRadius = Math.max(1e-6, params.colorFlatRadiusGlyphUnits ?? 400);
  const colorTightRadius = Math.max(1e-6, params.colorTightRadiusGlyphUnits ?? 180);
  const sharpness = Math.max(0.1, params.sharpness ?? 1);
  const illustrationPosition = params.illustrationPosition ?? "outsideOfCurve";
  const colorStops = params.colorStops ?? ["#8b939c", "#f29400", "#e3004f"];
  const baseSegmentBudget = params.baseSegmentBudget ?? 400;
  const minSegmentsPerCurve = params.minSegmentsPerCurve ?? 5;
  const zoomFactor = params.zoomFactor ?? 1;
  const adaptToCurveLength = params.adaptStepsToCurveLength ?? false;

  if (!path || !path.numContours) {
    return [];
  }

  const totalCurveCount = countCurveSegments(path);
  if (totalCurveCount === 0) {
    return [];
  }

  const stepsPerSegment = calculateSegmentBudget(
    totalCurveCount,
    zoomFactor,
    baseSegmentBudget,
    minSegmentsPerCurve
  );

  let averageCurveLength = 0;
  if (adaptToCurveLength) {
    let totalLength = 0;
    let curveCount = 0;
    forEachCurveSegment(path, (kind, pts) => {
      totalLength += estimateCurveLength(...pts);
      curveCount++;
    });
    averageCurveLength = curveCount > 0 ? totalLength / curveCount : 0;
  }

  // Both scales are absolute, so a segment is drawn from its own geometry and
  // the reference radius alone. Nothing here reads another segment.
  const quads = [];
  forEachCurveSegment(path, (kind, pts) => {
    const steps = adaptToCurveLength
      ? adjustStepsForCurve(
          stepsPerSegment,
          estimateCurveLength(...pts),
          averageCurveLength
        )
      : stepsPerSegment;
    const samples =
      kind === "cubic"
        ? calculateCurvatureForSegment(...pts, steps)
        : calculateCurvatureForQuadraticSegment(...pts, steps);

    const onCurve = [];
    const offCurve = [];
    for (let s = 0; s < samples.length; s++) {
      const absK = Math.abs(samples[s].curvature);
      const t = samples[s].t;
      const { r, r1 } =
        kind === "cubic"
          ? solveCubicBezier(...pts, t)
          : solveQuadraticBezier(...pts, t);
      const [x, y] = r;
      onCurve.push({ x, y, k: absK });

      let nx = illustrationPosition === "outsideOfCurve" ? -r1[1] : r1[1];
      let ny = illustrationPosition === "outsideOfCurve" ? r1[0] : -r1[0];
      const mag = Math.hypot(nx, ny) || 1;
      nx /= mag;
      ny /= mag;

      // The fringe is the peak height where the radius is the reference radius,
      // and proportional to curvature from there. No ceiling and no floor.
      // Sharpness is an exponent about that anchor, which the anchor survives.
      const heightRatio = Math.pow(absK * referenceRadius, sharpness);
      const h = -heightRatio * peakHeightGlyphUnits;
      offCurve.push({ x: x + nx * h, y: y + ny * h });
    }

    for (let s = 0; s < onCurve.length - 1; s++) {
      const a = onCurve[s];
      const b = onCurve[s + 1];
      quads.push({
        points: [
          [a.x, a.y],
          [b.x, b.y],
          [offCurve[s + 1].x, offCurve[s + 1].y],
          [offCurve[s].x, offCurve[s].y],
        ],
        color: curvatureToColor(a.k, colorFlatRadius, colorTightRadius, colorStops),
      });
    }
  });

  return quads;
}

// The one segment walk. Every curve segment, once, in contour order.
//
// It used to group segments into runs of smoothly joined curves, for a comb
// whose two scales were relative and needed a scope. Both scales are absolute
// now, so nothing has a scope and the grouping had no reader left.
function forEachCurveSegment(path, cb) {
  for (let contourIndex = 0; contourIndex < (path?.numContours ?? 0); contourIndex++) {
    const contour = path.getContour(contourIndex);
    const numPoints = contour.pointTypes.length;

    for (let i = 0; i < numPoints; i++) {
      const pointIndex = path.getAbsolutePointIndex(contourIndex, i);
      if (!_isOnCurve(path.pointTypes[pointIndex])) {
        continue;
      }
      const next1 = path.getAbsolutePointIndex(contourIndex, (i + 1) % numPoints);
      const next2 = path.getAbsolutePointIndex(contourIndex, (i + 2) % numPoints);
      const next3 = path.getAbsolutePointIndex(contourIndex, (i + 3) % numPoints);
      const { isCubic, isQuadratic } = _segmentKind(
        path.pointTypes[next1],
        path.pointTypes[next2],
        path.pointTypes[next3]
      );
      if (!isCubic && !isQuadratic) {
        continue;
      }
      const pointIndices = isCubic
        ? [pointIndex, next1, next2, next3]
        : [pointIndex, next1, next2];
      cb(
        isCubic ? "cubic" : "quadratic",
        pointIndices.map((index) => {
          const point = path.getPoint(index);
          return [point.x, point.y];
        })
      );
    }
  }
}
