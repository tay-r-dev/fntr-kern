// Floor on the offset speed factor lambda, as a fraction of the un-offset handle
// length. A handle far past the cusp keeps this fraction rather than collapsing.
const CUSP_FLOOR = 0.02;

// Blend window for every smooth min/max here, so each bound is EXACTLY inert
// outside its window. Do not substitute a sqrt-based soft floor: that form is
// never exactly inert, shifts lambda by c^2/lambda, and the shift scales with
// handle length - 0.022 units on a 55-unit handle at c = 0.02.
const CUSP_FLOOR_WINDOW = 0.1;

const EPSILON = 1e-9;

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
  return {
    startLength: startHandle * startLambda,
    endLength: endHandle * endLambda,
  };
}
