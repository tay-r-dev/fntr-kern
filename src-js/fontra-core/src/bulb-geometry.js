import {
  harmonizeCubicRun,
  matchCubicEndCurvatures,
  slideBulbEntryForCurvature,
  solveCubicEndCurvatures,
} from "./bulb-entry-slide.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
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

// Length along a cubic from `from` to its end, tabled once: the search for the
// fillet's limit asks for a parameter at a length dozens of times. Linear
// between rows, so it moves continuously.
const WALL_TABLE_STEPS = 256;
function wallLengthTable(points, from) {
  const parameters = [from],
    lengths = [0];
  let p = cubicPointAt(points, from);
  for (let i = 1; i <= WALL_TABLE_STEPS; i++) {
    const t = from + ((1 - from) * i) / WALL_TABLE_STEPS,
      q = cubicPointAt(points, t);
    parameters.push(t);
    lengths.push(lengths[i - 1] + vector.distance(p, q));
    p = q;
  }
  const total = lengths[WALL_TABLE_STEPS];
  return {
    total,
    parameterAt(distance) {
      if (distance <= 0) return from;
      if (distance >= total) return 1;
      let lo = 0,
        hi = WALL_TABLE_STEPS;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] < distance) lo = mid;
        else hi = mid;
      }
      const s = (distance - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
      return parameters[lo] + (parameters[hi] - parameters[lo]) * s;
    },
  };
}

// E is the first vertical tangent along the outer run after P: on the wall if
// the wall has one, otherwise on the ball's apex. The wall and the ball are the
// reference. Of P -> E and E -> B, one is an exact split of it; the other holds
// the rib and replaces the reference pieces it spans, refit as a V-slide refits
// (`spans` names which). Its handle lengths are then solved for curvature at
// both ends once the designer's edits are in (buildBulb).
export function joinBulbEntry(wall, firstArc) {
  const run = { points: [...wall, ...firstArc.slice(1)], isClosed: false };
  const onWall = bulbEntry(wall);
  if (onWall.orthogonal && onWall.t < 1 - 1e-10) {
    const candidate = makeSlideCandidate(run, 3, "previous", onWall.t).points;
    return {
      ...onWall,
      wall: candidate.slice(0, 4),
      firstArc: candidate.slice(3, 7),
      spans: "entry",
    };
  }
  // E goes on the ball's apex only where some pair of P -> E lengths meets the
  // wall's curvature at P and the ball's at E. Where none does, no amount of
  // solving fixes it there, and E stays on the wall.
  const onBall = bulbEntry(firstArc);
  const candidate =
    onBall.orthogonal &&
    onBall.t > 1e-4 &&
    onBall.t < 1 - 1e-4 &&
    makeSlideCandidate(run, 3, "next", onBall.t).points;
  if (
    candidate &&
    solveCubicEndCurvatures(
      candidate.slice(0, 4),
      bulbEndCurvature(wall),
      bulbEndCurvature(candidate.slice(3, 7))
    ).length
  ) {
    return {
      wall: candidate.slice(0, 4),
      firstArc: candidate.slice(3, 7),
      t: 1,
      orthogonal: true,
      ballParameter: onBall.t,
      spans: "wall",
    };
  }
  return { ...onWall, firstArc, spans: null };
}

// How far back along the ball the fillet may reach from the corner, in radii.
// At 0.75 the ball end stopped while the wall end climbed on, and the fillet's
// ball handle shrank to nothing before full easing: past that point no curve
// meets both curvatures. At 1.5 every easing on the skeletron-test glyphs
// meets both, with handles near half the chord.
const FILLET_BALL_STOP = 1.5;
// The arc from the side apex C to the fillet keeps at least this much of the
// ball, in radii. A stub shorter than that has handles of a few units, and
// whole-unit rounding turns its curvature over: a step of 32 times the ball's
// own curvature at C where the corner stood one radius from it.
const FILLET_MIN_RETURN = 0.25;
// How far up the wall the fillet's wall end climbs at full easing, in radii,
// and as a share of the wall from the corner to the next wall point. A fixed
// length, never a searched limit: a limit found by testing positions moves
// whenever a test changes its answer, and the fillet jumped with it.
const FILLET_WALL_REACH = 2;
const FILLET_WALL_SHARE = 0.75;

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
// through both ends. Its two handle lengths are the unknowns, solved by one
// damped Gauss-Newton walk in their logarithms from a fixed start: both handles
// most of the way to where the two tangents cross, the fillet's own shape.
// Where the two curvatures can be met the walk lands on them exactly; where
// they cannot, it lands on the nearest pair, which continues smoothly from the
// last exact one. No answer is tested and refused, so nothing can jump.
// Both lengths stay between a thousandth of the chord and twice the chord. The
// tangent crossing is no bound here: the fillet leaves the ball bending the
// ball's way and turns the other way to reach the wall, and that inflection
// needs the wall handle past the crossing.
function solveFillet(A, tA, kA, W, tW, kW) {
  const d = sub(W, A),
    chord = Math.hypot(d.x, d.y);
  if (!(chord > 1e-6)) return null;
  const X = cross(tA, d),
    Y = cross(tA, tW),
    Z = cross(d, tW);
  const max = 2 * chord,
    floor = 1e-3 * chord;
  const bound = (u) => clamp(u, Math.log(floor), Math.log(max));
  const seed = (reach) => Math.log(0.9 * (reach > 0 ? Math.min(reach, max) : max / 6));
  let u = bound(seed(Math.abs(Y) > 1e-12 ? Z / Y : Infinity)),
    v = bound(seed(Math.abs(Y) > 1e-12 ? X / Y : Infinity));
  // Residuals in curvature times the chord, so the walk reads the same at
  // every size.
  const residual = (u, v) => {
    const a = Math.exp(u),
      c = Math.exp(v);
    const k0 = ((2 / 3) * (X - c * Y)) / (a * a),
      k1 = ((2 / 3) * (Z - a * Y)) / (c * c);
    return { a, c, k0, k1, r: [(k0 - kA) * chord, (k1 - kW) * chord] };
  };
  let lambda = 1e-3;
  let state = residual(u, v);
  for (let i = 0; i < 100; i++) {
    const { a, c, k0, k1, r } = state;
    const cost = r[0] * r[0] + r[1] * r[1];
    if (cost < 1e-24) break;
    // Derivatives in the log lengths.
    const J = [
      [-2 * k0 * chord, ((-(2 / 3) * Y * c) / (a * a)) * chord],
      [((-(2 / 3) * Y * a) / (c * c)) * chord, -2 * k1 * chord],
    ];
    const g = [J[0][0] * r[0] + J[1][0] * r[1], J[0][1] * r[0] + J[1][1] * r[1]];
    const H = [
      [J[0][0] ** 2 + J[1][0] ** 2, J[0][0] * J[0][1] + J[1][0] * J[1][1]],
      [0, J[0][1] ** 2 + J[1][1] ** 2],
    ];
    H[1][0] = H[0][1];
    let moved = false;
    for (let attempt = 0; attempt < 30 && !moved; attempt++) {
      const h00 = H[0][0] * (1 + lambda) + 1e-12,
        h11 = H[1][1] * (1 + lambda) + 1e-12,
        det = h00 * h11 - H[0][1] * H[1][0];
      let du = (-g[0] * h11 + g[1] * H[0][1]) / det,
        dv = (-g[1] * h00 + g[0] * H[1][0]) / det;
      const largest = Math.max(Math.abs(du), Math.abs(dv));
      if (largest > Math.log(1.4)) {
        du *= Math.log(1.4) / largest;
        dv *= Math.log(1.4) / largest;
      }
      const next = residual(bound(u + du), bound(v + dv));
      if (next.r[0] ** 2 + next.r[1] ** 2 < cost) {
        u = Math.log(next.a);
        v = Math.log(next.c);
        state = next;
        lambda = Math.max(lambda / 3, 1e-9);
        moved = true;
      } else lambda *= 4;
    }
    if (!moved) break;
  }
  return [
    { ...A },
    { ...offset(A, tA, state.a), type: "cubic" },
    { ...offset(W, tW, -state.c), type: "cubic" },
    { ...W },
  ];
}
const cross = (a, b) => a.x * b.y - a.y * b.x;

// The bulb: E, B and C on the ball, A where the ball gives way to the easing
// fillet, W where the fillet meets the inner wall, then Q, the wall's next
// existing point. Sixteen points, at every easing: at zero easing A, W and the
// fillet's handles all lie on the corner where the ball meets the wall.
//
// Easing fills that corner the way solder fills the corner between a part and
// its pad. It adds material and never removes any: the ball stays whole under
// the fillet, and the stroke stays whole beside it. The fillet's ball end goes
// back from the corner as far as its wall end climbs, up to 1.5 radii,
// then stops, and C slides down the ball ahead of it. Its wall end climbs on.
// Full easing puts the wall end two radii up the wall, or three quarters of the
// way to the next wall point where the wall is shorter.
//
// `preview` says an edit is in progress. The geometry is the same; the caller
// hides E and its handles until release, because the entry fit can move E far
// along the wall in one step and that jump is not to be seen under the cursor.
// A drag regenerates every terminal on every frame, and most of them have not
// changed. The bulb depends on nothing but its inputs, so the last few are
// kept by their coordinates. Callers stamp and edit the returned points, so
// every hit hands back fresh copies.
const BULB_CACHE_SIZE = 16;
const bulbCache = new Map();
export function buildBulb(options) {
  const xy = (points) => points?.map((p) => [p.x, p.y, p.type ?? 0]);
  const key = JSON.stringify([
    xy(options.wall),
    xy(options.inner),
    xy(options.beyond),
    options.radius,
    options.shape,
    options.easing,
    options.edits ?? null,
    options.preview ?? false,
  ]);
  let result = bulbCache.get(key);
  if (result === undefined) {
    result = solveBulb(options);
    if (bulbCache.size >= BULB_CACHE_SIZE)
      bulbCache.delete(bulbCache.keys().next().value);
  } else bulbCache.delete(key);
  bulbCache.set(key, result);
  if (!result) return null;
  const copy = (points) => points.map((p) => ({ ...p }));
  return {
    ...result,
    points: copy(result.points),
    wall: copy(result.wall),
    keptInner: copy(result.keptInner),
    tangents: result.tangents.map((t) => ({ ...t })),
  };
}

function solveBulb({
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
  const cut = innerBallCut(ball, inner, side.theta);
  const cutPoint = cubicPointAt(inner, cut);
  const thetaLowest = side.theta + 0.02;
  const thetaCut = clamp(
    unwrap(ball.thetaOf(cutPoint), -Math.PI / 2),
    thetaLowest,
    (3 * Math.PI) / 2 - 0.02
  );
  const corner = ball.at(thetaCut);
  // A may go back past C. C then slides down the ball ahead of it, keeping the
  // return arc, and B -> C keeps as much again: the ball is drawn exactly
  // wherever C stands, only C's handles leave the axis.
  const thetaFloor = bottom.theta + 0.02;
  const ballStop = Math.min(
    FILLET_BALL_STOP * radius,
    Math.max(
      0,
      ballArcLength(ball, bottom.theta, thetaCut) - 2 * FILLET_MIN_RETURN * radius
    )
  );
  const wallTable = wallLengthTable(inner, cut);
  const wallLength = wallTable.total;

  // E, B and C with the designer's edits, and the arc from C to A.
  const tangents = [];
  const body = (thetaA, thetaC = side.theta) => {
    const bodyArc = ballArc(ball, bottom.theta, thetaC);
    const returnArc = ballArc(ball, thetaC, thetaA);
    const points = [...entry.firstArc, ...bodyArc.slice(1), ...returnArc.slice(1)].map(
      (p) => ({ ...p })
    );
    for (const [i, axis] of [[3, "y"], ...(thetaC === side.theta ? [[6, "x"]] : [])]) {
      points[i - 1][axis] = points[i][axis];
      points[i + 1][axis] = points[i][axis];
    }
    tangents.length = 0;
    applyBulbEdits(points, edits, tangents, radius);
    return points;
  };

  const thetaBack = ballThetaBackTable(ball, thetaFloor, thetaCut);
  const filletAt = (travel) => {
    const back = Math.min(travel, ballStop);
    const thetaA = thetaBack(back);
    const thetaC = Math.min(side.theta, thetaBack(back + FILLET_MIN_RETURN * radius));
    const points = body(thetaA, thetaC);
    const A = points[9];
    const tA = unit(sub(A, points[8]));
    const kA = bulbEndCurvature(points.slice(6, 10), true);
    const t = wallTable.parameterAt(travel);
    const rest = splitCubicAt(inner, t).second.map((p, i) => ({ ...inner[i], ...p }));
    const W = rest[0];
    const fillet = solveFillet(
      A,
      tA,
      kA,
      W,
      cubicTangentAt(inner, t),
      cubicCurvatureAt(inner, t)
    );
    return fillet ? { points, fillet, rest, sideOnApex: thetaC === side.theta } : null;
  };

  const reach = Math.min(FILLET_WALL_REACH * radius, FILLET_WALL_SHARE * wallLength);
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

  // E with no vertical tangent to stand on, on the wall or on the ball, is
  // V-slid along the wall until the comb at E is even, as the editor's V-slide
  // does on a realized contour.
  if (entry.spans === null) {
    const entrySlide = slideBulbEntryForCurvature({
      wall: entry.wall,
      points,
      sourceWall: wall,
      sourceArc: first,
      entryParameter: entry.t,
    });
    if (entrySlide) {
      points = entrySlide.points;
      entry.wall = entrySlide.wall;
      entry.t = entrySlide.parameter;
      tangents[0] = unit(sub(points[1], points[0]));
    }
  }
  // The outer run is made G2 at every join, from the exact wall to the fillet,
  // by handle lengths alone: every on-curve stays on the reference and every
  // handle keeps its direction. The change is the nearest one, spread over
  // the run. Where E is on the ball, P -> E holds the rib and joins the run,
  // and P keeps the curvature the wall has there. Where the run does not
  // settle, the refit stands and the step is reported.
  {
    const ownsWall = entry.spans === "wall";
    const run = [
      ...(ownsWall ? [entry.wall] : []),
      points.slice(0, 4),
      points.slice(3, 7),
      points.slice(6, 10),
    ];
    const solved = harmonizeCubicRun(run, {
      start: ownsWall ? bulbEndCurvature(wall) : bulbEndCurvature(entry.wall, true),
      // At zero easing A is a corner, but the ball still arrives there with
      // its own curvature. Left free, the solve flattens the whole ball.
      end: built
        ? bulbEndCurvature(points.slice(9, 13))
        : bulbEndCurvature(points.slice(6, 10), true),
      radius,
    });
    if (solved) {
      if (ownsWall) entry.wall = solved.shift();
      points = [
        ...solved[0],
        ...solved[1].slice(1),
        ...solved[2].slice(1),
        ...points.slice(10),
      ];
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
    sideOnApex: built?.sideOnApex ?? true,
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
