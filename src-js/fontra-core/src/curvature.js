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
 * Map absolute curvature -> color using per-segment min/max normalization.
 * NEW SIGNATURE:
 *   curvatureToColor(curvatureAbs, minAbs, maxAbs, colorStops)
 *
 * - curvatureAbs: non-negative absolute curvature value
 * - minAbs, maxAbs: per-segment min/max absolute curvature (the visualization must pass these)
 * - colorStops: array of hex strings
 */
export function curvatureToColor(
  curvatureAbs,
  minAbs,
  maxAbs,
  colorStops = ["#8b939c", "#f29400", "#e3004f"]
) {
  // safe defaults
  if (!Array.isArray(colorStops) || colorStops.length === 0) {
    return "rgba(0,0,0,1)";
  }

  // degenerate: all identical -> return middle or last stop
  if (maxAbs <= minAbs) {
    const mid = Math.floor((colorStops.length - 1) / 2);
    return interpolateColor(colorStops[mid], colorStops[mid], 0);
  }

  // normalize to [0,1]
  let t = (curvatureAbs - minAbs) / (maxAbs - minAbs);
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
  const sharpness = Math.max(0.1, params.sharpness ?? 1);
  const illustrationPosition = params.illustrationPosition ?? "outsideOfCurve";
  const useGlobalNormalization = params.useGlobalNormalization ?? false;
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

  let globalMinAbs = Infinity;
  let globalMaxAbs = -Infinity;
  if (useGlobalNormalization) {
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
      for (const sample of samples) {
        const absK = Math.abs(sample.curvature);
        globalMinAbs = Math.min(globalMinAbs, absK);
        globalMaxAbs = Math.max(globalMaxAbs, absK);
      }
    });
    if (globalMinAbs === Infinity) {
      globalMinAbs = 0;
      globalMaxAbs = 1;
    }
  }

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

    const absVals = samples.map((s) => Math.abs(s.curvature));
    const minAbsSegment = Math.min(...absVals);
    const maxAbsSegment = Math.max(...absVals);
    const segmentPeakAbsCurvature = maxAbsSegment > 1e-12 ? maxAbsSegment : 1;
    const minAbs = useGlobalNormalization ? globalMinAbs : minAbsSegment;
    const maxAbs = useGlobalNormalization ? globalMaxAbs : maxAbsSegment;

    const onCurve = [];
    const offCurve = [];
    for (let s = 0; s < samples.length; s++) {
      const t = samples[s].t;
      const { r, r1 } =
        kind === "cubic"
          ? solveCubicBezier(...pts, t)
          : solveQuadraticBezier(...pts, t);
      const [x, y] = r;
      onCurve.push({ x, y, k: samples[s].curvature });

      let nx = illustrationPosition === "outsideOfCurve" ? -r1[1] : r1[1];
      let ny = illustrationPosition === "outsideOfCurve" ? r1[0] : -r1[0];
      const mag = Math.hypot(nx, ny) || 1;
      nx /= mag;
      ny /= mag;

      const rawNormalizedHeight =
        Math.abs(samples[s].curvature) / segmentPeakAbsCurvature;
      const normalizedHeight = Math.pow(
        Math.max(0, Math.min(1, rawNormalizedHeight)),
        sharpness
      );
      const h = -normalizedHeight * peakHeightGlyphUnits;
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
        color: curvatureToColor(Math.abs(a.k), minAbs, maxAbs, colorStops),
      });
    }
  });

  return quads;
}

function forEachCurveSegment(path, cb) {
  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const contour = path.getContour(contourIndex);
    const startPoint = path.getAbsolutePointIndex(contourIndex, 0);
    const numPoints = contour.pointTypes.length;

    for (let i = 0; i < numPoints; i++) {
      const pointIndex = startPoint + i;
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
      if (isCubic) {
        const p1 = path.getPoint(pointIndex);
        const p2 = path.getPoint(next1);
        const p3 = path.getPoint(next2);
        const p4 = path.getPoint(next3);
        cb("cubic", [
          [p1.x, p1.y],
          [p2.x, p2.y],
          [p3.x, p3.y],
          [p4.x, p4.y],
        ]);
      } else if (isQuadratic) {
        const p1 = path.getPoint(pointIndex);
        const p2 = path.getPoint(next1);
        const p3 = path.getPoint(next2);
        cb("quadratic", [
          [p1.x, p1.y],
          [p2.x, p2.y],
          [p3.x, p3.y],
        ]);
      }
    }
  }
}
