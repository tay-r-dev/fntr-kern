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

// How lopsided the two transition handles are allowed to get. Tension slides the
// split between them across this range; the bounds keep both of them alive,
// because a handle of zero length gives up the tangency at its end and turns the
// release back into a corner.
const MIN_HANDLE_SHARE = 0.25;
const MAX_HANDLE_SHARE = 0.75;

// A handle that reaches the corner exactly is the deepest bracket available. Any
// further and the two controls cross, which loops the curve.
const MAX_HANDLE_TO_CORNER = 1;

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
export function buildHalfSerif({
  side,
  flankU,
  params,
  straightDepth,
  release,
  releaseTangent,
}) {
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

  // A half with no wing is a half that is switched off, and it must add nothing
  // to the outline. The straight section is shared by the terminal, so without
  // this it would still push a spur out of a disabled side — and since the
  // section is straight while the edge it leaves is not, that spur lands outside
  // the stroke.
  const depthOfStraight =
    (params.wingLength ?? 0) === 0 ? 0 : Math.max(straightDepth ?? 0, 0);
  const wingInnerV = tipThickness + wingSlope;
  const tipU = flankU + side * wingLength;
  const cutOffset = side * tipThickness * Math.tan((cutAngle * Math.PI) / 180);

  const tipBottom = { u: tipU + cutOffset, v: 0 };
  const tipTop = { u: tipU, v: tipThickness };
  // Where the serif lets go of the stroke. Without an override it is placed on
  // the flank line, straight up from the rib end. That is only where the stroke
  // edge actually is when the stroke runs straight into the terminal; on a curved
  // approach the edge has already drifted off the flank by the time it gets this
  // far, and a release built on the flank leaves a step between the trimmed edge
  // and the serif. The caller therefore trims first and hands back the point the
  // cut really landed on, which makes `reach` a distance along the edge instead
  // of a height above the rib.
  const straightTop = release ?? { u: flankU, v: wingInnerV + reach + depthOfStraight };
  // The straight section hangs below the release, along the stroke edge rather
  // than straight down the frame: running it any other way would put a corner at
  // the release, which is exactly the join that has to stay smooth.
  const straightBottom = release
    ? {
        u: release.u - (releaseTangent?.u ?? 0) * depthOfStraight,
        v: release.v - (releaseTangent?.v ?? 1) * depthOfStraight,
      }
    : { u: flankU, v: wingInnerV + reach };

  // The transition cubic runs straightBottom -> tipTop, and both of its handles
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
  const hollow = wingLength === 0 ? 0 : concavity;
  const share = MIN_HANDLE_SHARE + (MAX_HANDLE_SHARE - MIN_HANDLE_SHARE) * tension;
  const clampShare = (amount) =>
    Math.max(Math.min(amount, MAX_HANDLE_TO_CORNER), -MAX_HANDLE_TO_CORNER);
  const handle = (from, toward, amount) => lerpUV(from, toward, clampShare(amount));

  // Without an override the corner sits directly below the release on the flank,
  // so aiming the handle at it already runs along the stroke edge. With one, the
  // edge has curved away from the flank and the caller's tangent is the only
  // thing still pointing along it; the corner sets the length either way.
  const cornerDistance = Math.hypot(
    corner.u - straightBottom.u,
    corner.v - straightBottom.v
  );
  const releaseTarget = releaseTangent
    ? {
        u: straightBottom.u - releaseTangent.u * cornerDistance,
        v: straightBottom.v - releaseTangent.v * cornerDistance,
      }
    : corner;

  const control1 = handle(tipTop, corner, hollow * 2 * (1 - share));
  const control2 = handle(straightBottom, releaseTarget, hollow * 2 * share);

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
  leftRelease,
  rightRelease,
  leftReleaseTangent,
  rightReleaseTangent,
}) {
  const halves = {
    left: buildHalfSerif({
      side: 1,
      flankU: leftFlankU,
      params: left,
      straightDepth,
      release: leftRelease,
      releaseTangent: leftReleaseTangent,
    }),
    right: buildHalfSerif({
      side: -1,
      flankU: rightFlankU,
      params: right,
      straightDepth,
      release: rightRelease,
      releaseTangent: rightReleaseTangent,
    }),
  };
  const centre = { u: 0, v: Math.max(undersideCup ?? 0, 0) };

  const onCurve = (uv) => frame.toGlyph(uv);
  // Both handles at these two run along one line by construction, so the editor
  // should draw them as smooth points and keep them that way when they are
  // dragged. straightBottom continues the stroke edge into the bracket; the foot
  // centre sits mid-curve in the single underside sweep.
  const smoothOnCurve = (uv) => ({ ...frame.toGlyph(uv), smooth: true });
  const control = (uv) => ({ ...frame.toGlyph(uv), type: "cubic" });

  const [leftCup1, leftCup2] = footControls(halves.left.tipBottom, centre);
  const [rightCup1, rightCup2] = footControls(centre, halves.right.tipBottom);

  return {
    halves,
    // straightTop is NOT emitted. It is where the trimmed stroke edge already
    // ends, so emitting it too would stack a second on-curve on the same spot.
    // The straight section is the run from that existing point down to
    // straightBottom.
    points: [
      smoothOnCurve(halves.left.straightBottom),
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
      smoothOnCurve(halves.right.straightBottom),
    ],
  };
}
