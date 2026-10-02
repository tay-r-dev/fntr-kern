import { slideBulbEntryForCurvature } from "./bulb-entry-slide.js";
import { fitBulbNeck } from "./bulb-neck-fit.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
import * as vector from "./vector.js";
import { makeSlideCandidate, projectPointToSegment } from "./point-slide.js";
import { boundedEasingHandles } from "./serif-geometry.js";

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

// A cubic of the rib-grown ellipse, with no wall fitting in its control net.
function ballArc(ball, a, b) {
  const derivative = (theta) => {
    const rear =
      Math.cos(theta) < -1e-10 ||
      (Math.abs(Math.cos(theta)) < 1e-10 && Math.cos((a + b) / 2) < 0);
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
  const start = ball.at(a),
    end = ball.at(b),
    k = (4 / 3) * Math.tan((b - a) / 4);
  const d0 = derivative(a),
    d1 = derivative(b);
  return [
    start,
    { ...offset(start, d0, k), type: "cubic" },
    { ...offset(end, d1, -k), type: "cubic" },
    end,
  ];
}

function unwrap(theta, after) {
  while (theta < after - 1e-9) theta += 2 * Math.PI;
  return theta;
}

// Keep one terminal wall span. A cut changes its parameter, never its shape.
// Reject front-side hits: the neck belongs after C on the return arc.
function innerBallCut(ball, inner, sideTheta) {
  const level = (t) => {
    const p = ball.localOf(cubicPointAt(inner, t));
    return p.u ** 2 + p.v ** 2 - 1;
  };
  let cut = 0,
    previous = level(0);
  for (let i = 1; i <= 96; i++) {
    const t = i / 96,
      value = level(t);
    if (previous * value <= 0) {
      let lo = (i - 1) / 96,
        hi = t,
        sign = Math.sign(previous);
      for (let j = 0; j < 36; j++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(level(mid)) === sign) lo = mid;
        else hi = mid;
      }
      const root = (lo + hi) / 2;
      const theta = unwrap(ball.thetaOf(cubicPointAt(inner, root)), -Math.PI / 2);
      if (theta >= sideTheta && theta <= (3 * Math.PI) / 2 - 0.02) cut = root;
    }
    previous = value;
  }
  return cut;
}

function arcLength(points, from, to) {
  let total = 0,
    p = cubicPointAt(points, from);
  for (let i = 1; i <= 32; i++) {
    const q = cubicPointAt(points, from + ((to - from) * i) / 32);
    total += vector.distance(p, q);
    p = q;
  }
  return total;
}

function wallParameterAtDistance(points, from, distance) {
  let lo = from,
    hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (arcLength(points, from, mid) < distance) lo = mid;
    else hi = mid;
  }
  return distance > 0 ? (lo + hi) / 2 : from;
}

// P -> E is a splice, not a copy of P's skeleton handle. If E is on the wall,
// both handles come from exact subdivision. If it is on the initial ball arc,
// the shared V-slide refits P -> E, including P's outgoing handle, while the
// kept ball piece is exact. No gesture history chooses between these cases.
export function joinBulbEntry(wall, firstArc) {
  const entry = bulbEntry(wall);
  const run = { points: [...wall, ...firstArc.slice(1)], isClosed: false };
  if (entry.orthogonal) {
    const candidate =
      entry.t < 1 - 1e-10
        ? makeSlideCandidate(run, 3, "previous", entry.t)?.points
        : run.points;
    return { ...entry, wall: candidate.slice(0, 4), firstArc: candidate.slice(3, 7) };
  }
  const onBall = bulbEntry(firstArc);
  if (onBall.orthogonal && onBall.t > 1e-8 && onBall.t < 1 - 1e-8) {
    const candidate = makeSlideCandidate(run, 3, "next", onBall.t).points;
    return {
      wall: candidate.slice(0, 4),
      firstArc: candidate.slice(3, 7),
      orthogonal: true,
      t: 1,
      ballParameter: onBall.t,
    };
  }
  return { ...entry, firstArc };
}

export function buildFourPointBulb({
  wall,
  inner,
  radius,
  shape,
  easing,
  easeCurvature = 0.55,
  edits = null,
  preview = false,
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
  const stops = bulbApexes(ball, -Math.PI / 2, (3 * Math.PI) / 2);
  const bottom = stops.find((p) => p.axis === "y") ?? { theta: 0 };
  const side = stops.find((p) => p.axis === "x" && p.theta > bottom.theta) ?? {
    theta: Math.PI / 2,
  };
  const first = ballArc(ball, -Math.PI / 2, bottom.theta);
  const entry = joinBulbEntry(wall, first);
  const cut = innerBallCut(ball, inner, side.theta);
  const cutPoint = cubicPointAt(inner, cut);
  const thetaCut = clamp(
    unwrap(ball.thetaOf(cutPoint), -Math.PI / 2),
    side.theta + 0.02,
    (3 * Math.PI) / 2 - 0.02
  );
  const room = Math.max(0, thetaCut - side.theta - 0.02);
  // Zero is a corner. Positive easing first constructs the reference fillet;
  // the editable neck is fitted to that outline below.
  const corner = easing === 0;
  const extent = corner ? 0 : easing;
  const retreat = extent * Math.min(0.55, 0.75 * room);
  const thetaA = thetaCut - retreat;
  const wallShare = Math.min(1, extent * (0.75 + 0.5 * clamp(easeCurvature, 0, 1)));
  const easeDistance = wallShare * arcLength(inner, cut, 0.995);
  const cutParameter = wallParameterAtDistance(inner, cut, easeDistance);
  const keptInner = splitCubicAt(inner, cutParameter).second.map((p, i) => ({
    ...inner[i],
    ...p,
  }));
  const A = ball.at(thetaA),
    W = keptInner[0];
  if (corner && vector.distance(A, W) < 1e-6 * radius) Object.assign(A, W);
  const tA = ball.tangentAt(thetaA),
    tW = unit(sub(keptInner[1], W));
  const uv = ({ x, y }) => ({ u: x, v: y });
  const neck = boundedEasingHandles(
    uv(A),
    uv(tA),
    uv(W),
    uv(vector.mulVectorScalar(tW, -1)),
    0.35 + 0.65 * clamp(easeCurvature, 0, 1),
    { nearWindow: 1 }
  );
  const returnArc = ballArc(ball, side.theta, thetaA);
  returnArc[3] = A;
  const easingCurve = [A, handle(A, tA, neck.startLen), handle(W, tW, -neck.endLen), W];
  // A and W are internal reference boundaries, not emitted neck points.
  const bodyArc = ballArc(ball, bottom.theta, side.theta);
  const referenceCurves = corner
    ? [first, bodyArc, returnArc, keptInner]
    : [first, bodyArc, returnArc, easingCurve, keptInner];
  const referencePoints = referenceCurves.flatMap((curve, i) =>
    (i ? curve.slice(1) : curve).map((p) => ({ ...p }))
  );
  const fittedReturn = corner
    ? returnArc
    : makeSlideCandidate(
        { points: [...returnArc, ...easingCurve.slice(1)], isClosed: false },
        3,
        "previous",
        0
      ).points.slice(3);
  const fittedWall = keptInner;
  let points = [
    ...entry.firstArc,
    ...bodyArc.slice(1),
    ...fittedReturn.slice(1),
    ...fittedWall.slice(1),
  ].map((p) => ({ ...p }));
  points[9].smooth = !corner;
  points[9].skipColinear = true;
  for (const [i, axis] of [
    [3, "y"],
    [6, "x"],
  ]) {
    points[i - 1][axis] = points[i][axis];
    points[i + 1][axis] = points[i][axis];
  }
  if (preview) {
    return {
      points: referencePoints,
      // The reference retains the original P-to-rib wall exactly. E is a
      // fitting constraint only; imposing it here was bending the preview.
      wall: wall.map((p) => ({ ...p })),
      keptInner: [referencePoints.at(-1)],
      preview: true,
      error: 0,
      status: "reference",
      ball,
      entryParameter: entry.t,
      entryBallParameter: entry.ballParameter,
      orthogonalEntry: entry.orthogonal,
    };
  }
  const tN = unit(sub(points[9], points[8]));
  const tE = unit(sub(points[1], points[0]));
  const tangents = [
    tE,
    unit(sub(points[4], points[3])),
    unit(sub(points[7], points[6])),
    tN,
  ];
  const roles = ["entry", "bottom", "side", "neck"];
  const uneditedNeck = points.slice(8, 11).map((p) => ({ ...p }));
  for (let k = 0; k < roles.length; k++) {
    const edit = edits?.[roles[k]];
    if (
      !edit ||
      !["slide", "normal", "turn", "in", "out", "carry"].some((field) => edit[field])
    )
      continue;
    const i = 3 * k,
      before = { ...points[i] };
    let tangent = tangents[k];
    if (k === 3 && edit.turn) {
      const angle = clamp(edit.turn, -Math.PI / 2, Math.PI / 2);
      tangent = {
        x: tangent.x * Math.cos(angle) - tangent.y * Math.sin(angle),
        y: tangent.x * Math.sin(angle) + tangent.y * Math.cos(angle),
      };
      tangents[k] = tangent;
    }
    const slide = k ? clamp(edit.slide ?? 0, -0.15 * radius, 0.15 * radius) : 0;
    const normal = k === 3 ? clamp(edit.normal ?? 0, -0.15 * radius, 0.15 * radius) : 0;
    Object.assign(
      points[i],
      offset(offset(before, tangent, slide), { x: -tangent.y, y: tangent.x }, normal)
    );
    for (const [h, sign, slot] of [
      [i - 1, -1, "in"],
      [i + 1, 1, "out"],
    ]) {
      if (h < 0) continue;
      const length = Math.max(
        0,
        vector.distance(points[h], before) +
          (edit[slot] ?? 0) +
          sign * ((k ? (edit.carry ?? 0) : 0) - slide)
      );
      if (k === 3 && corner) {
        const direction = unit(sub(points[h], before));
        const angle = clamp(edit.turn ?? 0, -Math.PI / 2, Math.PI / 2);
        points[h] = handle(
          points[i],
          {
            x: direction.x * Math.cos(angle) - direction.y * Math.sin(angle),
            y: direction.x * Math.sin(angle) + direction.y * Math.cos(angle),
          },
          length
        );
      } else points[h] = handle(points[i], tangent, sign * length);
    }
  }
  const preferred = points.map((p) => ({ ...p }));
  let neckFit;
  if (!corner) {
    neckFit = fitBulbNeck({
      points,
      reference: referencePoints.slice(6),
      wall: entry.wall,
      radius,
      nextCurvature: bulbEndCurvature(inner, true),
      neckOffsets: points.slice(8, 11).map((p, i) => sub(p, uneditedNeck[i])),
    });
    points = neckFit.points;
  }
  // V-slide acts on the fitted pair. It retains the traveled subcurve and
  // refits the other span, without introducing a second neck point.
  const v = clamp(edits?.neck?.vslide ?? 0, -0.995, 0.995);
  if (v) {
    points = makeSlideCandidate(
      { points, isClosed: false },
      9,
      v < 0 ? "previous" : "next",
      v < 0 ? 1 + v : v
    ).points;
  }
  const neckWallParameter = projectPointToSegment(
    { kind: "cubic", points: inner },
    points[9]
  ).t;
  const result = { points, error: 0, status: "bounded" };
  const entrySlide = slideBulbEntryForCurvature({
    wall: entry.wall,
    points,
    radius,
    sourceWall: wall,
    sourceArc: first,
  });
  if (entrySlide) {
    points = entrySlide.points;
    entry.wall = entrySlide.wall;
    entry.orthogonal = Math.abs(points[1].x - points[0].x) < 1e-8;
    if (entrySlide.direction === "previous") {
      entry.t = entrySlide.parameter;
      entry.ballParameter = undefined;
    } else if (entry.ballParameter !== undefined) {
      entry.ballParameter += (1 - entry.ballParameter) * entrySlide.parameter;
    }
    tangents[0] = unit(sub(points[1], points[0]));
  }
  result.points = points;
  const errors = [
    Math.abs(bulbEndCurvature(entry.wall, true) - bulbEndCurvature(points.slice(0, 4))),
  ];
  for (const join of [3, 6, ...(corner ? [] : [9])]) {
    errors.push(
      Math.abs(
        bulbEndCurvature(points.slice(join - 3, join + 1), true) -
          bulbEndCurvature(points.slice(join, join + 4))
      )
    );
  }
  errors.push(
    Math.abs(bulbEndCurvature(points.slice(9), true) - bulbEndCurvature(inner, true))
  );
  result.error = Math.max(...errors) * radius;
  result.status = result.error < 1e-5 ? "matched" : "bounded";

  const neckTangent = unit(sub(points[9], points[8]));
  return {
    ...result,
    points,
    preferred,
    neckFitDeparture: neckFit?.departure ?? 0,
    wall: entry.wall,
    keptInner: [points[12]],
    referencePoints,
    referenceWall: splitCubicAt(inner, neckWallParameter).second,
    ball,
    tangents: [...tangents.slice(0, 3), neckTangent],
    cutParameter: neckWallParameter,
    referenceReturn: returnArc,
    referenceEasing: easingCurve,
    entryParameter: entry.t,
    entryBallParameter: entry.ballParameter,
    orthogonalEntry: entry.orthogonal,
    entrySlide,
  };
}
