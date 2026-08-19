import * as vector from "./vector.js";

// A serif whose axis runs along the stroke has no wings to speak of and no
// sensible release on either flank. Rather than falling back to another mode —
// which would jump — the axis is pushed off the tangent until it clears this
// separation. Continuous everywhere except exactly parallel, which is a single
// measure-zero configuration.
export const MIN_AXIS_TANGENT_SEPARATION_DEG = 15;

function unitFromDegrees(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function rawAxisForMode(axisMode, axisAngle, tangent, normal) {
  switch (axisMode) {
    case "horizontal":
      return { x: 1, y: 0 };
    case "vertical":
      return { x: 0, y: 1 };
    case "absolute":
      return unitFromDegrees(axisAngle ?? 0);
    default:
      // Perpendicular to the stroke: the ordinary stem foot, which sits on the
      // rib. Take the rib rather than square up the tangent again. The two agree
      // on an ordinary terminal, and only the rib carries a rib angle lock — so
      // squaring the tangent left a locked terminal leaning with the stroke
      // while its rib stayed flat. The three named modes state a direction
      // outright and never consult the stroke, so the lock does not reach them.
      return normal ?? vector.rotateVector90CW(tangent);
  }
}

// The axis is a line, not a ray, so only its angle modulo 180 degrees matters
// here; orientation is fixed afterwards against the rib normal.
function separateFromTangent(axis, tangent) {
  const cross = axis.x * tangent.y - axis.y * tangent.x;
  const dot = axis.x * tangent.x + axis.y * tangent.y;
  const minSine = Math.sin((MIN_AXIS_TANGENT_SEPARATION_DEG * Math.PI) / 180);
  if (Math.abs(cross) >= minSine) {
    return axis;
  }
  const tangentAngle = Math.atan2(tangent.y, tangent.x);
  const side = cross === 0 ? (dot >= 0 ? 1 : -1) : Math.sign(cross);
  const separated =
    tangentAngle + (side * MIN_AXIS_TANGENT_SEPARATION_DEG * Math.PI) / 180;
  return { x: Math.cos(separated), y: Math.sin(separated) };
}

export function computeSerifFrame({ endpoint, tangent, normal, axisMode, axisAngle }) {
  const outward = vector.normalizeVector(tangent);
  let axis = vector.normalizeVector(
    rawAxisForMode(axisMode, axisAngle, outward, normal)
  );
  axis = separateFromTangent(axis, outward);

  // Positive u points at the contour's left side, matching the generator's own
  // rib convention, so a half stored as "left" is the half on the left.
  if (axis.x * normal.x + axis.y * normal.y < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }

  // Depth is perpendicular to the axis, not to the tangent, so the frame stays
  // orthonormal in every mode. It points back into the stroke.
  let depth = { x: -axis.y, y: axis.x };
  if (depth.x * outward.x + depth.y * outward.y > 0) {
    depth = { x: -depth.x, y: -depth.y };
  }

  const origin = { x: endpoint.x, y: endpoint.y };

  return {
    origin,
    axis,
    depth,
    toFrame(point) {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      return { u: dx * axis.x + dy * axis.y, v: dx * depth.x + dy * depth.y };
    },
    toGlyph({ u, v }) {
      return {
        x: origin.x + axis.x * u + depth.x * v,
        y: origin.y + axis.y * u + depth.y * v,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The stem wall as the serif sees it: one curve in the terminal's own frame,
// running from the rib end into the stroke, with depth (v) growing inward.
//
// It is one curve and the questions the serif asks of it. That is what lets the
// terminal attach to the real wall without the shape code doing curve algebra
// inline, and lets the generator hand over a segment without learning what a
// serif does with it.
//
// Every search here has a fixed sample count and a fixed bisection count. There
// is no convergence test and no tolerance to cross, because a threshold in a
// shape path makes the output a step function of its input.
// ---------------------------------------------------------------------------

// Samples used to bracket a crossing before bisecting into it.
const SCAN_SAMPLES = 256;
// Bisection steps. 40 halvings take a bracket of one parameter unit below
// 1e-12, which is far under the grid the result is rounded onto.
const BISECT_STEPS = 40;
// A terminal may consume its own segment and no more. The wall stops short of
// its own far end so a splice always has curve left on both sides of the cut.
const MAX_CONSUMED_FRACTION = 0.95;
// Samples in the arc-length table that resolves that fraction.
const LENGTH_SAMPLES = 256;

function lerp(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

function evaluate(points, t) {
  if (points.length === 2) {
    return lerp(points[0], points[1], t);
  }
  const a = lerp(points[0], points[1], t);
  const b = lerp(points[1], points[2], t);
  const c = lerp(points[2], points[3], t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function derivative(points, t) {
  if (points.length === 2) {
    return { u: points[1].u - points[0].u, v: points[1].v - points[0].v };
  }
  const s = 1 - t;
  return {
    u:
      3 * s * s * (points[1].u - points[0].u) +
      6 * s * t * (points[2].u - points[1].u) +
      3 * t * t * (points[3].u - points[2].u),
    v:
      3 * s * s * (points[1].v - points[0].v) +
      6 * s * t * (points[2].v - points[1].v) +
      3 * t * t * (points[3].v - points[2].v),
  };
}

function normalize(direction) {
  const length = Math.hypot(direction.u, direction.v);
  if (!(length > 0)) {
    return { u: 0, v: 1 };
  }
  return { u: direction.u / length, v: direction.v / length };
}

// One arc-length table for the curve, built once. A fixed table rather than a
// solve, for the same reason as everything else here.
function buildLengthTable(points) {
  let total = 0;
  const cumulative = [0];
  let previous = evaluate(points, 0);
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const current = evaluate(points, i / LENGTH_SAMPLES);
    total += Math.hypot(current.u - previous.u, current.v - previous.v);
    cumulative.push(total);
    previous = current;
  }
  return { cumulative, total };
}

// Length along the curve up to a parameter, by linear reading of the table.
function lengthAtParameter(table, t) {
  const scaled = Math.min(Math.max(t, 0), 1) * LENGTH_SAMPLES;
  const index = Math.min(Math.floor(scaled), LENGTH_SAMPLES - 1);
  const within = scaled - index;
  const { cumulative } = table;
  return cumulative[index] + (cumulative[index + 1] - cumulative[index]) * within;
}

// The parameter at a length, the same reading run backwards.
function parameterAtLength(table, target) {
  const { cumulative, total } = table;
  if (!(total > 0)) {
    return 0;
  }
  if (target <= 0) {
    return 0;
  }
  if (target >= total) {
    return 1;
  }
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    if (cumulative[i] >= target) {
      const span = cumulative[i] - cumulative[i - 1];
      const within = span > 0 ? (target - cumulative[i - 1]) / span : 0;
      return (i - 1 + within) / LENGTH_SAMPLES;
    }
  }
  return 1;
}

// Bisect a function that changes sign between `low` and `high`.
function bisect(signAt, low, high) {
  const lowSign = signAt(low) < 0;
  let a = low;
  let b = high;
  for (let step = 0; step < BISECT_STEPS; step++) {
    const mid = (a + b) / 2;
    if (signAt(mid) < 0 === lowSign) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * A wall built from a line (2 points) or a cubic (4 points), in frame
 * coordinates, ordered from the rib end into the stroke.
 * @param {Array<{u: number, v: number}>} points
 */
export function makeSerifWall(points) {
  const table = buildLengthTable(points);
  const maxParameter =
    table.total > 0
      ? parameterAtLength(table, table.total * MAX_CONSUMED_FRACTION)
      : MAX_CONSUMED_FRACTION;
  const maxDepth = evaluate(points, maxParameter).v;
  const maxLength = lengthAtParameter(table, maxParameter);

  const lengthAt = (t) => lengthAtParameter(table, t);
  // Advance along the wall by a true distance, not by depth. Reach and ease
  // distance are lengths in the panel, so they are lengths here: measured as
  // depth instead, a leaning or curving wall carries the point further than the
  // number says, by the number divided by the cosine of the lean.
  const parameterAtDistance = (fromParameter, distance) =>
    Math.min(
      parameterAtLength(table, lengthAtParameter(table, fromParameter) + distance),
      maxParameter
    );

  const pointAt = (t) => evaluate(points, t);
  const tangentAt = (t) => normalize(derivative(points, t));

  // The first parameter whose depth reaches `depth`. "First" matters: a wall
  // that turns far enough can reach one depth twice, and the serif wants the
  // one nearer the rib end. A wall that never gets that deep is consumed to its
  // limit, which is the continuous answer — as the request grows the parameter
  // slides up to the limit and stays there.
  const parameterAtDepth = (depth) => {
    if (!(depth > pointAt(0).v)) {
      return 0;
    }
    if (depth >= maxDepth) {
      return maxParameter;
    }
    const below = (t) => pointAt(t).v - depth;
    let previous = 0;
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      if (below(t) >= 0) {
        return bisect(below, previous, t);
      }
      previous = t;
    }
    return maxParameter;
  };

  // Where the wall crosses a ray. The sign function is the cross product of the
  // ray direction with the offset to the wall, so its zeros are where the wall
  // meets the ray's line; a crossing behind the ray's origin is discarded.
  const meetRay = (origin, direction) => {
    const cross = (t) => {
      const p = pointAt(t);
      return direction.u * (p.v - origin.v) - direction.v * (p.u - origin.u);
    };
    const ahead = (t) => {
      const p = pointAt(t);
      return direction.u * (p.u - origin.u) + direction.v * (p.v - origin.v) >= 0;
    };
    let previous = 0;
    let previousCross = cross(0);
    if (previousCross === 0 && ahead(0)) {
      return 0;
    }
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      const current = cross(t);
      if (current === 0) {
        if (ahead(t)) return t;
      } else if (previousCross !== 0 && previousCross < 0 !== current < 0) {
        const hit = bisect(cross, previous, t);
        if (ahead(hit)) return hit;
      }
      previous = t;
      previousCross = current;
    }
    return null;
  };

  return {
    pointAt,
    tangentAt,
    parameterAtDepth,
    parameterAtDistance,
    lengthAt,
    meetRay,
    maxParameter,
    maxDepth,
    maxLength,
  };
}

// Past this the tip's outer edge leans so far it crosses the wing. Exported
// because the panel bounds its field with it and the scrub bounds its drag with
// it: three copies of the same number would drift, and a panel that kept
// counting past a shape which had already stopped is exactly the kind of lie
// that produces.
export const MAX_TIP_CUT_ANGLE = 80;

// How far the rounding can step back from the junction before it has eaten the
// whole bracket. The bracket-side end stops where the bracket meets the wing,
// at the top of the tip, and the flank end stops at the same distance so the
// scoop stays symmetric. There is nothing to round past that: the rounding has
// replaced the bracket entirely.
//
// This is the straight-line distance from the junction to the top of the tip,
// which is what both ends are measured by.
//
// Exported for the same reason as the cut-angle limit. The scrub bounds its
// drag with this, so the stored number stops where the shape does.
export function maxSerifEaseDistance(params) {
  const wingLength = params?.wingLength ?? 0;
  const wingSlope = params?.wingSlope ?? 0;
  const reach = Math.max(params?.reach ?? 0, 0);
  return Math.hypot(wingLength, wingSlope + reach);
}

function lerpUV(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

function subUV(a, b) {
  return { u: a.u - b.u, v: a.v - b.v };
}

function lengthUV(a) {
  return Math.hypot(a.u, a.v);
}

// Step `distance` from `origin` along `direction`. A zero-length direction has
// nowhere to go, so it stays put rather than producing NaN — which is the
// degenerate case at ease distance 0, where the whole rounding collapses.
function alongUV(origin, direction, distance) {
  const length = lengthUV(direction);
  if (!length) {
    return { u: origin.u, v: origin.v };
  }
  return {
    u: origin.u + (direction.u / length) * distance,
    v: origin.v + (direction.v / length) * distance,
  };
}

// Where two lines meet, given a point and a direction on each. Null when they
// are too near parallel to name a meeting point: the caller falls back to a
// bound of its own rather than chasing an intersection at infinity.
function lineIntersection(originA, directionA, originB, directionB) {
  const denominator = directionA.u * directionB.v - directionA.v * directionB.u;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const delta = subUV(originB, originA);
  const t = (delta.u * directionB.v - delta.v * directionB.u) / denominator;
  return {
    u: originA.u + directionA.u * t,
    v: originA.v + directionA.v * t,
  };
}

function splitCubic(p0, p1, p2, p3, t) {
  const a = lerpUV(p0, p1, t);
  const b = lerpUV(p1, p2, t);
  const c = lerpUV(p2, p3, t);
  const d = lerpUV(a, b, t);
  const e = lerpUV(b, c, t);
  const f = lerpUV(d, e, t);
  return { first: [p0, a, d, f], second: [f, e, c, p3] };
}

// One half-serif, entirely in frame coordinates. `side` is +1 for the left half
// and -1 for the right, so the same seven numbers describe both and the caller
// never mirrors anything by hand.
//
// `wall` is the stem wall in this same frame, running from the rib end into the
// stroke. Every point the serif shares with the stroke is found ON it, so the
// caller can cut the wall where the serif meets it and emit what survives
// unchanged. The wall states how far it may be consumed, so the half needs no
// separate limit.
//
// The wing inner corner is NOT a returned point. It is the attractor the
// transition curve bends around, exactly as in the serif-lab mockup. Emitting it
// would split the sweep from tip to flank into two segments and destroy the
// bracketed look.
export function buildHalfSerif({ side, wall, params }) {
  const wingLength = params.wingLength ?? 0;
  const wantedTipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const tension = Math.min(Math.max(params.tension ?? 0, 0), 1);
  const concavity = Math.min(Math.max(params.concavity ?? 0, -1), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const footU = wall.pointAt(0).u;
  const tipU = footU + side * wingLength;

  // How thick the tip may get before its top pushes through the stem wall. The
  // top of the tip stands straight above the wing's end, so the limit is where
  // the wall crosses that line. A wall that never runs out that far sets no
  // limit, which is the ordinary straight stem.
  //
  // Without this the tip goes on thickening past the crossing, its top ends up
  // on the far side of the wall, and the outline notches where the tip pokes
  // through. Points collapse, they do not disappear: at the limit the top of the
  // tip and the wing's inner corner are the same point, and the wing's top
  // surface has no length rather than no existence.
  // With no wing the tip stands on the wall's own foot, so the line it stands on
  // IS the wall and every depth counts as a crossing. That is a wing already
  // collapsed, not a tip poking through one, and clamping there would erase a
  // tip that draws perfectly well against the stroke.
  const wallCrossesTip =
    wingLength > 0 ? wall.meetRay({ u: tipU, v: 0 }, { u: 0, v: 1 }) : null;
  const tipLimit = wallCrossesTip === null ? Infinity : wall.pointAt(wallCrossesTip).v;
  const tipThickness = Math.min(wantedTipThickness, Math.max(tipLimit, 0));
  const tipReachesWall = tipThickness >= tipLimit;

  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };

  // The wing's inner corner is where the wing's top surface reaches the stem.
  // The surface leaves the top of the tip running inward, rising by the wing
  // slope over the wing's own length, and it is extended until it MEETS THE
  // WALL. Placing it at a depth of tipThickness + wingSlope instead assumes the
  // wall stands straight up from the rib end, which is true of a straight stem
  // and false of every curved one. On a straight wall the two answers are the
  // same point, so nothing already drawn moves.
  const cornerRay = { u: -side * wingLength, v: wingSlope };
  // The tip has reached the wall on its own, so there is no wing left for a
  // slope to climb: the stem has swallowed it. The corner is the crossing the
  // tip stopped at, and the wing slope is not emitted at all. Climbing a surface
  // that is not there would carry the bracket back out into space the stroke
  // already occupies, and would leave the slope still moving the shape after the
  // wing it belongs to had gone.
  const cornerParameter = tipReachesWall
    ? wallCrossesTip
    : wingLength > 0
      ? (wall.meetRay(tipTop, cornerRay) ??
        wall.parameterAtDepth(tipThickness + wingSlope))
      : wall.parameterAtDepth(tipThickness + wingSlope);
  const corner = wall.pointAt(cornerParameter);

  // Reach and ease distance are LENGTHS ALONG THE WALL above the corner. They
  // are lengths in the panel, so they are lengths here. Advancing by depth
  // instead — which is what the straight-line model could measure — carries the
  // point further along a leaning or curving wall than the number says, by the
  // number divided by the cosine of the lean, and leaves the rounding lopsided:
  // its wall end travelled 17.3 for an ease distance of 15 at a lean of 30
  // degrees, while its other end travelled 15. Tip thickness stays a depth,
  // because the thickness of the tip is measured square to the foot.
  const room = Math.max(wall.maxLength - wall.lengthAt(cornerParameter), 0);
  const wantedReach = Math.max(params.reach ?? 0, 0);
  const reach = Math.min(wantedReach, room);
  // At full concavity the bracket already leaves the junction along the flank,
  // so there is no corner left to round and the rounding has nothing to do. Only
  // then: a partly hollow bracket still meets the flank at an angle, and wants
  // rounding as much as a bulging one does.
  const easeOff = concavity >= 1;
  const wantedEase = easeOff ? 0 : Math.max(params.easeDistance ?? 0, 0);
  // The rounding runs out where the bracket meets the wing, and the same bound
  // holds both ends: the flank end stops where the bracket end stops, or the
  // scoop goes lopsided at exactly the settings a designer is pushing hardest.
  const easeDistance = Math.min(
    wantedEase,
    maxSerifEaseDistance(params),
    Math.max(room - reach, 0)
  );
  const depthClamped =
    wantedTipThickness > tipThickness ||
    wantedReach > reach ||
    wantedEase > easeDistance;
  const easeCurvature = Math.min(Math.max(params.easeCurvature ?? 0, 0), 1);

  // Where the serif lets go of the stroke, and the straight run below it. Both
  // sit ON the wall above the corner, at their own depths.
  const junctionParameter = wall.parameterAtDistance(cornerParameter, reach);
  const junction = wall.pointAt(junctionParameter);
  const releaseParameter = wall.parameterAtDistance(junctionParameter, easeDistance);
  const release = wall.pointAt(releaseParameter);

  // The transition cubic runs junction -> tipTop, and both of its handles
  // lie on the line from their own end toward the wing's inner corner. That is
  // what makes the bracket a bracket: the curve leaves the stroke edge along the
  // stroke edge, and meets the wing along the wing's top surface. Any non-zero
  // handle length preserves both tangents, so the two sliders are free to shape
  // the curve without ever breaking them.
  //
  //   concavity is the handle length, as a fraction of the distance to the
  //   corner. 0 collapses the curve to a straight chamfer, 1 carries the handles
  //   all the way onto the corner for the deepest hollow, negative sends them the
  //   other way for a convex bulge.
  //
  //   tension is the balance between the two. At 0.5 they are equal; away from
  //   that the curve turns nearer one end than the other, which is what moves the
  //   bracket up the stem or out along the wing.
  //
  // They cannot cancel each other out: tension only ever splits a length that
  // concavity set, and the split is bounded so neither handle can vanish.
  // With no wing there is no corner to bracket around, since it has collapsed
  // onto the tip. Hollowing toward it only pushes the curve below the foot line
  // and dimples the baseline, so a half turned off this way stays straight.
  const midChord = lerpUV(tipTop, junction, 0.5);
  const attractor = lerpUV(midChord, corner, concavity);
  const control1 = lerpUV(tipTop, attractor, tension);
  const control2 = lerpUV(junction, attractor, tension);
  // The rounding is one curve across the corner at the junction, and both of
  // its ends step back from that corner by the ease distance — the flank end
  // along the flank, the bracket end along the bracket. The bracket end is
  // found BY DISTANCE. Taking the ease distance as a fraction of the bracket's
  // chord and using it as a curve parameter measured neither the same quantity
  // nor in the same unit, so the two ends grew at different rates, and only the
  // bracket end ever ran out.
  const bracketPointAt = (fraction) =>
    splitCubic(tipTop, control1, control2, junction, 1 - fraction).first[3];
  const distanceToJunction = (point) => lengthUV(subUV(point, junction));
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step++) {
    const mid = (low + high) / 2;
    if (distanceToJunction(bracketPointAt(mid)) < easeDistance) low = mid;
    else high = mid;
  }
  const bracket = splitCubic(
    tipTop,
    control1,
    control2,
    junction,
    1 - (low + high) / 2
  );
  // With the wing swallowed there is no bracket left to step back along: it runs
  // from the corner up the wall, so both ends of the rounding would land on the
  // same surface and the scoop would have nothing to cut. The only corner in the
  // shape is where the TIP'S OWN EDGE meets the wall, so the rounding moves
  // there and its far end steps down that edge instead.
  //
  // The top of the tip comes down with it. Rounding a corner takes material from
  // both surfaces, not one, and the tip's top surface has no length here — so the
  // point where the tip's edge ends and the point the rounding lands on are the
  // same point. Two on-curves on one spot is the ground rule working: points
  // collapse, they do not disappear, and the count holds.
  const tipEdge = subUV(tipBottom, tipTop);
  const tipEase = tipReachesWall ? Math.min(easeDistance, lengthUV(tipEdge)) : 0;
  const easeOnBracket = tipReachesWall
    ? alongUV(tipTop, tipEdge, tipEase)
    : bracket.first[3];

  // The rounding is one curve from the release across to its landing on the
  // bracket, and each of its handles runs along the surface its own end sits on:
  // the flank line one side, the bracket's own tangent the other. Both are the
  // SAME LENGTH. A rounding is symmetric or it is not a rounding — giving each
  // handle a fraction of its own neighbour instead makes the two legs unequal,
  // because the split bracket's control leg has nothing to do with the ease
  // distance, and the result reads as a lopsided scoop.
  //
  // The length is measured toward the corner the two surfaces would meet at if
  // the rounding were not there, which is what the curvature slider is a
  // fraction of: 0 leaves both handles on their ends and cuts a straight chamfer,
  // 1 carries them onto that corner for the fullest round. Near full concavity
  // the two surfaces are nearly parallel and the corner runs away, so the reach
  // is bounded by the ease distance as well.
  // Out of the stroke along the wall itself. The chord back to the junction is
  // the same line only while the wall is straight, and a rounding whose handle
  // leaves off the surface it sits on is not tangent to it.
  const wallOut = wall.tangentAt(releaseParameter);
  const flankDirection = { u: -wallOut.u, v: -wallOut.v };
  const bracketDirection = tipReachesWall
    ? subUV(tipTop, easeOnBracket)
    : subUV(bracket.second[1], easeOnBracket);
  const meeting = lineIntersection(
    release,
    flankDirection,
    easeOnBracket,
    bracketDirection
  );
  const easeReach =
    easeCurvature *
    Math.min(
      meeting ? lengthUV(subUV(meeting, release)) : easeDistance,
      meeting ? lengthUV(subUV(meeting, easeOnBracket)) : easeDistance,
      easeDistance
    );
  const easeFlankHandle = alongUV(release, flankDirection, easeReach);
  const easeBracketHandle = alongUV(easeOnBracket, bracketDirection, easeReach);

  return {
    junction,
    corner,
    release,
    easeFlankHandle,
    easeOnBracket,
    easeBracketHandle,
    // The bracket has no length once the wing is swallowed, so its two controls
    // sit on its own collapsed ends rather than being read off a split of it.
    control1: tipReachesWall ? easeOnBracket : bracket.first[1],
    control2: tipReachesWall ? easeOnBracket : bracket.first[2],
    tipTop: tipReachesWall ? easeOnBracket : tipTop,
    tipBottom,
    depthClamped,
    releaseParameter,
  };
}

// The cup's tension at the shape the foot drew before the control existed, so
// nothing already drawn moves.
export const DEFAULT_UNDERSIDE_CUP_TENSION = 2 / 3;

// Tension 1 puts both of a half's controls on the middle of its own span, which
// is the ceiling for the same reason it is everywhere else in this project: one
// step further and the two handles of one segment change places and the sweep
// loops. So the fraction of the span a handle travels is half the tension.
const FOOT_CONTROL_CEILING = 0.5;

// Each control keeps its own end's depth, so the foot leaves the tip tangent to
// the baseline and arrives at the centre flat. Putting both controls on the
// straight chord instead would give a shallow V, not the old-style scoop. At
// cup 0 both depths are 0 and the foot is a straight line whatever the tension
// says, because the two ends are level.
function footControls(from, to, tension) {
  const span = to.u - from.u;
  const travel = span * Math.min(Math.max(tension, 0), 1) * FOOT_CONTROL_CEILING;
  return [
    { u: from.u + travel, v: from.v },
    { u: to.u - travel, v: to.v },
  ];
}

// One serif terminal: two halves plus the single underside curve that joins
// them. Emission order is left junction -> ... -> foot centre -> ... -> right
// junction, which is the order the generator's assembly wants between the
// trimmed left side and the reversed right side.
//
// The underside is ONE curve across the whole terminal, driven by one cup value.
// The foot centre sits midway between the two tip bottoms - the centre of the
// foot the serif actually draws, and the two ends of this very curve. Pinning it
// to the skeleton instead reads correctly only while the two halves match: a
// collapsed half puts the whole terminal on one side of the skeleton, and the
// cup's lowest point then lands on the foot's own edge rather than its middle.
// The cost is that unequal halves carry the contact point off the skeleton with
// them, by half of the difference.
export function buildSerifTerminal({
  frame,
  leftWall,
  rightWall,
  left,
  right,
  undersideCup,
  undersideCupTension,
  undersideCupBalance,
}) {
  const halves = {
    left: buildHalfSerif({
      side: 1,
      wall: leftWall,
      params: left,
    }),
    right: buildHalfSerif({
      side: -1,
      wall: rightWall,
      params: right,
    }),
  };
  // The balance slides the centre along the axis, as a fraction of the half-span
  // between the two tips. A fraction rather than a distance: the foot it divides
  // is what sets the scale, so one number reads the same on a narrow serif and a
  // wide one, the units mode never touches it, and a preset carries it between
  // masters unchanged. At either extreme the centre lands on a tip and one half
  // of the sweep collapses to nothing, which is a legal shape here - points
  // collapse, they do not disappear.
  const midpoint = (halves.left.tipBottom.u + halves.right.tipBottom.u) / 2;
  const halfSpan = (halves.left.tipBottom.u - halves.right.tipBottom.u) / 2;
  const balance = Math.min(Math.max(undersideCupBalance ?? 0, -1), 1);
  const centre = {
    u: midpoint + halfSpan * balance,
    v: Math.max(undersideCup ?? 0, 0),
  };

  const onCurve = (uv) => frame.toGlyph(uv);
  // Both handles at these two run along one line by construction, so the editor
  // should draw them as smooth points and keep them that way when they are
  // dragged. The junction continues the stroke edge into the bracket; the foot
  // centre sits mid-curve in the single underside sweep.
  const smoothOnCurve = (uv) => ({ ...frame.toGlyph(uv), smooth: true });
  const control = (uv) => ({ ...frame.toGlyph(uv), type: "cubic" });

  const cupTension = Number.isFinite(undersideCupTension)
    ? undersideCupTension
    : DEFAULT_UNDERSIDE_CUP_TENSION;
  const [leftCup1, leftCup2] = footControls(halves.left.tipBottom, centre, cupTension);
  const [rightCup1, rightCup2] = footControls(
    centre,
    halves.right.tipBottom,
    cupTension
  );

  return {
    halves,
    // The release is already supplied by the trimmed stroke edge, so this list
    // owns its outgoing handle rather than a duplicate on-curve.
    points: [
      control(halves.left.easeFlankHandle),
      control(halves.left.easeBracketHandle),
      smoothOnCurve(halves.left.easeOnBracket),
      control(halves.left.control2),
      control(halves.left.control1),
      onCurve(halves.left.tipTop),
      onCurve(halves.left.tipBottom),
      control(leftCup1),
      control(leftCup2),
      smoothOnCurve(centre),
      control(rightCup1),
      control(rightCup2),
      onCurve(halves.right.tipBottom),
      onCurve(halves.right.tipTop),
      control(halves.right.control1),
      control(halves.right.control2),
      smoothOnCurve(halves.right.easeOnBracket),
      control(halves.right.easeBracketHandle),
      control(halves.right.easeFlankHandle),
    ],
  };
}
