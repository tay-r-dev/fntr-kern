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

// Handle reach along the transition chord. Neither end of the range is
// geometrically free. Too short and a deep hollow throws the control past the
// flank onto the far side of the stroke, which self-intersects; too long and the
// two controls meet at the chord centre and the cubic degenerates.
const HANDLE_MIN_FRACTION = 0.2;
const HANDLE_MAX_FRACTION = 0.45;

// A symmetric pair of controls offset by `o` moves the curve's midpoint by
// three quarters of `o`, so scaling by 4/3 lands the belly exactly where asked.
const BELLY_TO_CONTROL = 4 / 3;

function lerpUV(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

// One half-serif, entirely in frame coordinates. `side` is +1 for the left half
// and -1 for the right, so the same seven numbers describe both and the caller
// never mirrors anything by hand.
//
// The wing inner corner is NOT a returned point. It is the attractor the
// transition curve bends around, exactly as in the serif-lab mockup. Emitting it
// would split the sweep from tip to flank into two segments and destroy the
// bracketed look.
export function buildHalfSerif({ side, flankU, params, straightDepth }) {
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

  const depthOfStraight = Math.max(straightDepth ?? 0, 0);
  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  const straightBottom = { u: flankU, v: wingInnerV + reach };
  const straightTop = { u: flankU, v: wingInnerV + reach + depthOfStraight };

  // The transition cubic runs straightBottom -> tipTop. The two sliders drive
  // separate things and must not multiply:
  //
  //   concavity sets HOW DEEP the hollow is. The belly of the curve lands at
  //   `concavity` of the way from the chord to the inner corner. 0 is a straight
  //   bevel, 1 touches the corner, negative bulges out convex.
  //
  //   tension sets HOW THE BEND IS DISTRIBUTED. Low tension keeps the handles
  //   short, so the curve turns hard next to the tip and the release and runs
  //   nearly flat between them. High tension stretches them to the chord centre
  //   for one even arc.
  //
  // Offsetting both controls by BELLY_TO_CONTROL times the wanted belly offset
  // puts the curve's midpoint exactly on the belly whatever the tension is, which
  // is what keeps the two controls independent.
  const corner = { u: flankU, v: wingInnerV };
  const mid = lerpUV(tipTop, straightBottom, 0.5);
  const offset = {
    u: (corner.u - mid.u) * concavity * BELLY_TO_CONTROL,
    v: (corner.v - mid.v) * concavity * BELLY_TO_CONTROL,
  };
  const reachFraction =
    HANDLE_MIN_FRACTION + (HANDLE_MAX_FRACTION - HANDLE_MIN_FRACTION) * tension;
  const nearTip = lerpUV(tipTop, straightBottom, reachFraction);
  const nearRelease = lerpUV(tipTop, straightBottom, 1 - reachFraction);
  // The offset points at the corner, so it pushes the controls along the axis as
  // well as into the stroke. Left free, a deep hollow drags them past the flank
  // and the curve crosses the stem edge it is supposed to land on. Holding every
  // control inside the half's own span keeps the whole cubic there too, by the
  // convex hull. The cost is that the deepest hollows stop exactly at the flank
  // instead of overshooting it, which is the bracket everybody actually wants.
  const clampU = (u) =>
    side > 0
      ? Math.min(Math.max(u, flankU), tipU)
      : Math.max(Math.min(u, flankU), tipU);
  const control1 = { u: clampU(nearTip.u + offset.u), v: nearTip.v + offset.v };
  const control2 = { u: clampU(nearRelease.u + offset.u), v: nearRelease.v + offset.v };

  return {
    straightTop,
    straightBottom,
    control1,
    control2,
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
// them. Emission order is left straightTop -> ... -> foot centre -> ... -> right
// straightTop, which is the order the generator's assembly wants between the
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
  straightDepth,
}) {
  const halves = {
    left: buildHalfSerif({ side: 1, flankU: leftFlankU, params: left, straightDepth }),
    right: buildHalfSerif({
      side: -1,
      flankU: rightFlankU,
      params: right,
      straightDepth,
    }),
  };
  const centre = { u: 0, v: Math.max(undersideCup ?? 0, 0) };

  const onCurve = (uv) => frame.toGlyph(uv);
  const control = (uv) => ({ ...frame.toGlyph(uv), type: "cubic" });

  const [leftCup1, leftCup2] = footControls(halves.left.tipBottom, centre);
  const [rightCup1, rightCup2] = footControls(centre, halves.right.tipBottom);

  return {
    halves,
    points: [
      onCurve(halves.left.straightTop),
      onCurve(halves.left.straightBottom),
      control(halves.left.control2),
      control(halves.left.control1),
      onCurve(halves.left.tipTop),
      onCurve(halves.left.tipBottom),
      control(leftCup1),
      control(leftCup2),
      onCurve(centre),
      control(rightCup1),
      control(rightCup2),
      onCurve(halves.right.tipBottom),
      onCurve(halves.right.tipTop),
      control(halves.right.control1),
      control(halves.right.control2),
      onCurve(halves.right.straightBottom),
      onCurve(halves.right.straightTop),
    ],
  };
}
