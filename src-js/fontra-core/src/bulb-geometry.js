import * as vector from "./vector.js";

// The outer rib end IS the ball's outer apex. The forward half has radius R;
// Shape stretches only the rear half. There is no approach or outer-wall cut.
export function makeBulbBall({ outer, inner, outerDirection, radius, shape }) {
  const ex = vector.normalizeVector(outerDirection);
  const ey = vector.normalizeVector(vector.subVectors(inner, outer));
  const center = vector.addVectors(outer, vector.mulVectorScalar(ey, radius));
  const rearRadius = radius * (1 + 1.4 * shape);
  const determinant = ex.x * ey.y - ex.y * ey.x;
  if (Math.abs(determinant) < 1e-10) return null;
  const alongRadius = (u) => (u < -1e-10 ? rearRadius : radius);
  return {
    ex,
    ey,
    center,
    radius,
    rearRadius,
    toDevice(u, v, along = alongRadius(u)) {
      return {
        x: center.x + ex.x * along * u + ey.x * radius * v,
        y: center.y + ex.y * along * u + ey.y * radius * v,
      };
    },
    at(theta) {
      return this.toDevice(Math.cos(theta), Math.sin(theta));
    },
    tangentAt(theta) {
      const along = alongRadius(Math.cos(theta));
      return vector.normalizeVector({
        x: -ex.x * along * Math.sin(theta) + ey.x * radius * Math.cos(theta),
        y: -ex.y * along * Math.sin(theta) + ey.y * radius * Math.cos(theta),
      });
    },
    localOf(point) {
      const d = vector.subVectors(point, center);
      // Invert the frame, including sheared frames at angle-locked ribs.
      const x = (d.x * ey.y - d.y * ey.x) / determinant;
      const y = (ex.x * d.y - ex.y * d.x) / determinant;
      return { u: x / alongRadius(x), v: y / radius };
    },
    thetaOf(point) {
      const { u, v } = this.localOf(point);
      return Math.atan2(v, u);
    },
    contains(point) {
      const { u, v } = this.localOf(point);
      return u * u + v * v < 1;
    },
  };
}

// Always keep the three frame extremes plus the neck attachment. A stop past
// the attachment collapses onto it, preserving point order as controls move.
export function buildBulbArc(ball, thetaEnd) {
  const points = [];
  let a = -Math.PI / 2;
  for (const stop of [0, Math.PI / 2, Math.PI, thetaEnd]) {
    const b = Math.max(a, Math.min(stop, thetaEnd));
    const along = Math.cos((a + b) / 2) < 0 ? ball.rearRadius : ball.radius;
    const k = (4 / 3) * Math.tan((b - a) / 4);
    const u0 = Math.cos(a),
      v0 = Math.sin(a);
    const u1 = Math.cos(b),
      v1 = Math.sin(b);
    points.push(
      { ...ball.toDevice(u0 - k * v0, v0 + k * u0, along), type: "cubic" },
      { ...ball.toDevice(u1 + k * v1, v1 - k * u1, along), type: "cubic" },
      { ...ball.at(b), smooth: true, skipColinear: true }
    );
    a = b;
  }
  return points;
}
