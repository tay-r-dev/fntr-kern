import { solveHandleLengths } from "./fit-cubic.js";
import { calculateTunniPoint } from "./tunni-calculations.js";

// Floor on the offset speed factor lambda, as a fraction of the un-offset handle
// length. A handle far past the cusp keeps this fraction rather than collapsing.
const CUSP_FLOOR = 0.02;

// Blend window for every smooth min/max here, so each bound is EXACTLY inert
// outside its window. Do not substitute a sqrt-based soft floor: that form is
// never exactly inert, shifts lambda by c^2/lambda, and the shift scales with
// handle length - 0.022 units on a 55-unit handle at c = 0.02.
const CUSP_FLOOR_WINDOW = 0.1;

const EPSILON = 1e-9;
const SMOOTH_MIN_WINDOW = 0.15;
const MAX_HANDLE_TO_CHORD_RATIO = 2;
const MIN_HANDLE_LENGTH = 1;
const MIN_HANDLE_WINDOW = 0.5;
const CORRECTION_SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];

export const tensionBoundStats = { evaluated: 0, active: 0 };
export function resetTensionBoundStats() {
  tensionBoundStats.evaluated = tensionBoundStats.active = 0;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Polynomial smooth minimum: exactly min(a, b) when they differ by more than
// `window`, blending quadratically inside it. C1 at the join.
function smoothMin(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.min(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.min(a, b) - h * h * window * 0.25;
}

// Mirror of smoothMin: exactly max(a, b) outside the window.
function smoothMax(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.max(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.max(a, b) + h * h * window * 0.25;
}

function tangentIntersectionDistances(q0, u0, q3, u1) {
  const point = calculateTunniPoint([
    q0,
    { x: q0.x + u0.x, y: q0.y + u0.y },
    { x: q3.x + u1.x, y: q3.y + u1.y },
    q3,
  ]);
  if (!point) return { startLimit: Infinity, endLimit: Infinity };
  const startLimit = (point.x - q0.x) * u0.x + (point.y - q0.y) * u0.y;
  const endLimit = (point.x - q3.x) * u1.x + (point.y - q3.y) * u1.y;
  return {
    startLimit: startLimit > EPSILON ? startLimit : Infinity,
    endLimit: endLimit > EPSILON ? endLimit : Infinity,
  };
}

function boundLength(length, limit, chord) {
  tensionBoundStats.evaluated += 1;
  let bounded = length;
  if (Number.isFinite(limit)) {
    const next = smoothMin(bounded, limit, SMOOTH_MIN_WINDOW * limit);
    if (next < bounded - EPSILON) tensionBoundStats.active += 1;
    bounded = next;
  }
  const chordCap = Math.max(chord * MAX_HANDLE_TO_CHORD_RATIO, EPSILON);
  return smoothMax(
    smoothMin(bounded, chordCap, SMOOTH_MIN_WINDOW * chordCap),
    MIN_HANDLE_LENGTH,
    MIN_HANDLE_WINDOW
  );
}

function offsetPointAt(p0, p1, p2, p3, d0, d3, t) {
  const mt = 1 - t;
  const base = {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
  const deriv = {
    x:
      3 * mt * mt * (p1.x - p0.x) +
      6 * mt * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * mt * mt * (p1.y - p0.y) +
      6 * mt * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
  const speed = Math.hypot(deriv.x, deriv.y);
  if (speed < EPSILON) return base;
  const distance = d0 + (d3 - d0) * t;
  return {
    x: base.x + (deriv.y * distance) / speed,
    y: base.y - (deriv.x * distance) / speed,
  };
}

function endDerivatives(p0, p1, p2, p3, atEnd) {
  if (atEnd) {
    return {
      d1: { x: 3 * (p3.x - p2.x), y: 3 * (p3.y - p2.y) },
      d2: { x: 6 * (p3.x - 2 * p2.x + p1.x), y: 6 * (p3.y - 2 * p2.y + p1.y) },
    };
  }
  return {
    d1: { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) },
    d2: { x: 6 * (p2.x - 2 * p1.x + p0.x), y: 6 * (p2.y - 2 * p1.y + p0.y) },
  };
}

export function endpointCurvature(p0, p1, p2, p3, atEnd) {
  const { d1, d2 } = endDerivatives(p0, p1, p2, p3, atEnd);
  const speed = Math.hypot(d1.x, d1.y);
  return speed < EPSILON ? 0 : cross(d1, d2) / speed ** 3;
}

export function offsetCubicSide({ p0, p1, p2, p3, d0, d3, q0, q3, u0, u1 }) {
  const startHandle = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const endHandle = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const startLambda = smoothMax(
    1 + d0 * endpointCurvature(p0, p1, p2, p3, false),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );
  const endLambda = smoothMax(
    1 + d3 * endpointCurvature(p0, p1, p2, p3, true),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );
  const analyticStart = startHandle * startLambda;
  const analyticEnd = endHandle * endLambda;
  const samples = CORRECTION_SAMPLE_TS.map((t) =>
    offsetPointAt(p0, p1, p2, p3, d0, d3, t)
  );
  const { alphaL, alphaR } = solveHandleLengths(
    [q0, ...samples, q3],
    [0, ...CORRECTION_SAMPLE_TS, 1],
    u0,
    u1
  );
  const correctedStart = Math.min(
    Math.max(alphaL, analyticStart * 0.25),
    analyticStart * 4
  );
  const correctedEnd = Math.min(Math.max(alphaR, analyticEnd * 0.25), analyticEnd * 4);
  const chord = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const { startLimit, endLimit } = tangentIntersectionDistances(q0, u0, q3, u1);
  return {
    startLength: boundLength(correctedStart, startLimit, chord),
    endLength: boundLength(correctedEnd, endLimit, chord),
  };
}
