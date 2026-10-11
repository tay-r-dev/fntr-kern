import {
  matchCubicEndCurvatures,
  slideBulbEntryForCurvature,
} from "./bulb-entry-slide.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
import * as vector from "./vector.js";
import { makeSlideCandidate } from "./point-slide.js";
import {
  balancePathInPlace,
  HARMONIZE_DEFAULTS,
  harmonizeNearestInPlace,
} from "./harmonization.js";
import { VarPackedPath } from "./var-path.js";

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

// The curvature the stroke leaves the bulb's last wall point with, where the
// wall runs on smoothly past it. A corner there has nothing to match.
function curvatureBeyond(inner, beyond) {
  if (!beyond || beyond.length !== 4) return undefined;
  const q = inner[3];
  const arriving = unit(sub(q, inner[2]));
  const leaving = unit(sub(beyond[1], q));
  const cross = arriving.x * leaving.y - arriving.y * leaving.x;
  const dot = arriving.x * leaving.x + arriving.y * leaving.y;
  if (!(dot > 0 && Math.abs(cross) < Math.sin((2 * Math.PI) / 180))) return undefined;
  return bulbEndCurvature(beyond);
}

// Reach a cubic's end with curvature k and keep the curvature it starts with.
// Both handle lengths change and their directions do not; one handle alone
// moves the start curvature too. Null where no pair of lengths does both.
function arriveWithCurvature(curve, k, radius) {
  return matchCubicEndCurvatures(curve, bulbEndCurvature(curve), k, radius);
}
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

// P -> E is a splice, not a copy of P's skeleton handle: both handles come
// from exact subdivision. E is always on the outer wall, never on the ball. A
// wall without an extreme keeps E at its end, and the entry slide moves it up
// the wall from there.
export function joinBulbEntry(wall, firstArc) {
  const entry = bulbEntry(wall);
  if (entry.orthogonal && entry.t < 1 - 1e-10) {
    const run = { points: [...wall, ...firstArc.slice(1)], isClosed: false };
    const candidate = makeSlideCandidate(run, 3, "previous", entry.t).points;
    return { ...entry, wall: candidate.slice(0, 4), firstArc: candidate.slice(3, 7) };
  }
  return { ...entry, firstArc };
}

// How far back along the ball the fillet may reach from the corner, in radii.
const FILLET_BALL_STOP = 0.75;
// The arc from the side apex C to the fillet keeps at least this much of the
// ball, in radii. A stub shorter than that has handles of a few units, and
// whole-unit rounding turns its curvature over: a step of 32 times the ball's
// own curvature at C where the corner stood one radius from it.
const FILLET_MIN_RETURN = 0.25;
// The fillet's handle on the ball side may not fall under this share of its
// chord. Where it would, the fillet has gone as far up the wall as it can.
const FILLET_MIN_BALL_HANDLE = 0.2;
// How finely the wall is scanned for the fillet's limit, then bisected.
const FILLET_SCAN_STEPS = 32;
const FILLET_BISECT_STEPS = 20;

// Signed curvature of a cubic at t, in traversal order. Unlike reading the
// start of a split, it holds at t = 1.
function cubicCurvatureAt(points, t) {
  const [p0, p1, p2, p3] = points;
  const mt = 1 - t;
  const d = {
    x:
      3 *
      (mt * mt * (p1.x - p0.x) + 2 * mt * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
    y:
      3 *
      (mt * mt * (p1.y - p0.y) + 2 * mt * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
  };
  const dd = {
    x: 6 * (mt * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
    y: 6 * (mt * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
  };
  const speed = Math.hypot(d.x, d.y);
  return speed > 1e-12 ? (d.x * dd.y - d.y * dd.x) / speed ** 3 : 0;
}

function cubicTangentAt(points, t) {
  const [p0, p1, p2, p3] = points;
  const mt = 1 - t;
  return unit({
    x: mt * mt * (p1.x - p0.x) + 2 * mt * t * (p2.x - p1.x) + t * t * (p3.x - p2.x),
    y: mt * mt * (p1.y - p0.y) + 2 * mt * t * (p2.y - p1.y) + t * t * (p3.y - p2.y),
  });
}

// Length along the ball between two angles: the speed integrated by Simpson's
// rule. A sum of chords falls short by a tenth of a per cent over a quarter turn.
function ballArcLength(ball, from, to, n = 64) {
  const speed = (theta) => {
    const along = Math.cos(theta) < -1e-10 ? ball.rearRadius : ball.radius;
    return Math.hypot(
      -ball.ex.x * along * Math.sin(theta) + ball.ey.x * ball.radius * Math.cos(theta),
      -ball.ex.y * along * Math.sin(theta) + ball.ey.y * ball.radius * Math.cos(theta)
    );
  };
  const h = (to - from) / n;

  let total = speed(from) + speed(to);
  for (let i = 1; i < n; i++) total += (i % 2 ? 4 : 2) * speed(from + i * h);
  return (total * h) / 3;
}

// The ball angle a given length back along the ball from `to`, read off a table
// of lengths built once per bulb: the search for the fillet's limit asks this
// dozens of times, and integrating the arc on every bisection step cost a
// tenth of the bulb. Linear between rows, so it moves continuously.
const BALL_TABLE_STEPS = 512;
function ballThetaBackTable(ball, lowest, to) {
  const thetas = [],
    lengths = [];
  let total = 0;
  for (let i = 0; i <= BALL_TABLE_STEPS; i++) {
    const theta = to - ((to - lowest) * i) / BALL_TABLE_STEPS;
    if (i) total += ballArcLength(ball, theta, thetas[i - 1], 4);
    thetas.push(theta);
    lengths.push(total);
  }
  return (length) => {
    if (length <= 0) return to;
    if (length >= total) return lowest;
    let lo = 0,
      hi = BALL_TABLE_STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < length) lo = mid;
      else hi = mid;
    }
    const s = (length - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
    return thetas[lo] + (thetas[hi] - thetas[lo]) * s;
  };
}

// The fillet: one cubic from A on the ball to W on the wall, leaving the ball
// with the ball's curvature and arriving with the wall's, so the comb runs on
// through both ends. Its two handle lengths are the two unknowns, and there can
// be more than one pair. The search starts from both handles reaching most of
// the way to where the two tangents cross, which is the fillet's own shape,
// then from a fixed grid. The first pair that the caller accepts wins, so the
// same input always gives the same fillet.
function solveFillet(A, tA, kA, W, tW, kW, radius, accept) {
  const chord = vector.distance(A, W);
  if (!(chord > 1e-6)) return null;
  const make = (a, b) => [
    { ...A },
    { ...offset(A, tA, a), type: "cubic" },
    { ...offset(W, tW, -b), type: "cubic" },
    { ...W },
  ];
  const d = sub(W, A),
    determinant = cross(tA, tW);
  const starts = [];
  if (Math.abs(determinant) > 1e-12) {
    const reachA = cross(d, tW) / determinant,
      reachW = -cross(d, tA) / determinant;
    if (reachA > 0 && reachW > 0) starts.push([0.9 * reachA, 0.9 * reachW]);
  }
  for (const [i, j] of FILLET_STARTS) starts.push([(chord * i) / 6, (chord * j) / 6]);
  // Most starts arrive at the same pair. A pair already judged is not judged
  // again.
  const judged = [];
  for (const [a, b] of starts) {
    const solved = matchCubicEndCurvatures(make(a, b), kA, kW, radius);
    if (!solved) continue;
    const lengths = [
      vector.distance(solved[0], solved[1]),
      vector.distance(solved[3], solved[2]),
    ];
    if (
      judged.some(
        ([p, q]) => Math.abs(p - lengths[0]) + Math.abs(q - lengths[1]) < 1e-6 * chord
      )
    )
      continue;
    if (accept(solved)) return solved;
    judged.push(lengths);
  }
  return null;
}
const FILLET_STARTS = (() => {
  const steps = [1, 2, 4, 6, 9, 12];
  const starts = [[2, 2]];
  for (const i of steps)
    for (const j of steps) if (i !== 2 || j !== 2) starts.push([i, j]);
  return starts;
})();
const cross = (a, b) => a.x * b.y - a.y * b.x;

// The bulb: E, B and C on the ball, A where the ball gives way to the easing
// fillet, W where the fillet meets the inner wall, then Q, the wall's next
// existing point. Sixteen points, at every easing: at zero easing A, W and the
// fillet's handles all lie on the corner where the ball meets the wall.
//
// Easing fills that corner the way solder fills the corner between a part and
// its pad. It adds material and never removes any: the ball stays whole under
// the fillet, and the stroke stays whole beside it. The fillet's ball end goes
// back from the corner as far as its wall end climbs, up to 0.75 of a radius,
// then stops. Its wall end climbs on. Full easing is the furthest the wall end
// can climb while one curve still fills the corner, with matching curvature at
// both ends, outside the ball and outside the stroke.
//
// `preview` says an edit is in progress. The geometry is the same; the caller
// hides E and its handles until release, because the entry fit can move E far
// along the wall in one step and that jump is not to be seen under the cursor.
export function buildBulb({
  wall,
  inner,
  radius,
  shape,
  easing,
  edits = null,
  beyond = null,
  preview = false,
}) {
  wall = bulbCubic(wall);
  inner = bulbCubic(inner);
  // Q is reached with the curvature the stroke leaves it with, not with the
  // cut wall's own end curvature. Copying that end carried any step already at
  // the point into the bulb, where nothing could remove it.
  const wallCurvature = curvatureBeyond(inner, beyond);
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
  const bodyArc = ballArc(ball, bottom.theta, side.theta);
  const cut = innerBallCut(ball, inner, side.theta);
  const cutPoint = cubicPointAt(inner, cut);
  const thetaLowest = side.theta + 0.02;
  const thetaCut = clamp(
    unwrap(ball.thetaOf(cutPoint), -Math.PI / 2),
    thetaLowest,
    (3 * Math.PI) / 2 - 0.02
  );
  const corner = ball.at(thetaCut);
  const ballStop = Math.min(
    FILLET_BALL_STOP * radius,
    Math.max(0, ballArcLength(ball, side.theta, thetaCut) - FILLET_MIN_RETURN * radius)
  );
  const wallLength = arcLength(inner, cut, 1);

  // E, B and C with the designer's edits, and the arc from C to A.
  const tangents = [];
  const body = (thetaA) => {
    const returnArc = ballArc(ball, side.theta, thetaA);
    const points = [...entry.firstArc, ...bodyArc.slice(1), ...returnArc.slice(1)].map(
      (p) => ({ ...p })
    );
    for (const [i, axis] of [
      [3, "y"],
      [6, "x"],
    ]) {
      points[i - 1][axis] = points[i][axis];
      points[i + 1][axis] = points[i][axis];
    }
    tangents.length = 0;
    applyBulbEdits(points, edits, tangents, radius);
    return points;
  };

  const counter = counterSideOf(inner, cut, ball.at(side.theta));
  const thetaBack = ballThetaBackTable(ball, thetaLowest, thetaCut);
  const filletAt = (travel) => {
    const thetaA = thetaBack(Math.min(travel, ballStop));
    const points = body(thetaA);
    const A = points[9];
    const tA = unit(sub(A, points[8]));
    const kA = bulbEndCurvature(points.slice(6, 10), true);
    const t = travel >= wallLength ? 1 : wallParameterAtDistance(inner, cut, travel);
    const rest = splitCubicAt(inner, t).second.map((p, i) => ({ ...inner[i], ...p }));
    const W = rest[0];
    const fillet = solveFillet(
      A,
      tA,
      kA,
      W,
      cubicTangentAt(inner, t),
      cubicCurvatureAt(inner, t),
      radius,
      (fillet) =>
        vector.distance(fillet[0], fillet[1]) >=
          FILLET_MIN_BALL_HANDLE * vector.distance(A, W) &&
        fillsCorner(fillet, ball, counter)
    );
    if (!fillet) return null;
    return { points, fillet, rest };
  };

  // How far the wall end can climb: scan, then bisect the first failure.
  let reach = wallLength;
  for (let i = 1; i <= FILLET_SCAN_STEPS; i++) {
    if (filletAt((wallLength * i) / FILLET_SCAN_STEPS)) continue;
    let lo = (wallLength * (i - 1)) / FILLET_SCAN_STEPS,
      hi = (wallLength * i) / FILLET_SCAN_STEPS;
    for (let j = 0; j < FILLET_BISECT_STEPS; j++) {
      const mid = (lo + hi) / 2;
      if (filletAt(mid)) lo = mid;
      else hi = mid;
    }
    reach = lo;
    break;
  }

  const travel = clamp(easing, 0, 1) * reach;
  let built = travel > 0 ? filletAt(travel) : null;
  let points;
  if (built) {
    points = [...built.points, ...built.fillet.slice(1), ...built.rest.slice(1)];
    points[9].smooth = true;
    points[12].smooth = true;
  } else {
    // No easing: the ball meets the wall at a corner. The fillet's four points
    // and W lie on it.
    const rest = splitCubicAt(inner, cut).second.map((p, i) => ({ ...inner[i], ...p }));
    points = [...body(thetaCut)];
    Object.assign(points[9], corner);
    points.push(
      { ...corner, type: "cubic" },
      { ...corner, type: "cubic" },
      { ...corner },
      ...rest.slice(1).map((p) => ({ ...p }))
    );
    points[9].smooth = false;
    points[12].smooth = false;
  }
  points = points.map((p) => ({ ...p }));
  points[9].skipColinear = true;
  points[12].skipColinear = true;
  // Q: the last span keeps the curvature it leaves W with and arrives with the
  // stroke's.
  if (wallCurvature !== undefined) {
    const arrived = arriveWithCurvature(points.slice(12, 16), wallCurvature, radius);
    if (arrived) points = [...points.slice(0, 12), ...arrived];
  }

  // E at the extreme if the fit holds there, else V-slid toward the wall's
  // centre (slideBulbEntryForCurvature).
  const entrySlide = slideBulbEntryForCurvature({
    wall: entry.wall,
    points,
    radius,
    sourceWall: wall,
    sourceArc: first,
    entryParameter: entry.t,
  });
  if (entrySlide) {
    points = entrySlide.points;
    entry.wall = entrySlide.wall;
    entry.orthogonal = Math.abs(points[1].x - points[0].x) < 1e-8;
    if (entrySlide.direction === "previous") entry.t = entrySlide.parameter;
    tangents[0] = unit(sub(points[1], points[0]));
    // Then harmonize B: G2, keep curvature, equalize handles. These are the
    // press's own steps, one balance and one repair, on exact coordinates.
    // The press itself would keep B as it is, because B is already exact.
    const path = VarPackedPath.fromUnpackedContours([
      {
        points: points
          .slice(0, 7)
          .map((p, i) => ({ ...p, ...(i === 3 ? { smooth: true } : {}) })),
        isClosed: false,
      },
    ]);
    balancePathInPlace(path, [3], { roundCoordinates: false });
    harmonizeNearestInPlace(path, [3], { ...HARMONIZE_DEFAULTS, continuity: "G2" });
    for (let i = 1; i < 6; i++) {
      const { x, y } = path.getPoint(i);
      points[i] = { ...points[i], x, y };
    }
  }
  const errors = [
    Math.abs(bulbEndCurvature(entry.wall, true) - bulbEndCurvature(points.slice(0, 4))),
  ];
  for (const join of [3, 6, ...(built ? [9, 12] : [])])
    errors.push(
      Math.abs(
        bulbEndCurvature(points.slice(join - 3, join + 1), true) -
          bulbEndCurvature(points.slice(join, join + 4))
      )
    );
  const error = Math.max(...errors) * radius;
  return {
    points,
    error,
    status: error < 1e-5 ? "matched" : "bounded",
    wall: entry.wall,
    keptInner: [points[15]],
    ball,
    tangents,
    fillet: { travel, reach },
    entryParameter: entry.t,
    orthogonalEntry: entry.orthogonal,
    entrySlide,
    preview,
  };
}

// The designer's edits to E, B and C: each on-curve slides along its tangent,
// and each handle lengthens along its own line. E and its incoming handle stay
// on the exact wall. Publishes the three tangents.
function applyBulbEdits(points, edits, tangents, radius) {
  const directions = [
    unit(sub(points[1], points[0])),
    unit(sub(points[4], points[3])),
    unit(sub(points[7], points[6])),
  ];
  tangents.push(...directions);
  ["entry", "bottom", "side"].forEach((role, k) => {
    const edit = edits?.[role];
    if (!edit || !["slide", "in", "out", "carry"].some((field) => edit[field])) return;
    const i = 3 * k,
      before = { ...points[i] },
      tangent = directions[k];
    const slide = k ? clamp(edit.slide ?? 0, -0.15 * radius, 0.15 * radius) : 0;
    Object.assign(points[i], offset(before, tangent, slide));
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
      points[h] = handle(points[i], tangent, sign * length);
    }
  });
}

// Signed distance from the inner wall past the corner, positive on the counter
// side: the side the ball's side apex stands on. The wall is sampled once per
// bulb, finely enough that the chords stand off the curve by far less than the
// check's own tolerance, and each point is measured to the nearest chord.
const WALL_SAMPLES = 256;
function counterSideOf(inner, cut, reference) {
  const wall = Array.from({ length: WALL_SAMPLES + 1 }, (_, i) =>
    cubicPointAt(inner, cut + ((1 - cut) * i) / WALL_SAMPLES)
  );
  // The nearest sample out of every eighth, then the chords around it.
  const STRIDE = 8;
  const signed = (p) => {
    let nearest = 0,
      nearestDistance = Infinity;
    for (let i = 0; i <= WALL_SAMPLES; i += STRIDE) {
      const d = vector.distance(p, wall[i]);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = i;
      }
    }
    let best = Infinity,
      side = 0;
    const from = Math.max(0, nearest - STRIDE),
      to = Math.min(WALL_SAMPLES, nearest + STRIDE);
    for (let i = from; i < to; i++) {
      const a = wall[i],
        b = wall[i + 1];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const s =
        lengthSquared > 0
          ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1)
          : 0;
      const qx = a.x + s * dx,
        qy = a.y + s * dy;
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < best) {
        best = d;
        side = dx * (p.y - qy) - dy * (p.x - qx);
      }
    }
    return Math.sign(side) * best;
  };
  const sign = Math.sign(signed(reference)) || 1;
  return (p) => sign * signed(p);
}

// The fillet leaves the ball with the ball's curvature but not with the rate it
// changes at, so it can graze the ball just after A: 0.06 units at most on the
// skeletron-test glyphs. A quarter of a unit is under what the grid can draw.
const BALL_TOLERANCE = 0.25;

// The fillet fills the corner: no point of it lies inside the ball, and none
// lies on the stroke's side of the wall. The ball, the cheaper test, goes first.
function fillsCorner(fillet, ball, counter) {
  const samples = Array.from({ length: 31 }, (_, i) =>
    cubicPointAt(fillet, (i + 1) / 32)
  );
  for (const p of samples) {
    const { u, v } = ball.localOf(p);
    if ((1 - Math.hypot(u, v)) * ball.radius > BALL_TOLERANCE) return false;
  }
  return samples.every((p) => counter(p) >= -0.01);
}
