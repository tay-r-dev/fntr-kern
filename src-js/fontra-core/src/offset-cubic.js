const CUSP_FLOOR = 0.02;
const EPSILON = 1e-9;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function softPositive(value, softness) {
  return 0.5 * (value + Math.sqrt(value * value + 4 * softness * softness));
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
  const startLambda = softPositive(
    1 + d0 * endpointCurvature(p0, p1, p2, p3, false),
    CUSP_FLOOR
  );
  const endLambda = softPositive(
    1 + d3 * endpointCurvature(p0, p1, p2, p3, true),
    CUSP_FLOOR
  );
  return {
    startLength: startHandle * startLambda,
    endLength: endHandle * endLambda,
  };
}
