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
// unchanged. `maxDepth` is how deep this half may consume.
//
// The wing inner corner is NOT a returned point. It is the attractor the
// transition curve bends around, exactly as in the serif-lab mockup. Emitting it
// would split the sweep from tip to flank into two segments and destroy the
// bracketed look.
export function buildHalfSerif({ side, wall, params, maxDepth = Infinity }) {
  const wingLength = params.wingLength ?? 0;
  const tipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const tension = Math.min(Math.max(params.tension ?? 0, 0), 1);
  const concavity = Math.min(Math.max(params.concavity ?? 0, -1), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const footU = wall.pointAt(0).u;
  const tipU = footU + side * wingLength;
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
  // The tip may reach the wall on its own. Where the wall runs outward fast
  // enough, it stands past the tip's outer edge by the tip's own thickness, and
  // there is no wing left for a slope to climb: the stem has swallowed it. Then
  // the corner is where the TIP'S OWN EDGE crosses the wall, and the wing slope
  // is not emitted at all. Climbing a surface that is not there would carry the
  // bracket back out into space the stroke already occupies, and the slope would
  // still be moving the shape after the wing it belongs to had gone.
  const wallAtTip = wall.pointAt(wall.parameterAtDepth(tipThickness));
  const tipReachesWall = tipThickness > 0 && side * (tipU - wallAtTip.u) <= 0;
  const cornerParameter = tipReachesWall
    ? (wall.meetRay(tipBottom, subUV(tipTop, tipBottom)) ??
      wall.parameterAtDepth(tipThickness))
    : wingLength > 0
      ? (wall.meetRay(tipTop, cornerRay) ??
        wall.parameterAtDepth(tipThickness + wingSlope))
      : wall.parameterAtDepth(tipThickness + wingSlope);
  const corner = wall.pointAt(cornerParameter);

  // Reach and ease distance are depths above the corner, as tip thickness is a
  // depth. Only their sideways position follows the wall.
  const room = Math.max(maxDepth - corner.v, 0);
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
  const depthClamped = wantedReach > reach || wantedEase > easeDistance;
  const easeCurvature = Math.min(Math.max(params.easeCurvature ?? 0, 0), 1);

  // Where the serif lets go of the stroke, and the straight run below it. Both
  // sit ON the wall above the corner, at their own depths.
  const junctionParameter = wall.parameterAtDepth(corner.v + reach);
  const junction = wall.pointAt(junctionParameter);
  const releaseParameter = wall.parameterAtDepth(junction.v + easeDistance);
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
  const easeOnBracket = bracket.first[3];

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
  const bracketDirection = subUV(bracket.second[1], easeOnBracket);
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
    control1: bracket.first[1],
    control2: bracket.first[2],
    tipTop,
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
  leftMaxDepth,
  rightMaxDepth,
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
      maxDepth: leftMaxDepth,
    }),
    right: buildHalfSerif({
      side: -1,
      wall: rightWall,
      params: right,
      maxDepth: rightMaxDepth,
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
