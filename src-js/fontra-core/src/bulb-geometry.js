import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature, harmonizeBulb } from "./bulb-harmonization.js";
import * as vector from "./vector.js";
import { makeSlideCandidate } from "./point-slide.js";

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

const sub = vector.subVectors;
const unit = (v) => {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-10 ? vector.mulVectorScalar(v, 1 / length) : { x: 0, y: 1 };
};
const offset = (p, t, d) => ({ x: p.x + t.x * d, y: p.y + t.y * d });
const handle = (p, t, length) => ({ ...offset(p, t, length), type: "cubic" });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function bulbCubic(points) {
  if (points.length === 4) return points.map((p) => ({ ...p }));
  const [a, b] = points;
  return [
    { ...a },
    { ...vector.interpolateVectors(a, b, 1 / 3), type: "cubic" },
    { ...vector.interpolateVectors(a, b, 2 / 3), type: "cubic" },
    { ...b },
  ];
}

// E is an x-extreme of the existing wall, never the anchor used to grow the
// preferred ball. De Casteljau retains that wall exactly; it is not a fit.
// A terminal segment with no vertical tangent cannot supply an orthogonal E.
// Keep its wall and publish the incompatibility instead of secretly bending it.
export function bulbEntry(wall) {
  const [p0, p1, p2, p3] = wall;
  const a = p1.x - p0.x,
    b = p2.x - p1.x,
    c = p3.x - p2.x;
  const A = a - 2 * b + c,
    B = 2 * (b - a),
    C = a;
  const tolerance = 1e-10 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  let roots = [];
  if (Math.abs(A) < tolerance) {
    if (Math.abs(B) > tolerance) roots = [-C / B];
  } else {
    const discriminant = B * B - 4 * A * C;
    if (discriminant >= 0) {
      const q = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(discriminant));
      roots = Math.abs(q) > tolerance ? [q / A, C / q] : [-B / (2 * A)];
    }
  }
  if (Math.abs(c) <= tolerance) roots.push(1);
  const t = roots.filter((t) => t > 1e-4 && t <= 1 + 1e-10).sort((a, b) => b - a)[0];
  if (t === undefined)
    return { wall: wall.map((p) => ({ ...p })), t: 1, orthogonal: false };
  const first = splitCubicAt(wall, Math.min(t, 1)).first;
  return {
    wall: first.map((p, i) => ({ ...wall[i], ...p })),
    t: Math.min(t, 1),
    orthogonal: true,
  };
}

function ballExtreme(ball, axis, sign) {
  const candidates = [
    ...bulbApexes(ball, -Math.PI, Math.PI),
    { theta: -Math.PI / 2 },
    { theta: Math.PI / 2 },
  ].map(({ theta }) => ball.at(theta));
  return candidates.reduce((a, b) => (sign * b[axis] > sign * a[axis] ? b : a));
}

// Wall is ordered toward the rib, inner is ordered from its rib toward W.
// Only the terminal inner segment is replaced. W and all subsequent on-curves
// survive with their identities, independent of ball/wall intersections.
export function buildFourPointBulb({
  wall,
  inner,
  next = null,
  radius,
  shape,
  easing,
  easeCurvature = 0.55,
  edits = null,
}) {
  wall = bulbCubic(wall);
  inner = bulbCubic(inner);
  const rib = wall[3];
  const ball = makeBulbBall({
    outer: rib,
    inner: inner[0],
    outerDirection: unit(sub(rib, wall[2])),
    radius,
    shape,
  });
  if (!ball) return null;
  const entry = bulbEntry(wall);
  const E = entry.wall[3];
  const tE = unit(sub(E, entry.wall[2]));
  const down = Math.sign(tE.y || ball.ex.y || -1);
  const across = Math.sign(ball.ey.x || -ball.ex.y || -1);
  const B = ballExtreme(ball, "y", down);
  const C = ballExtreme(ball, "x", across);
  const tB = { x: across, y: 0 },
    tC = { x: 0, y: -down };
  const W = inner[3];
  // Rear radius sets a preferred neck position on one fixed inner-wall span.
  // Keep a little lateral room beyond C for the return curve. This continuous
  // clamp replaces the old last-intersection search; no wall segment is eaten
  // as Size or Shape changes. The shared solve can move N within 15% of R.
  const terminalSpeed = 3 * vector.distance(inner[0], inner[1]);
  const q = clamp(ball.rearRadius / Math.max(terminalSpeed, radius), 0.02, 0.8);
  const onWall = cubicPointAt(inner, q);
  const N = { ...onWall };
  N.x =
    across < 0
      ? Math.max(N.x, C.x + 0.15 * radius)
      : Math.min(N.x, C.x - 0.15 * radius);
  const neckWall = splitCubicAt(inner, q).second;
  let tN = unit(sub(neckWall[1], onWall));
  const angle = clamp(edits?.neck?.turn ?? 0, -Math.PI / 2, Math.PI / 2);
  tN = {
    x: tN.x * Math.cos(angle) - tN.y * Math.sin(angle),
    y: tN.x * Math.sin(angle) + tN.y * Math.cos(angle),
  };
  const tW = unit(sub(W, inner[2]));
  const body = 0.5522847498307936;
  const neckScale = 0.5 + 0.5 * clamp(easeCurvature / 0.55, 0, 2);
  let points = [
    E,
    handle(E, tE, body * Math.max(Math.abs(B.y - E.y), 0.05 * radius)),
    handle(B, tB, -body * Math.max(Math.abs(B.x - E.x), 0.05 * radius)),
    B,
    handle(B, tB, body * Math.max(Math.abs(C.x - B.x), 0.05 * radius)),
    handle(C, tC, -body * Math.max(Math.abs(C.y - B.y), 0.05 * radius)),
    C,
    handle(C, tC, vector.distance(C, N) / 3),
    handle(N, tN, -vector.distance(C, N) / 3),
    N,
    handle(N, tN, neckScale * vector.distance(onWall, neckWall[1])),
    handle(W, tW, -vector.distance(neckWall[2], W)),
    W,
  ];
  const vslide = clamp(edits?.neck?.vslide ?? 0, -0.8, 0.8);
  if (vslide) {
    const slid = makeSlideCandidate(
      { points, isClosed: false },
      9,
      vslide < 0 ? "previous" : "next",
      vslide < 0 ? 1 + vslide : vslide
    );
    if (slid) {
      points = slid.points;
      tN = unit(sub(points[10], points[8]));
      // The manual slide supplies N's preferred location. Reassert the fixed
      // axes at C and W before the joint solve adjusts lengths.
      points[7] = handle(points[6], tC, vector.distance(points[6], points[7]));
      points[11] = handle(points[12], tW, -vector.distance(points[12], points[11]));
    }
  }
  // Edits change the preferred construction before harmonization. E remains
  // coupled to the exact wall split. Its incoming length is not an independent
  // dial: changing it alone would change the wall itself.
  const roles = ["entry", "bottom", "side", "neck"];
  const tangents = [tE, tB, tC, tN];
  for (let k = 0; k < 4; k++) {
    const edit = edits?.[roles[k]];
    if (!edit) continue;
    const i = 3 * k,
      t = tangents[k];
    const originalAnchor = { ...points[i] };
    const slide = k ? clamp(edit.slide ?? 0, -0.2 * radius, 0.2 * radius) : 0;
    const carry = k ? clamp(edit.carry ?? 0, -0.2 * radius, 0.2 * radius) : 0;
    Object.assign(points[i], offset(points[i], t, slide));
    if (k === 3) {
      Object.assign(
        points[i],
        offset(
          points[i],
          { x: -t.y, y: t.x },
          clamp(edit.normal ?? 0, -0.2 * radius, 0.2 * radius)
        )
      );
    }
    for (const [h, sign, slot] of [
      [i - 1, -1, "in"],
      [i + 1, 1, "out"],
    ]) {
      if (h < 0) continue;
      const length = Math.max(
        0,
        vector.distance(points[h], originalAnchor) +
          (edit[slot] ?? 0) +
          sign * (carry - slide)
      );
      points[h] = handle(points[i], t, sign * length);
    }
  }
  const preferred = points.map((p) => ({ ...p }));
  const result = harmonizeBulb({
    points,
    wall: entry.wall,
    nextCurvature: next
      ? bulbEndCurvature(bulbCubic(next))
      : bulbEndCurvature(inner, true),
    radius,
    neckScale: easing,
    movePoints: true,
    turnNeck: true,
  });
  points = result.points;
  return {
    ...result,
    points,
    preferred,
    wall: entry.wall,
    ball,
    tangents: [tE, tB, tC, result.neckTangent],
    entryParameter: entry.t,
    orthogonalEntry: entry.orthogonal,
  };
}
