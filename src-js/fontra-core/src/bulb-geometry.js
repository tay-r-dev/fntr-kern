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

// The ball has three points after the entry: the bottom, the side apex and the
// neck attachment. The bottom is the glyph-axis extreme nearest the ball's
// front (theta 0). The side apex is the next glyph-axis extreme after it, toward
// the neck, so the segment between them is a true quarter of the ball. Both
// have their handles on their axis. The bottom changes axis when the ball's
// front turns past a diagonal. A stop past the neck attachment collapses onto
// it, so the point count holds; the neck starts after the side apex.
export function bulbStops(ball, thetaEnd) {
  const extremes = bulbApexes(ball, -Math.PI, 2 * Math.PI);
  let bottom = extremes.reduce(
    (best, e) => (!best || Math.abs(e.theta) < Math.abs(best.theta) ? e : best),
    null
  ) ?? { theta: 0, axis: undefined };
  const clamp = (stop) =>
    stop.theta <= -Math.PI / 2 || stop.theta >= thetaEnd
      ? { theta: Math.min(Math.max(stop.theta, -Math.PI / 2), thetaEnd) }
      : stop;
  const side = extremes.find((e) => e.theta > bottom.theta + 1e-9) ?? {
    theta: thetaEnd,
  };
  return [clamp(bottom), clamp(side)];
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

// The ball after the bottom point stays an exact piece of the ball. Only the
// slid segment adjusts, in handle length: its bottom handle meets the ball's
// quarter at the bottom point and its entry handle meets the wall at the entry.
// Each changes the other end's bend a little, so the two alternate until both
// hold. The wall is untouched and the bottom handle stays on its axis.
const JOIN_ROUNDS = 40;
function harmonizeSlidSegment(points) {
  const result = points.map((p) => ({ ...p }));
  const settle = (join, dials, slot) => {
    const stencil = result.slice(join - 3, join + 4);
    const solved = solveNearestHandleScales(stencil, { dials });
    const placed = applyHandleScales(stencil, solved.scales);
    result[join - 3 + slot] = {
      ...result[join - 3 + slot],
      x: placed[slot].x,
      y: placed[slot].y,
    };
    return solved.status === "skipped";
  };
  for (let round = 0; round < JOIN_ROUNDS; round++) {
    // A round where both joins already hold changes nothing: stop there.
    const bottomHeld = result.length >= 10 ? settle(6, [0, 1, 0, 0], 2) : true;
    const entryHeld = settle(3, [0, 0, 1, 0], 4);
    if (bottomHeld && entryHeld) break;
  }
  return result;
}

// Signed curvature and speed of a cubic at t.
function curvatureAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const d1x =
    3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x));
  const d1y =
    3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y));
  const d2x = 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x));
  const d2y = 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y));
  const speed = Math.hypot(d1x, d1y);
  return { k: speed > 1e-12 ? (d1x * d2y - d1y * d2x) / speed ** 3 : 0, speed };
}

// How far the entry may slide, as the parameter of the segment it slides on:
// up the wall's last segment, or into the ball's first segment.
const SLIDE_LIMIT = 0.9;
const SLIDE_STEPS = 20;
const REFINE_STEPS = 12;

// The slide chosen for each bulb during the current gesture. A drag asks for
// the match nearest the previous frame's, so the entry moves smoothly even when
// the match it follows travels far. The editor clears this when the next
// pointer or key press starts a gesture; after that the rest rule applies.
// ponytail: keyed by skeleton point, not by glyph; two glyphs regenerated in one
// gesture with the same point ids would share a slide.
const slideMemory = new Map();
export function clearBulbSlideMemory() {
  slideMemory.clear();
}

// The parameter where a cubic's tangent has no component along `axis`, nearest
// `from` within [low, high]: where the curve turns horizontal or vertical.
function axisTurn([p0, p1, p2, p3], axis, from, low, high) {
  const a = p1[axis] - p0[axis],
    b = p2[axis] - p1[axis],
    c = p3[axis] - p2[axis];
  // The derivative's coordinate is a(1-t)^2 + 2b(1-t)t + ct^2.
  const A = a - 2 * b + c,
    B = 2 * (b - a),
    C = a;
  const roots = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const d = B * B - 4 * A * C;
    if (d >= 0)
      roots.push((-B - Math.sqrt(d)) / (2 * A), (-B + Math.sqrt(d)) / (2 * A));
  }
  return roots
    .filter((t) => t >= low - 1e-12 && t <= high + 1e-12)
    .sort((x, y) => Math.abs(x - from) - Math.abs(y - from))[0];
}

// The entry's ideal place: the glyph-axis extreme before the bottom point, on
// the wall's last segment or on the ball's first segment, whichever is nearer
// the rib. Its axis is the other one from the bottom's. As a slide: positive up
// the wall, negative into the ball, 0 at the rib.
function entryApexSlide(contour, bottomAxis) {
  if (!bottomAxis) return 0;
  const axis = bottomAxis === "x" ? "y" : "x";
  const points = contour.points;
  const onWall = axisTurn(points.slice(0, 4), axis, 1, 1 - SLIDE_LIMIT, 1);
  const onBall = axisTurn(points.slice(3, 7), axis, 0, 0, SLIDE_LIMIT);
  const up = onWall === undefined ? Infinity : 1 - onWall;
  const down = onBall === undefined ? Infinity : onBall;
  if (!Number.isFinite(up) && !Number.isFinite(down)) return 0;
  return up <= down ? up : -down;
}

// Slide the entry with the editor's V-slide, the way a designer drags it by
// hand: up the wall, or into the ball. The piece it passes is cut exactly and
// the other side refits to keep drawing the old path. The entry starts from its
// ideal place, the extreme before the bottom point, and stops at the curvature
// match nearest to it. During a drag it stops at the match nearest the
// previous frame's instead. Where nothing matches, it stops at the closest
// match. The slid segment's two handle lengths then close what is left.
export function slideBulbEntry(wall, arc, { key, bottomAxis } = {}) {
  if (wall.length !== 4 || arc.length < 3) return null;
  const contour = { points: [...wall, ...arc.slice(0, 3)], isClosed: false };
  const sample = (s) => {
    const points =
      s === 0
        ? contour.points
        : s > 0
          ? makeSlideCandidate(contour, 3, "previous", 1 - s)?.points
          : makeSlideCandidate(contour, 3, "next", -s)?.points;
    if (!points) return null;
    const kWall = Math.abs(curvatureAt(points.slice(0, 4), 1).k);
    const kBall = Math.abs(curvatureAt(points.slice(3, 7), 0).k);
    if (!Number.isFinite(kWall) || !Number.isFinite(kBall)) return null;
    return { s, points, g: (kBall - kWall) / Math.max(kBall, kWall, 1e-12) };
  };
  const remembered = key !== undefined ? slideMemory.get(key) : undefined;
  const reference = remembered ?? entryApexSlide(contour, bottomAxis);

  const samples = [];
  for (let i = -SLIDE_STEPS; i <= SLIDE_STEPS; i++) {
    const e = sample((SLIDE_LIMIT * i) / SLIDE_STEPS);
    if (e) samples.push(e);
  }
  const refineRoot = (low, high) => {
    for (let j = 0; j < REFINE_STEPS; j++) {
      const middle = sample((low.s + high.s) / 2);
      if (!middle) break;
      if (Math.sign(middle.g) === Math.sign(low.g)) low = middle;
      else high = middle;
    }
    return Math.abs(low.g) < Math.abs(high.g) ? low : high;
  };
  const refineDip = (low, high) => {
    // Golden-section search for the smallest mismatch between two samples.
    const r = (Math.sqrt(5) - 1) / 2;
    let best = null;
    for (let j = 0; j < REFINE_STEPS; j++) {
      const c = sample(high.s - r * (high.s - low.s)),
        d = sample(low.s + r * (high.s - low.s));
      if (!c || !d) break;
      for (const e of [c, d]) if (!best || Math.abs(e.g) < Math.abs(best.g)) best = e;
      if (Math.abs(c.g) < Math.abs(d.g)) high = d;
      else low = c;
    }
    return best;
  };
  let chosen = null;
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]];
    if (a.g * b.g > 0) continue;
    // Skip brackets farther from the reference than the best root so far.
    const near = Math.min(Math.abs(a.s - reference), Math.abs(b.s - reference));
    if (chosen && near > Math.abs(chosen.s - reference)) continue;
    const root = a.g === 0 ? a : b.g === 0 ? b : refineRoot(a, b);
    if (!chosen || Math.abs(root.s - reference) < Math.abs(chosen.s - reference))
      chosen = root;
  }
  // During a drag, a match can merge with its neighbor and vanish. The closest
  // near-match continues from where they merged, so it competes on distance too.
  if (remembered !== undefined)
    for (let i = 1; i + 1 < samples.length; i++) {
      const [a, b, c] = [samples[i - 1], samples[i], samples[i + 1]];
      if (Math.abs(b.g) > Math.abs(a.g) || Math.abs(b.g) > Math.abs(c.g)) continue;
      if (a.g * b.g <= 0 || b.g * c.g <= 0) continue;
      if (chosen && Math.abs(b.s - reference) >= Math.abs(chosen.s - reference))
        continue;
      chosen = refineDip(a, c) ?? b;
    }
  if (!chosen && samples.length)
    chosen = samples.reduce((best, e) => (Math.abs(e.g) < Math.abs(best.g) ? e : best));
  if (!chosen) return null;
  if (key !== undefined) slideMemory.set(key, chosen.s);
  const points = harmonizeSlidSegment([...chosen.points, ...arc.slice(3)]);
  return {
    wall: points.slice(0, 4),
    arc: points.slice(4),
    s: chosen.s,
  };
}
