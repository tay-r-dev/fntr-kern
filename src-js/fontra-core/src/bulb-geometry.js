import { Bezier } from "bezier-js";
import { applyHandleScales, solveNearestHandleScales } from "./harmonize-nearest.js";
import { makeSlideCandidate } from "./point-slide.js";
import * as vector from "./vector.js";

// The outer rib end anchors the ball before its emitted entry is V-slid.
// The forward half has radius R; Shape stretches only the rear half.
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

// Glyph-axis extrema of the two half ellipses. The rear half may have a
// different along radius, so each candidate is accepted only on its own half.
export function bulbApexes(ball, from = -Math.PI / 2, to = (3 * Math.PI) / 2) {
  const result = [];
  for (const rear of [false, true]) {
    const along = rear ? ball.rearRadius : ball.radius;
    for (const axis of ["x", "y"]) {
      const base = Math.atan2(ball.ey[axis] * ball.radius, ball.ex[axis] * along);
      for (let theta of [base, base + Math.PI]) {
        while (theta <= from + 1e-9) theta += 2 * Math.PI;
        while (theta > from + 2 * Math.PI) theta -= 2 * Math.PI;
        if (theta >= to - 1e-9 || theta <= from + 1e-9) continue;
        if (Math.cos(theta) < -1e-9 !== rear) continue;
        if (!result.some((p) => Math.abs(p.theta - theta) < 1e-9))
          result.push({ theta, axis });
      }
    }
  }
  return result.sort((a, b) => a.theta - b.theta);
}

// Glyph-axis extrema divide the ball. Its final point belongs to the existing
// neck/incision and may meet the inner wall between extrema. At the transition
// between front/rear halves a single cubic blends their endpoint tangents.
export function buildBulbArc(ball, thetaEnd) {
  const endDirection = ball.tangentAt(thetaEnd);
  const endAxis =
    Math.abs(endDirection.x) < 1e-10
      ? "x"
      : Math.abs(endDirection.y) < 1e-10
        ? "y"
        : undefined;
  const stops = [
    ...bulbApexes(ball, -Math.PI / 2, thetaEnd),
    { theta: thetaEnd, axis: endAxis },
  ];
  const points = [];
  let a = -Math.PI / 2,
    previousAxis;
  const derivative = (theta, middle) => {
    const rear =
      Math.cos(theta) < -1e-10 ||
      (Math.abs(Math.cos(theta)) < 1e-10 && Math.cos(middle) < 0);
    const along = rear ? ball.rearRadius : ball.radius;
    return {
      x:
        -ball.ex.x * along * Math.sin(theta) +
        ball.ey.x * ball.radius * Math.cos(theta),
      y:
        -ball.ex.y * along * Math.sin(theta) +
        ball.ey.y * ball.radius * Math.cos(theta),
    };
  };
  for (const { theta: b, axis } of stops) {
    const start = ball.at(a),
      end = ball.at(b);
    const k = (4 / 3) * Math.tan((b - a) / 4),
      d0 = derivative(a, (a + b) / 2),
      d1 = derivative(b, (a + b) / 2);
    const h0 = { x: start.x + k * d0.x, y: start.y + k * d0.y, type: "cubic" };
    const h1 = { x: end.x - k * d1.x, y: end.y - k * d1.y, type: "cubic" };
    if (previousAxis) h0[previousAxis] = start[previousAxis];
    if (axis) h1[axis] = end[axis];
    points.push(h0, h1, { ...end, smooth: true, skipColinear: true });
    a = b;
    previousAxis = axis;
  }
  return points;
}

// Use the same operation as V-slide. Each candidate starts from the original
// two curves, never from the previous fit. Take the first curvature crossing
// toward the next point; stop short of collapsing that point onto the entry.
export function slideBulbEntry(wall, arc) {
  if (wall.length !== 4 || arc.length < 3) return null;
  const contour = { points: [...wall, ...arc.slice(0, 3)], isClosed: false };
  const sample = (t) => {
    const candidate =
      t === 0
        ? contour
        : makeSlideCandidate(contour, 3, "next", t, { fitIterations: 8 });
    if (!candidate) return null;
    const p = candidate.points;
    const incoming = new Bezier(p.slice(0, 4)).curvature(1).k;
    const outgoing = new Bezier(p.slice(3, 7)).curvature(0).k;
    if (!Number.isFinite(incoming) || !Number.isFinite(outgoing)) return null;
    const residual = Math.abs(incoming) - Math.abs(outgoing);
    const error =
      Math.abs(residual) / Math.max(Math.abs(incoming), Math.abs(outgoing), 1e-12);
    return { points: p, t, residual, error };
  };
  let previous = sample(0),
    best = previous;
  const steps = 20,
    limit = 0.98;
  for (let i = 1; i <= steps; i++) {
    const current = sample((limit * i) / steps);
    if (!current) continue;
    if (!best || current.error < best.error) best = current;
    if (previous && previous.residual * current.residual <= 0) {
      let low = previous,
        high = current;
      for (let j = 0; j < 18; j++) {
        const middle = sample((low.t + high.t) / 2);
        if (!middle) break;
        if (middle.error < best.error) best = middle;
        if (low.residual * middle.residual <= 0) high = middle;
        else low = middle;
      }
      break;
    }
    previous = current;
  }
  if (!best) return null;
  // Search with a cheap fit, then perform the ordinary fully refined V-slide
  // once at the chosen location. Curvature is rechecked on that emitted fit.
  if (best.t > 0) {
    best.points = makeSlideCandidate(contour, 3, "next", best.t).points;
    const incoming = new Bezier(best.points.slice(0, 4)).curvature(1).k;
    const outgoing = new Bezier(best.points.slice(3, 7)).curvature(0).k;
    best.error =
      Math.abs(Math.abs(incoming) - Math.abs(outgoing)) /
      Math.max(Math.abs(incoming), Math.abs(outgoing), 1e-12);
  }
  // A nearby orthogonal apex can leave no G2 crossing inside the interval.
  // Finish on the wall only, using the shared harmonizer and its handle bounds.
  // The split ball arc stays exact and the apex handles cannot rotate or grow.
  let correction = false;
  if (best.error > 1e-5) {
    let solved = solveNearestHandleScales(best.points, { dials: [0, 1, 0, 0] });
    if (solved.curvatureStep > 1e-5)
      solved = solveNearestHandleScales(best.points, { dials: [1, 1, 0, 0] });
    const corrected = applyHandleScales(best.points, solved.scales);
    best.points = best.points.map((p, i) => ({
      ...p,
      x: corrected[i].x,
      y: corrected[i].y,
    }));
    best.error = solved.curvatureStep;
    correction = true;
  }
  return {
    wall: best.points.slice(0, 4),
    arc: [...best.points.slice(4), ...arc.slice(3)],
    t: best.t,
    error: best.error,
    correction,
  };
}
