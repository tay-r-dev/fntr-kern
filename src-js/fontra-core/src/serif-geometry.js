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

function rawAxisForMode(axisMode, axisAngle, tangent) {
  switch (axisMode) {
    case "horizontal":
      return { x: 1, y: 0 };
    case "vertical":
      return { x: 0, y: 1 };
    case "absolute":
      return unitFromDegrees(axisAngle ?? 0);
    default:
      // Perpendicular to the stroke: the ordinary stem foot.
      return vector.rotateVector90CW(tangent);
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
  let axis = vector.normalizeVector(rawAxisForMode(axisMode, axisAngle, outward));
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

const MAX_TIP_CUT_ANGLE = 80;
const MAX_EASE_FRACTION = 0.5;

function lerpUV(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
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
// The wing inner corner is NOT a returned point. It is the attractor the
// transition curve bends around, exactly as in the serif-lab mockup. Emitting it
// would split the sweep from tip to flank into two segments and destroy the
// bracketed look.
export function buildHalfSerif({ side, flankU, params }) {
  const wingLength = params.wingLength ?? 0;
  const tipThickness = params.tipThickness ?? 0;
  const wingSlope = params.wingSlope ?? 0;
  const reach = Math.max(params.reach ?? 0, 0);
  const tension = Math.min(Math.max(params.tension ?? 0, 0), 1);
  const concavity = Math.min(Math.max(params.concavity ?? 0, -1), 1);
  const cutAngle = Math.min(
    Math.max(params.tipCutAngle ?? 0, -MAX_TIP_CUT_ANGLE),
    MAX_TIP_CUT_ANGLE
  );

  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  // Where the serif lets go of the stroke, and the straight run below it. Both
  // sit on the flank line, straight up from the rib end, and both are functions
  // of the serif's own numbers alone.
  //
  // Reading them off the stroke edge instead is tempting, because on a curved
  // approach the edge has drifted off the flank by the time it gets this far.
  // But then anything that reshapes the edge - a curvature pin above all - slides
  // these two on-curves along the stroke, and a curvature pin is only allowed to
  // change handles. The caller brings the edge to these points instead.
  const junction = { u: flankU, v: wingInnerV + reach };

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
  const corner = { u: flankU, v: wingInnerV };
  // With no wing there is no corner to bracket around, since it has collapsed
  // onto the tip. Hollowing toward it only pushes the curve below the foot line
  // and dimples the baseline, so a half turned off this way stays straight.
  const midChord = lerpUV(tipTop, junction, 0.5);
  const attractor = lerpUV(midChord, corner, concavity);
  const control1 = lerpUV(tipTop, attractor, tension);
  const control2 = lerpUV(junction, attractor, tension);
  const easeOff = concavity > 0;
  const easeDistance = easeOff ? 0 : Math.max(params.easeDistance ?? 0, 0);
  const easeCurvature = Math.min(Math.max(params.easeCurvature ?? 0, 0), 1);
  const chord = Math.hypot(junction.u - tipTop.u, junction.v - tipTop.v);
  const easeFraction =
    chord > 0 ? Math.min(easeDistance / chord, MAX_EASE_FRACTION) : 0;
  const bracket = splitCubic(tipTop, control1, control2, junction, 1 - easeFraction);
  const easeOnBracket = bracket.first[3];
  const release = { u: flankU, v: junction.v + easeDistance };
  const easeFlankHandle = lerpUV(release, junction, easeCurvature);
  const easeBracketHandle = lerpUV(easeOnBracket, bracket.second[1], easeCurvature);

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
    wingInnerV,
  };
}

// How far along the foot's axis span the underside controls sit.
const FOOT_CONTROL_FRACTION = 1 / 3;

// Each control keeps its own end's depth, so the foot leaves the tip tangent to
// the baseline and arrives at the centre flat. Putting both controls on the
// straight chord instead would give a shallow V, not the old-style scoop. At
// cup 0 both depths are 0 and the foot is a straight line.
function footControls(from, to) {
  const span = to.u - from.u;
  return [
    { u: from.u + span * FOOT_CONTROL_FRACTION, v: from.v },
    { u: from.u + span * (1 - FOOT_CONTROL_FRACTION), v: to.v },
  ];
}

// One serif terminal: two halves plus the single underside curve that joins
// them. Emission order is left junction -> ... -> foot centre -> ... -> right
// junction, which is the order the generator's assembly wants between the
// trimmed left side and the reversed right side.
//
// The underside is ONE curve across the whole terminal, driven by one cup value.
// The foot centre sits on the skeleton, not at the midpoint of the two tips: the
// axis modes routinely produce unequal halves, and a midpoint-anchored centre
// would drag the contact geometry off the alignment zone as the axis rotates.
export function buildSerifTerminal({
  frame,
  leftFlankU,
  rightFlankU,
  left,
  right,
  undersideCup,
}) {
  const halves = {
    left: buildHalfSerif({ side: 1, flankU: leftFlankU, params: left }),
    right: buildHalfSerif({ side: -1, flankU: rightFlankU, params: right }),
  };
  const centre = { u: 0, v: Math.max(undersideCup ?? 0, 0) };

  const onCurve = (uv) => frame.toGlyph(uv);
  // Both handles at these two run along one line by construction, so the editor
  // should draw them as smooth points and keep them that way when they are
  // dragged. The junction continues the stroke edge into the bracket; the foot
  // centre sits mid-curve in the single underside sweep.
  const smoothOnCurve = (uv) => ({ ...frame.toGlyph(uv), smooth: true });
  const control = (uv) => ({ ...frame.toGlyph(uv), type: "cubic" });

  const [leftCup1, leftCup2] = footControls(halves.left.tipBottom, centre);
  const [rightCup1, rightCup2] = footControls(centre, halves.right.tipBottom);

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
