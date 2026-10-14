import { matchCubicEndCurvatures } from "./bulb-entry-slide.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
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

function cubicSlice(points, t0, t1) {
  if (t1 <= 1e-12) return [0, 1, 2, 3].map(() => cubicPointAt(points, 0));
  const head = splitCubicAt(points, t1).first;
  return splitCubicAt(head, t0 / t1).second;
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
      // With no side apex given, the corner is where the wall leaves the ball.
      if (
        sideTheta === null
          ? previous < 0 && theta <= (3 * Math.PI) / 2 - 0.02
          : theta >= sideTheta && theta <= (3 * Math.PI) / 2 - 0.02
      )
        cut = root;
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
    lengthAt(t) {
      if (t <= from) return 0;
      if (t >= 1) return total;
      const i = Math.min(
        WALL_TABLE_STEPS - 1,
        Math.floor(((t - from) / (1 - from)) * WALL_TABLE_STEPS)
      );
      const s = (t - parameters[i]) / (parameters[i + 1] - parameters[i] || 1);
      return lengths[i] + (lengths[i + 1] - lengths[i]) * s;
    },
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

// The rolling circle's radius at the smallest easing and at full easing, in
// ball radii. Easing 0 is the plain corner.
const FILLET_MIN_RADIUS = 0.5;
const FILLET_RADIUS = 2.2;
// How far back along the outer wall from the rib the refit starts E, in ball
// radii: where the realized S put it.
const FIT_ENTRY_LEAD = 1.75;
// The wall end never climbs past this share of the wall to the next wall point.
const FILLET_WALL_SHARE = 0.75;

function cubicTangentAt(points, t) {
  const [p0, p1, p2, p3] = points;
  const mt = 1 - t;
  return unit({
    x: mt * mt * (p1.x - p0.x) + 2 * mt * t * (p2.x - p1.x) + t * t * (p3.x - p2.x),
    y: mt * mt * (p1.y - p0.y) + 2 * mt * t * (p2.y - p1.y) + t * t * (p3.y - p2.y),
  });
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
  const rib = wall[3];
  const ball = makeBulbBall({
    outer: rib,
    inner: inner[0],
    outerDirection: unit(sub(rib, wall[2])),
    radius,
    shape,
  });
  if (!ball) return null;
  // The corner: where the inner wall leaves the ball.
  const cut = innerBallCut(ball, inner, null);
  const thetaE = -Math.PI / 2;
  const thetaCut = clamp(
    unwrap(ball.thetaOf(cubicPointAt(inner, cut)), thetaE),
    thetaE + 0.2,
    (3 * Math.PI) / 2 - 0.02
  );
  const corner = ball.at(thetaCut);
  const thetaFloor = thetaE + 0.1;
  const wallTable = wallLengthTable(inner, cut);
  const wallLength = wallTable.total;

  // The rolling circle: radius r, outside the ball and on the counter side of
  // the wall, touching both. Where it touches them are the reference's A and W.
  const outerMid = cubicPointAt(wall, 0.5);
  const counterSign =
    cross(cubicTangentAt(inner, cut), sub(outerMid, corner)) > 0 ? -1 : 1;
  const counterNormal = (t) => {
    const tangent = cubicTangentAt(inner, t);
    return { x: -tangent.y * counterSign, y: tangent.x * counterSign };
  };
  const BALL_SAMPLES = 160;
  const nearestOnBall = (p) => {
    const at = (theta) => vector.distance(ball.at(theta), p);
    let best = thetaFloor;
    for (let i = 0; i <= BALL_SAMPLES; i++) {
      const theta = thetaFloor + ((thetaCut - thetaFloor) * i) / BALL_SAMPLES;
      if (at(theta) < at(best)) best = theta;
    }
    const step = (thetaCut - thetaFloor) / BALL_SAMPLES;
    let lo = Math.max(thetaFloor, best - step),
      hi = Math.min(thetaCut, best + step);
    for (let i = 0; i < 40; i++) {
      const m1 = lo + (hi - lo) / 3,
        m2 = hi - (hi - lo) / 3;
      if (at(m1) < at(m2)) hi = m2;
      else lo = m1;
    }
    const theta = (lo + hi) / 2;
    return { theta, distance: (ball.contains(p) ? -1 : 1) * at(theta) };
  };
  const tTop = wallTable.parameterAt(FILLET_WALL_SHARE * wallLength);
  const gapAt = (t, r) =>
    nearestOnBall(offset(cubicPointAt(inner, t), counterNormal(t), r)).distance - r;
  // The largest circle that still touches the wall within its allowed share:
  // a larger one would end its arc off the wall.
  const largestCircle = () => {
    let lo = 0,
      hi = FILLET_RADIUS * radius;
    if (gapAt(tTop, hi) >= 0) return hi;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (gapAt(tTop, mid) >= 0) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const rolled = (r) => {
    const centre = (t) => offset(cubicPointAt(inner, t), counterNormal(t), r);
    const gap = (t) => gapAt(t, r);
    let lo = cut,
      hi = tTop;
    if (gap(hi) < 0) lo = hi;
    else
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) < 0) lo = mid;
        else hi = mid;
      }
    return { t: lo, thetaA: nearestOnBall(centre(lo)).theta, centre: centre(lo) };
  };

  // The ideal reference: the outer wall, the ball from the rib, the rolling
  // circle's arc, the inner wall to Q. Every piece is exact. Its comb may step,
  // because it is the shape to follow, not the outline.
  const built = easing > 0;
  // Easing runs from the smallest circle to the largest that fits.
  const largest = built ? largestCircle() : 0;
  const smallest = Math.min(FILLET_MIN_RADIUS * radius, largest);
  const filletRadius = built
    ? smallest + clamp(easing, 0, 1) * (largest - smallest)
    : 0;
  const ballPieces = (from, to) => {
    const count = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 3)));
    return Array.from({ length: count }, (_, i) =>
      ballArc(
        ball,
        from + ((to - from) * i) / count,
        from + ((to - from) * (i + 1)) / count
      )
    );
  };
  let pieces, ballCount, arcCount, tW;
  if (built) {
    const circle = rolled(filletRadius);
    tW = circle.t;
    const ballPart = ballPieces(thetaE, circle.thetaA);
    const arcPart = circleArc(
      circle.centre,
      filletRadius,
      ball.at(circle.thetaA),
      cubicPointAt(inner, tW)
    );
    ballCount = ballPart.length;
    arcCount = arcPart.length;
    pieces = [wall, ...ballPart, ...arcPart, splitCubicAt(inner, tW).second];
  } else {
    tW = cut;
    const ballPart = ballPieces(thetaE, thetaCut);
    ballCount = ballPart.length;
    arcCount = 0;
    pieces = [wall, ...ballPart, splitCubicAt(inner, cut).second];
  }
  const reference = referencePath(pieces);
  // Places along the reference by its own measure, so A and W land exactly
  // on the joints between its pieces.
  const sRib = reference.ends[0];
  const sA = reference.ends[ballCount];
  const sW = reference.ends[ballCount + arcCount];

  // The refit: X and B are placed first, and the fit solves E, A, W and the
  // twelve handle lengths. Every handle keeps the reference's direction at
  // its point. Curvature matches at every join, at P with the wall before it
  // and at Q with the stroke after it, and the outline stays as near the
  // reference as that allows. At zero easing A and W are the corner: the fit
  // ends there, with no condition at it, and the inner wall leaves the corner
  // at its own angle, exact.
  //
  // X and B split the ball from the rib to its end by turn. A cubic that turns
  // a fair angle on an even stretch of curve has two near-equal handles of its
  // own, and its ends already bend alike, so the fit has little to correct.
  // They split the ball alone, so easing cannot move them, nor E and the
  // outer wall the fit solves against them. Split over the whole run instead,
  // the fillet's turn moved them with the easing, and the wall with them.
  // Neither X nor B sits exactly at the third place A would take: A pinned to
  // an extreme left the ball beyond it to a cubic that also had to carry the
  // fillet.
  const kP = bulbEndCurvature(wall);
  const wallCurvature = curvatureBeyond(inner, beyond);
  const kQ = wallCurvature ?? bulbEndCurvature(inner, true);
  const ballPlaces = placeByTurn(reference, sRib, sA, 3, radius, !preview, [0, 1]);
  // A and W start at a share of the way from their even places, A's third of
  // the ball and W's middle of the circle, to where the ball and the circle
  // end. The fit has two minima there, far apart in cost, and one start
  // does not reach the better one everywhere: the release fit runs from
  // both and keeps the cheaper. A preview frame takes the quick fit from
  // the first.
  const turnOf = reference.turnAt;
  const toward = (s0, s1, share) =>
    reference.atTurn(turnOf(s0) + (turnOf(s1) - turnOf(s0)) * share);
  const heldFrom = (share) =>
    built
      ? [
          ballPlaces[0],
          ballPlaces[1],
          toward(ballPlaces[2], sA, share),
          toward(toward(sA, sW, 0.5), sW, share),
        ]
      : [...placeByTurn(reference, sRib, sA, 2, radius, !preview, [0, 1]), sA, sA];
  const start = sRib - Math.min(FIT_ENTRY_LEAD * radius, 0.8 * sRib);
  const fitFrom = (share) =>
    fitToReference(reference, start, {
      kP,
      kQ,
      radius,
      corner: built ? null : { s: sA },
      held: heldFrom(share),
      quick: preview,
    });
  let fit = fitFrom(0);
  if (built && !preview) {
    const other = fitFrom(FIT_SECOND_START);
    if (other.cost < fit.cost) fit = other;
  }
  if (!built) {
    let rest = splitCubicAt(inner, cut).second;
    if (wallCurvature !== undefined)
      rest = arriveWithCurvature(rest, wallCurvature, radius) ?? rest;
    fit.curves[5] = rest;
  }
  const curves = fit.curves;
  const points = [
    ...curves[1],
    ...curves[2].slice(1),
    ...curves[3].slice(1),
    ...curves[4].slice(1),
    ...curves[5].slice(1),
  ].map((p, i) => (i % 3 ? { x: p.x, y: p.y, type: "cubic" } : { x: p.x, y: p.y }));
  const tangents = [];
  applyBulbEdits(points, edits, tangents, radius);
  for (const i of [0, 3, 6]) points[i].smooth = true;
  points[9].smooth = built;
  points[12].smooth = built;
  points[9].skipColinear = true;
  points[12].skipColinear = true;
  const outerWall = curves[0].map((p, i) =>
    i % 3 ? { x: p.x, y: p.y, type: "cubic" } : { ...wall[i], x: p.x, y: p.y }
  );
  outerWall[3] = points[0];
  return {
    points,
    error: fit.curvatureError * radius,
    status: fit.curvatureError * radius < 1e-5 ? "matched" : "bounded",
    wall: outerWall,
    keptInner: [points[15]],
    ball,
    tangents,
    fillet: { radius: filletRadius },
    entryParameter: 1,
    orthogonalEntry: false,
    sideOnApex: false,
    preview,
  };
}

// `count` places strictly between `from` and `to` that split the reference's
// turn evenly. With `extremes`, places move onto the reference's exact
// horizontal and vertical extremes wherever every cubic beside them keeps its
// least turn: enough for handles of FIT_MIN_HANDLE_UNITS at the ball's radius,
// or FIT_PIN_SHARE of an even share where the run turns too little for that.
// Most pins win, then the pins nearest the even split. A place with no pin
// splits what its neighbours leave, evenly by turn.
function placeByTurn(reference, from, to, count, radius, extremes, pinnable = null) {
  const t0 = reference.turnAt(from),
    t1 = reference.turnAt(to);
  const even = (i) => t0 + ((t1 - t0) * (i + 1)) / (count + 1);
  const required = Math.min(
    4 * Math.atan((3 * FIT_MIN_HANDLE_UNITS) / (4 * radius)),
    (FIT_PIN_SHARE * (t1 - t0)) / (count + 1)
  );
  const fill = (pins) => {
    const out = [...pins];
    let last = -1;
    for (let i = 0; i <= count; i++) {
      if (i < count && out[i] === null) continue;
      const a = last < 0 ? t0 : out[last],
        b = i < count ? out[i] : t1;
      for (let j = last + 1; j < i; j++)
        out[j] = a + ((b - a) * (j - last)) / (i - last);
      last = i;
    }
    return out;
  };
  let best = { pins: Array(count).fill(null), count: 0, cost: 0 };
  if (extremes) {
    const found = reference.extremes(from, to).map((s) => reference.turnAt(s));
    // Every order-keeping assignment of extremes to places.
    const visit = (pins, slot, next) => {
      const placed = fill(pins);
      const spans = [t0, ...placed, t1].slice(1).map((t, i) => t - [t0, ...placed][i]);
      const used = pins.filter((t) => t !== null).length;
      if (used && Math.min(...spans) >= required) {
        const cost = pins.reduce(
          (sum, t, i) => sum + (t === null ? 0 : Math.abs(t - even(i))),
          0
        );
        if (used > best.count || (used === best.count && cost < best.cost))
          best = { pins: [...pins], count: used, cost };
      }
      for (let i = slot; i < count; i++)
        for (let k = next; k < found.length; k++) {
          if (pinnable && !pinnable.includes(i)) continue;
          pins[i] = found[k];
          visit(pins, i + 1, k + 1);
          pins[i] = null;
        }
    };
    visit(Array(count).fill(null), 0, 0);
  }
  return fill(best.pins).map((t) => reference.atTurn(t));
}

// Cubics end to end, read by length: the place and the direction at any
// distance along them. Linear between table rows, so both move continuously.
function referencePath(cubics) {
  const pieces = [];
  // Where each given cubic ends along the path, by the path's own measure.
  const ends = [];
  let total = 0;
  for (const curve of cubics) {
    const table = wallLengthTable(curve, 0);
    if (table.total > 1e-9) {
      pieces.push({ curve, table, from: total });
      total += table.total;
    }
    ends.push(total);
  }
  const locate = (s, after) => {
    s = clamp(s, 0, total);
    let k = pieces.length - 1;
    for (let i = 0; i < pieces.length; i++) {
      const end = pieces[i].from + pieces[i].table.total;
      if (after ? s < end : s <= end) {
        k = i;
        break;
      }
    }
    const piece = pieces[k];
    return { curve: piece.curve, t: piece.table.parameterAt(s - piece.from) };
  };
  // The turn of the reference from its start, accumulated as it runs, so it
  // only rises. Tabled once on first use; linear between rows.
  const TURN_STEPS = 1024;
  let turns = null;
  const turnTable = () => {
    if (turns) return turns;
    turns = [0];
    let previous = cubicTangentAtPath(0);
    for (let i = 1; i <= TURN_STEPS; i++) {
      const tangent = cubicTangentAtPath((total * i) / TURN_STEPS);
      const dot = previous.x * tangent.x + previous.y * tangent.y;
      turns.push(turns[i - 1] + Math.abs(Math.atan2(cross(previous, tangent), dot)));
      previous = tangent;
    }
    return turns;
  };
  function cubicTangentAtPath(s) {
    const { curve, t } = locate(s);
    return cubicTangentAt(curve, t);
  }
  return {
    total,
    ends,
    turnAt: (s) => {
      const table = turnTable();
      const x = (clamp(s, 0, total) / (total || 1)) * TURN_STEPS;
      const i = Math.min(TURN_STEPS - 1, Math.floor(x));
      return table[i] + (table[i + 1] - table[i]) * (x - i);
    },
    // The place at a given turn; the first, where the turn stands still.
    atTurn: (turn) => {
      const table = turnTable();
      if (turn <= 0) return 0;
      if (turn >= table[TURN_STEPS]) return total;
      let lo = 0,
        hi = TURN_STEPS;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (table[mid] < turn) lo = mid;
        else hi = mid;
      }
      const share = (turn - table[lo]) / (table[hi] - table[lo] || 1);
      return ((lo + share) / TURN_STEPS) * total;
    },
    point: (s) => {
      const { curve, t } = locate(s);
      return cubicPointAt(curve, t);
    },
    // Where the reference turns a corner, the direction arriving and the
    // direction leaving differ.
    tangent: (s, after = false) => {
      const { curve, t } = locate(s, after);
      return cubicTangentAt(curve, t);
    },
    // Places strictly between two places where the reference runs exactly
    // horizontal or vertical, in order.
    extremes: (from, to) => {
      const found = [];
      for (const { curve, table, from: start } of pieces) {
        for (const axis of ["x", "y"]) {
          const [p0, p1, p2, p3] = curve.map((p) => p[axis]);
          // The derivative's quadratic, a t^2 + b t + c.
          const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3),
            b = 6 * (p0 - 2 * p1 + p2),
            c = 3 * (p1 - p0);
          const roots =
            Math.abs(a) < 1e-12
              ? Math.abs(b) < 1e-12
                ? []
                : [-c / b]
              : (() => {
                  const d = b * b - 4 * a * c;
                  if (d < 0) return [];
                  const r = Math.sqrt(d);
                  return [(-b - r) / (2 * a), (-b + r) / (2 * a)];
                })();
          for (const t of roots) {
            if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
            const place = start + table.lengthAt(t);
            if (place > from && place < to) found.push(place);
          }
        }
      }
      return found.sort((p, q) => p - q);
    },
    // The handle lengths of the reference itself between two places, where
    // both lie on one piece; null where they do not.
    handles: (s0, s1) => {
      const a = locate(s0, true),
        b = locate(s1);
      if (a.curve !== b.curve || !(b.t > a.t)) return null;
      const piece = cubicSlice(a.curve, a.t, b.t);
      return [vector.distance(piece[0], piece[1]), vector.distance(piece[2], piece[3])];
    },
  };
}

// A circle's arc from a to b, the short way round, as cubics of at most 60
// degrees.
function circleArc(centre, r, a, b) {
  const from = Math.atan2(a.y - centre.y, a.x - centre.x);
  let sweep = Math.atan2(b.y - centre.y, b.x - centre.x) - from;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 3)));
  const at = (angle) => ({
    x: centre.x + r * Math.cos(angle),
    y: centre.y + r * Math.sin(angle),
  });
  return Array.from({ length: count }, (_, i) => {
    const a0 = from + (sweep * i) / count,
      a1 = from + (sweep * (i + 1)) / count;
    const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
    const p0 = at(a0),
      p3 = at(a1);
    return [
      p0,
      { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) },
      { x: p3.x + k * Math.sin(a1), y: p3.y - k * Math.cos(a1) },
      p3,
    ];
  });
}

// The refit of six cubics, P-E-X-B-A-W-Q, to a reference. The unknowns are
// the places of E, A and W along the reference and the twelve handle lengths,
// in logarithms; X and B are held where the caller put them, and A and W
// start there. Residuals: each curve's distance from the reference, across
// it, at seven fixed parameters, and each curvature condition, weighted to
// hold. Levenberg-Marquardt from the given start with a fixed step budget.
// Returns the final cost, so a caller with two starts can keep the cheaper. `corner` holds A and W together
// on the reference's corner: the fit then stops at A, with no condition there,
// and the caller supplies the wall after it.
const FIT_SAMPLES = [1, 2, 3, 4, 5, 6, 7].map((i) => i / 8);
// The curvature conditions come in by steps, the shape alone first, so the
// fit stays by the reference while the joins are made smooth. The same
// sequence every time.
const FIT_CURVATURE_WEIGHTS = [0, 1, 10, 100, 2000];
const FIT_STEPS = 40;
const FIT_MIN_HANDLE = 0.01;
// The shortest ball handle, in units, a pin may leave beside it: rounding turns
// a handle this long by under two degrees.
const FIT_MIN_HANDLE_UNITS = 20;
// Where the whole ball turns too little for that, a pin may still shorten a
// neighbouring cubic to this share of an equal split.
const FIT_PIN_SHARE = 0.75;
const FIT_LENGTH_PULL = 2;
// The second start of the release fit, as a share of the way from A's and W's
// even places to the ends of the ball and the circle: the ends themselves.
const FIT_SECOND_START = 1;
// A step that improves the fit by less than this share has settled it.
const FIT_SETTLED = 1e-6;
function fitToReference(
  reference,
  start,
  { kP, kQ, radius, corner, held, quick = false }
) {
  const gap = 0.1 * radius;
  const total = reference.total;
  const fixedCorner = corner !== null;
  // E is solved, and A and W too unless they are the corner; X and B are held.
  const placeCount = fixedCorner ? 1 : 3;
  const places = (z) =>
    fixedCorner
      ? [0, z[0], ...held, total]
      : [0, z[0], held[0], held[1], z[1], z[2], total];
  const fitted = (k) => !(fixedCorner && k >= 4);
  // The ends of curve k: places, points and directions along the reference.
  const ends = (s, k) => ({
    a: reference.point(s[k]),
    b: reference.point(s[k + 1]),
    ta: reference.tangent(s[k], true),
    tb: reference.tangent(s[k + 1]),
  });
  const curveAt = (s, k, h0, h1) => {
    const { a, b, ta, tb } = ends(s, k);
    if (!fitted(k)) return [a, { ...a }, { ...b }, b];
    const chord = Math.max(vector.distance(a, b), 1e-6);
    return [
      a,
      offset(a, ta, Math.min(h0, 3 * chord)),
      offset(b, tb, -Math.min(h1, 3 * chord)),
      b,
    ];
  };
  // The reference's own points under curve k, at the sample fractions.
  const targets = (s, k) =>
    FIT_SAMPLES.map((u) => reference.point(s[k] + (s[k + 1] - s[k]) * u));
  const floorOf = (s, k) => FIT_MIN_HANDLE * Math.max(s[k + 1] - s[k], 1e-3);

  // The quick fit: the places as given, and each curve's two handle lengths
  // by plain least squares against the reference. A curve is linear in its two
  // lengths, so this is one two-by-two solve per curve. No curvature
  // condition: a preview frame shows this, and the refit starts from it.
  const quickLengths = (s) =>
    Array.from({ length: 6 }, (_, k) => {
      if (!fitted(k)) return [1, 1];
      const { a, b, ta, tb } = ends(s, k);
      const r = targets(s, k);
      let m00 = 0,
        m01 = 0,
        m11 = 0,
        v0 = 0,
        v1 = 0;
      FIT_SAMPLES.forEach((t, j) => {
        const mt = 1 - t;
        const b0 = mt * mt * mt,
          b1 = 3 * mt * mt * t,
          b2 = 3 * mt * t * t,
          b3 = t * t * t;
        const base = {
          x: (b0 + b1) * a.x + (b2 + b3) * b.x - r[j].x,
          y: (b0 + b1) * a.y + (b2 + b3) * b.y - r[j].y,
        };
        const p = { x: b1 * ta.x, y: b1 * ta.y },
          q = { x: -b2 * tb.x, y: -b2 * tb.y };
        m00 += p.x * p.x + p.y * p.y;
        m01 += p.x * q.x + p.y * q.y;
        m11 += q.x * q.x + q.y * q.y;
        v0 -= p.x * base.x + p.y * base.y;
        v1 -= q.x * base.x + q.y * base.y;
      });
      const det = m00 * m11 - m01 * m01;
      const span = s[k + 1] - s[k];
      const fallback = span / 3;
      const h0 = det > 1e-12 ? (v0 * m11 - v1 * m01) / det : fallback,
        h1 = det > 1e-12 ? (m00 * v1 - m01 * v0) / det : fallback;
      const floor = floorOf(s, k);
      return [Math.max(h0, floor), Math.max(h1, floor)];
    });

  const free = fixedCorner ? [start] : [start, held[2], held[3]];
  if (quick) {
    const s = places(free);
    const lengths = quickLengths(s);
    const curves = lengths.map(([h0, h1], k) => curveAt(s, k, h0, h1));
    return { curves, places: s, curvatureError: 0 };
  }

  const curvatureRows = (curves) => {
    const rows = [bulbEndCurvature(curves[0]) - kP];
    for (let k = 0; k < (fixedCorner ? 3 : 5); k++)
      rows.push(bulbEndCurvature(curves[k], true) - bulbEndCurvature(curves[k + 1]));
    if (!fixedCorner) rows.push(bulbEndCurvature(curves[5], true) - kQ);
    return rows;
  };
  // Each curve's shape rows: both curves at the same fractions of their own
  // length, compared in full. Measured across the reference only, a point
  // could slide along it unseen.
  const shapeRows = (curve, s, k) => {
    if (!fitted(k)) return [];
    const at = atLengthFractions(curve, FIT_SAMPLES);
    const r = targets(s, k);
    return at.flatMap((p, j) => [p.x - r[j].x, p.y - r[j].y]);
  };
  let weight = 0,
    anchor = null;
  // The state of one point in the search: its places, curves, and the rows
  // of every curve, kept apart so that a change to one unknown recomputes only
  // the curves it touches.
  const evaluate = (z, previous = null, touched = null) => {
    const s = places(z);
    const curves = [],
      blocks = [];
    for (let k = 0; k < 6; k++) {
      if (previous && !touched.includes(k)) {
        curves.push(previous.curves[k]);
        blocks.push(previous.blocks[k]);
        continue;
      }
      const curve = curveAt(
        s,
        k,
        Math.exp(z[placeCount + 2 * k]),
        Math.exp(z[placeCount + 2 * k + 1])
      );
      curves.push(curve);
      blocks.push(shapeRows(curve, s, k));
    }
    const rows = blocks.flat();
    for (const row of curvatureRows(curves)) rows.push(row * radius * weight);
    // A gentle pull of every handle length toward its start, in logarithms:
    // it gives the fit one answer where the shape alone leaves a length loose.
    for (let i = placeCount; i < z.length; i++)
      rows.push(FIT_LENGTH_PULL * (z[i] - anchor[i]));
    return { curves, blocks, rows };
  };
  // Which curves an unknown moves: a handle length its own curve, a place the
  // two curves either side of it.
  const touchedBy = (j) =>
    j >= placeCount
      ? [Math.floor((j - placeCount) / 2)]
      : [
          [0, 1],
          [3, 4],
          [4, 5],
        ][j];
  // The places stay in order, a tenth of a radius apart; no handle falls
  // under a hundredth of its span, where a collapsed handle meets any
  // curvature with any shape.
  const project = (z) => {
    const out = [...z];
    out[0] = clamp(out[0], gap, held[0] - gap);
    if (!fixedCorner) {
      out[1] = clamp(out[1], held[1] + gap, total - 2 * gap);
      out[2] = clamp(out[2], out[1] + gap, total - gap);
    }
    const s = places(out);
    for (let i = placeCount; i < out.length; i++) {
      const k = Math.floor((i - placeCount) / 2);
      out[i] = clamp(out[i], Math.log(floorOf(s, k)), Math.log(4 * total));
    }
    return out;
  };
  // Start from the quick fit.
  let z = project([...free, ...quickLengths(places(free)).flat().map(Math.log)]);
  anchor = [...z];
  const cost = (rows) => rows.reduce((a, v) => a + v * v, 0);
  for (const w of FIT_CURVATURE_WEIGHTS) {
    weight = w;
    let state = evaluate(z),
      current = cost(state.rows),
      lambda = 1e-2;
    for (let step = 0; step < FIT_STEPS; step++) {
      const r = state.rows;
      const J = z.map((_, j) => {
        const h = j < placeCount ? 1e-3 : 1e-5;
        const zj = [...z];
        zj[j] += h;
        const rj = evaluate(zj, state, touchedBy(j)).rows;
        return rj.map((v, i) => (v - r[i]) / h);
      });
      const n = z.length;
      const A = Array.from({ length: n }, (_, a) =>
        Array.from({ length: n }, (_, b) =>
          b < a ? 0 : J[a].reduce((sum, v, i) => sum + v * J[b][i], 0)
        )
      );
      for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
      const g = Array.from({ length: n }, (_, a) =>
        J[a].reduce((sum, v, i) => sum + v * r[i], 0)
      );
      let improved = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const M = A.map((row, a) =>
          row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v))
        );
        const delta = solveLinearSystem(
          M,
          g.map((v) => -v)
        );
        if (delta) {
          const candidate = project(z.map((v, i) => v + delta[i]));
          const next = evaluate(candidate);
          const c = cost(next.rows);
          if (c < current) {
            improved = current - c > FIT_SETTLED * current;
            z = candidate;
            state = next;
            current = c;
            lambda = Math.max(lambda / 3, 1e-7);
            break;
          }
        }
        lambda *= 4;
      }
      if (!improved) break;
    }
  }
  const finalState = evaluate(z);
  const curves = finalState.curves;
  return {
    cost: cost(finalState.rows),
    curves,
    places: places(z),
    curvatureError: Math.max(...curvatureRows(curves).map(Math.abs)),
  };
}

// Points of a cubic at fractions of its length, from a short length table.
function atLengthFractions(curve, fractions) {
  const STEPS = 24;
  const lengths = [0];
  let previous = curve[0];
  for (let i = 1; i <= STEPS; i++) {
    const p = cubicPointAt(curve, i / STEPS);
    lengths.push(lengths[i - 1] + vector.distance(previous, p));
    previous = p;
  }
  const total = lengths[STEPS];
  return fractions.map((u) => {
    const target = u * total;
    let i = 1;
    while (i < STEPS && lengths[i] < target) i++;
    const share = (target - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return cubicPointAt(curve, (i - 1 + share) / STEPS);
  });
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-18) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
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
