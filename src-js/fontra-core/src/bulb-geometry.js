import { matchCubicEndCurvatures } from "./bulb-entry-slide.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
import { computeTunniHandleLengths } from "./tunni-calculations.js";
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

// How far back along the outer wall from the rib the refit starts E, in ball
// radii: where the realized S put it.
const FIT_ENTRY_LEAD = 1.75;
// The easing curvature a bulb gets when it stores none: the tension skeleton
// corner rounding starts from.
export const DEFAULT_CAP_BALL_EASE_CURVATURE = 0.55;

function cubicTangentAt(points, t) {
  const [p0, p1, p2, p3] = points;
  const mt = 1 - t;
  return unit({
    x: mt * mt * (p1.x - p0.x) + 2 * mt * t * (p2.x - p1.x) + t * t * (p3.x - p2.x),
    y: mt * mt * (p1.y - p0.y) + 2 * mt * t * (p2.y - p1.y) + t * t * (p3.y - p2.y),
  });
}

const cross = (a, b) => a.x * b.y - a.y * b.x;

// The bulb: E on the outer wall, X, B and A the ball's three apexes, N where
// the easing leaves the ball, W where it meets the inner wall, then Q, the
// wall's next existing point. Nineteen points, at every easing.
//
// Easing rounds the corner where the inner wall leaves the ball, the way
// skeleton corner rounding does: N goes back along the ball toward A and W up
// the inner wall toward Q, each by the easing's share of its own arm, and the
// arc between them takes its handles from the easing curvature, 0 a straight
// chamfer and 1 both handles on the tangent crossing. The two arms differ, so
// the rounding is a fillet whose depth the curvature sets. At zero easing N is
// the corner and W stands halfway up the inner wall; at full easing N lands on
// A and W on Q.
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
    options.easeCurvature ?? null,
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
  easeCurvature = DEFAULT_CAP_BALL_EASE_CURVATURE,
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
  const innerRest = splitCubicAt(inner, cut).second;

  // The reference: the outer wall, the ball from the rib to the corner, the
  // inner wall from the corner to Q. Every piece is exact.
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
  const ballPart = ballPieces(thetaE, thetaCut);
  const reference = referencePath([wall, ...ballPart, innerRest]);
  const sRib = reference.ends[0];
  const sCorner = reference.ends[ballPart.length];
  // X, B and A are the bulb's three apexes, on its extremes, with the handles
  // square to the glyph's axes. Every point has one role in every master, so a
  // blend between masters moves each point along its own part of the bulb
  // instead of rotating it from one part to another.
  const [sX, sB, sA] = apexPlaces(reference, sRib, sCorner, 3);

  // The rounding. N goes back along the ball from the corner toward A, W up
  // the inner wall toward Q, each by the easing's share of its own arm.
  const share = clamp(easing, 0, 1);
  const built = share > 0;
  const sN = sCorner - share * (sCorner - sA);
  const wallTable = wallLengthTable(innerRest, 0);
  const tW = wallTable.parameterAt((built ? share : 0.5) * wallTable.total);
  const pointN = reference.point(sN);
  const pointW = cubicPointAt(innerRest, tW);
  let rounding;
  if (built) {
    const along = reference.tangent(sN);
    const back = vector.mulVectorScalar(cubicTangentAt(innerRest, tW), -1);
    const { startLen, endLen } =
      vector.distance(pointN, pointW) > 1e-3
        ? computeTunniHandleLengths(
            pointN,
            along,
            pointW,
            back,
            clamp(easeCurvature, 0, 1)
          )
        : { startLen: 0, endLen: 0 };
    rounding = [
      pointN,
      offset(pointN, along, startLen),
      offset(pointW, back, endLen),
      pointW,
    ];
  } else rounding = cubicSlice(innerRest, 0, tW);
  let rest = cubicSlice(innerRest, tW, 1);
  const wallCurvature = curvatureBeyond(inner, beyond);
  if (wallCurvature !== undefined)
    rest = arriveWithCurvature(rest, wallCurvature, radius) ?? rest;

  // The refit of P to N: E slides on the outer wall and the fit solves it and
  // the ten handle lengths, with X, B, A and N held. Every handle keeps the
  // reference's direction at its point. Curvature matches at P with the wall
  // before it and at E, X, B and A; at N the fit ends on the rounding's own
  // tangent, with no condition on curvature, which is the rounding's to set.
  const fit = fitToReference(reference, {
    // E as far back on the wall as the realized S put it.
    start: sRib - Math.min(FIT_ENTRY_LEAD * radius, 0.8 * sRib),
    kP: bulbEndCurvature(wall),
    radius,
    held: [sX, sB, sA, sN],
    // A preview frame takes the quick fit; the refit runs on release.
    quick: preview,
  });
  const curves = [...fit.curves, rounding, rest];
  const points = [
    ...curves[1],
    ...curves.slice(2).flatMap((curve) => curve.slice(1)),
  ].map((p, i) => (i % 3 ? { x: p.x, y: p.y, type: "cubic" } : { x: p.x, y: p.y }));
  const tangents = [];
  applyBulbEdits(points, edits, tangents, radius);
  for (const i of [0, 3, 6, 9, 15]) points[i].smooth = true;
  points[12].smooth = built;
  for (const i of [9, 12, 15]) points[i].skipColinear = true;
  const outerWall = curves[0].map((p, i) =>
    i % 3 ? { x: p.x, y: p.y, type: "cubic" } : { ...wall[i], x: p.x, y: p.y }
  );
  outerWall[3] = points[0];
  return {
    points,
    error: fit.curvatureError * radius,
    status: fit.curvatureError * radius < 1e-5 ? "matched" : "bounded",
    wall: outerWall,
    keptInner: [points[18]],
    ball,
    tangents,
    entryParameter: 1,
    orthogonalEntry: false,
    sideOnApex: false,
    preview,
  };
}

// The bulb's apexes, `count` of them in turn from the rib: where the
// reference runs exactly horizontal or vertical, the first at the axis
// direction nearest the stroke's own at the rib and each next a quarter turn
// on. The axis an apex aims at follows from the rib's direction alone, so
// every master gives the same apex the same extreme. An apex moves off its
// extreme only where the extreme is not on the ball, or not far enough on
// it: closer than FIT_APEX_ROOM to the rib, to the ball's end or to its
// neighbour. There it stands as near its extreme as the ball allows. At the
// rib the curvature jumps from the wall's to the ball's, and a smooth join on
// that jump bends both curves beside it: an apex 3 degrees short of the rib
// drew E's ball 6 units square.
function apexPlaces(reference, sRib, sEnd, count) {
  const ribTurn = reference.turnAt(sRib),
    endTurn = reference.turnAt(sEnd);
  const along = reference.tangent(sRib, true);
  const later = reference.tangent(sRib + 0.25 * (sEnd - sRib));
  const sense = Math.sign(cross(along, later)) || 1;
  const quarter = Math.PI / 2;
  const angle = Math.atan2(along.y, along.x);
  const axis = Math.round(angle / quarter) * quarter;
  const first = ribTurn + sense * (axis - angle);
  const turns = Array.from({ length: count }, (_, k) => first + k * quarter);
  // Hold each apex inside the bulb and the room apart, from the ball's end
  // back, then from the start forward.
  for (let k = count - 1; k >= 0; k--)
    turns[k] = Math.min(
      turns[k],
      (k === count - 1 ? endTurn : turns[k + 1]) - FIT_APEX_ROOM
    );
  for (let k = 0; k < count; k++)
    turns[k] = Math.max(turns[k], (k === 0 ? ribTurn : turns[k - 1]) + FIT_APEX_ROOM);
  return turns.map((t) => reference.atTurn(t));
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

// The refit of five cubics, P-E-X-B-A-N, to a reference. The unknowns are E's
// place along the reference and the ten handle lengths, in logarithms; X, B, A
// and N are held where the caller put them. Residuals: each curve's distance
// from the reference, across it, at seven fixed parameters, and each
// curvature condition, weighted to hold: at P with the wall before it, and at
// E, X, B and A. The fit ends at N on the reference's tangent there, with no
// condition on curvature. Where N has reached A, A-N is collapsed and the fit
// ends at A. Levenberg-Marquardt from the given start with a fixed step
// budget: one objective, one start, nothing chosen among.
const FIT_SAMPLES = [1, 2, 3, 4, 5, 6, 7].map((i) => i / 8);
// The curvature conditions come in by steps, the shape alone first, so the
// fit stays by the reference while the joins are made smooth. The same
// sequence every time.
const FIT_CURVATURE_WEIGHTS = [0, 1, 10, 100, 2000];
const FIT_STEPS = 40;
const FIT_MIN_HANDLE = 0.01;
// The least turn between two apexes, or between the last apex and the ball's
// end, before an apex moves off its extreme.
const FIT_APEX_ROOM = (10 * Math.PI) / 180;
const FIT_LENGTH_PULL = 2;
// A step that improves the fit by less than this share has settled it.
const FIT_SETTLED = 1e-6;
function fitToReference(reference, { start, kP, radius, held, quick = false }) {
  const gap = 0.1 * radius;
  const total = reference.total;
  const placeCount = 1;
  const places = (z) => [0, z[0], ...held];
  const CURVES = 5;
  const collapsed = held[3] - held[2] < 1e-6;
  const fitted = (k) => !(collapsed && k === 4);
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
    Array.from({ length: CURVES }, (_, k) => {
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

  const free = [start];
  if (quick) {
    const s = places(free);
    const lengths = quickLengths(s);
    const curves = lengths.map(([h0, h1], k) => curveAt(s, k, h0, h1));
    return { curves, places: s, curvatureError: 0 };
  }

  const curvatureRows = (curves) => {
    const rows = [bulbEndCurvature(curves[0]) - kP];
    for (let k = 0; k < (collapsed ? 3 : 4); k++)
      rows.push(bulbEndCurvature(curves[k], true) - bulbEndCurvature(curves[k + 1]));
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
    for (let k = 0; k < CURVES; k++) {
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
  // Which curves an unknown moves: a handle length its own curve, E the two
  // curves either side of it.
  const touchedBy = (j) =>
    j >= placeCount ? [Math.floor((j - placeCount) / 2)] : [0, 1];
  // E stays a tenth of a radius off both its neighbours; no handle falls under
  // a hundredth of its span, where a collapsed handle meets any curvature with
  // any shape.
  const project = (z) => {
    const out = [...z];
    out[0] = clamp(out[0], gap, held[0] - gap);
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
  const curves = evaluate(z).curves;
  return {
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
