import * as vector from "./vector.js";

// Signed endpoint curvature, in traversal order. Comparing magnitudes would
// accept a convex-to-concave jump as a match.
export function bulbEndCurvature(points, end = false) {
  const [p, h, far] = end ? [...points].reverse() : points;
  const u = vector.subVectors(h, p);
  const v = vector.subVectors(far, h);
  const speed = Math.hypot(u.x, u.y);
  return speed > 1e-12 ? ((end ? -1 : 1) * (2 / 3) * cross(u, v)) / speed ** 3 : 0;
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
