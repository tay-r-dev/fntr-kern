import { Bezier } from "bezier-js";
import { makeSlideCandidate } from "./point-slide.js";
import { applyHandleScales, solveNearestHandleScales } from "./harmonize-nearest.js";
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

// The ball has three points after the entry: the bottom, the pre-neck point and
// the neck attachment. The bottom is the glyph-axis extreme nearest the ball's
// front (theta 0), with its handles on that axis. It is the only orthogonal
// point. It changes axis when the ball's front turns past a diagonal. The
// pre-neck point sits halfway between the bottom and the neck, by angle. A
// stop past the neck attachment collapses onto it, so the point count holds.
export function bulbStops(ball, thetaEnd) {
  const extremes = bulbApexes(ball, -Math.PI, Math.PI);
  let bottom = extremes.reduce(
    (best, e) => (!best || Math.abs(e.theta) < Math.abs(best.theta) ? e : best),
    null
  ) ?? { theta: 0, axis: undefined };
  if (bottom.theta <= -Math.PI / 2 || bottom.theta >= thetaEnd)
    bottom = { theta: Math.min(Math.max(bottom.theta, -Math.PI / 2), thetaEnd) };
  const preNeck = { theta: (bottom.theta + thetaEnd) / 2 };
  return [bottom, preNeck];
}

// Each segment is the standard circle-cubic of its piece of the ball. At the
// transition between front/rear halves a single cubic blends their endpoint
// tangents.
export function buildBulbArc(ball, thetaEnd) {
  const endDirection = ball.tangentAt(thetaEnd);
  const endAxis =
    Math.abs(endDirection.x) < 1e-10
      ? "x"
      : Math.abs(endDirection.y) < 1e-10
        ? "y"
        : undefined;
  const stops = [...bulbStops(ball, thetaEnd), { theta: thetaEnd, axis: endAxis }];
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

// Harmonize the ball one join at a time, from the entry toward the neck. Each
// join moves only the handle that leaves it along the ball, and only in length,
// so the joins before it stay matched, the wall is untouched and the bottom
// handles stay on their axis. The neck attachment is its own join and is left
// to the neck.
function harmonizeBallJoins(points) {
  const result = points.map((p) => ({ ...p }));
  for (let join = 3; join + 3 < result.length; join += 3) {
    const stencil = result.slice(join - 3, join + 4);
    const solved = solveNearestHandleScales(stencil, { dials: [0, 0, 1, 0] });
    const placed = applyHandleScales(stencil, solved.scales);
    result[join + 1] = { ...result[join + 1], x: placed[4].x, y: placed[4].y };
  }
  return result;
}

// How far up the wall's last segment the entry may slide, as its parameter.
const SLIDE_LIMIT = 0.9;
const SLIDE_STEPS = 40;

// Slide the entry up the wall with the editor's V-slide, the way a designer
// drags it by hand. The wall piece it passes is cut exactly and joins the
// ball's first segment, which the slide refits. It stops at the first place up
// from the rib where the wall and that segment bend alike. Where they match
// nowhere on the segment, it stops at the closest match. A first shallow dip is
// not taken: the mismatch can ripple on a flat stretch far from any match. Each
// candidate is a fresh slide from the original two curves, so the answer
// depends only on the current drawing. The ball segment's entry handle then
// closes what is left, always, so there is no switch that could jump.
export function slideBulbEntry(wall, arc) {
  if (wall.length !== 4 || arc.length < 3) return null;
  const contour = { points: [...wall, ...arc.slice(0, 3)], isClosed: false };
  const sample = (s) => {
    const points =
      s === 0
        ? contour.points
        : makeSlideCandidate(contour, 3, "previous", 1 - s)?.points;
    if (!points) return null;
    const kWall = Math.abs(new Bezier(points.slice(0, 4)).curvature(1).k);
    const kBall = Math.abs(new Bezier(points.slice(3, 7)).curvature(0).k);
    if (!Number.isFinite(kWall) || !Number.isFinite(kBall)) return null;
    return { s, points, g: (kBall - kWall) / Math.max(kBall, kWall, 1e-12) };
  };
  const refineRoot = (low, high) => {
    for (let j = 0; j < 24; j++) {
      const middle = sample((low.s + high.s) / 2);
      if (!middle) break;
      if (middle.g <= 0) high = middle;
      else low = middle;
    }
    return Math.abs(low.g) < Math.abs(high.g) ? low : high;
  };
  const refineDip = (low, high) => {
    // Golden-section search for the smallest mismatch between two samples.
    const r = (Math.sqrt(5) - 1) / 2;
    let best = null;
    for (let j = 0; j < 24; j++) {
      const c = sample(high.s - r * (high.s - low.s)),
        d = sample(low.s + r * (high.s - low.s));
      if (!c || !d) break;
      for (const e of [c, d]) if (!best || Math.abs(e.g) < Math.abs(best.g)) best = e;
      if (Math.abs(c.g) < Math.abs(d.g)) high = d;
      else low = c;
    }
    return best;
  };
  const samples = [];
  for (let i = 0; i <= SLIDE_STEPS; i++) {
    const e = sample((SLIDE_LIMIT * i) / SLIDE_STEPS);
    if (e) samples.push(e);
  }
  let chosen = null;
  if (samples[0]?.g <= 0) chosen = samples[0];
  for (let i = 1; i < samples.length && !chosen; i++)
    if (samples[i].g <= 0) chosen = refineRoot(samples[i - 1], samples[i]);
  if (!chosen && samples.length) {
    let i = 0;
    samples.forEach((e, j) => {
      if (Math.abs(e.g) < Math.abs(samples[i].g)) i = j;
    });
    chosen =
      refineDip(
        samples[Math.max(i - 1, 0)],
        samples[Math.min(i + 1, samples.length - 1)]
      ) ?? samples[i];
  }
  if (!chosen) return null;
  const points = harmonizeBallJoins([...chosen.points, ...arc.slice(3)]);
  return {
    wall: points.slice(0, 4),
    arc: points.slice(4),
    s: chosen.s,
  };
}
