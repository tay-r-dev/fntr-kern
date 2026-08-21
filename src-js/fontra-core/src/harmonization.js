//
// G2 curve harmonization.
//
// A smooth on-curve point joins two cubic segments with a common tangent (G1)
// but generally not a common curvature (G2). Harmonization slides the joint
// along that tangent until both sides curve equally.
//
// The math is Simon Cozens' construction, shared by both donors
// (_external/green-harmony and _external/supertool). Given the five-point
// stencil around the joint
//
//     PP(off) P(off) node(on, smooth) N(off) NN(off)
//
// let D be the intersection of the outer handle lines PP-P and N-NN. Then
//
//     ratio = sqrt( (|NN-N| / |N-D|) * (|D-P| / |P-PP|) )
//     target = lerp(N, P, ratio / (ratio + 1))
//
// The donors differ only in who absorbs the correction: Green Harmony moves the
// node onto `target`, SuperTool keeps the node and translates both inner
// handles by `fixup = node - target`. Because P, node and N are collinear,
// `fixup` is parallel to the tangent and the two are the same correction split
// two ways, which is what `handleBias` blends between.
//

import { balanceSegment, calculateTunniPoint } from "./tunni-calculations.js";
import { POINT_TYPE_OFF_CURVE_CUBIC } from "./var-path.js";
import {
  addVectors,
  distance,
  dotVector,
  interpolateVectors,
  intersect,
  mulVectorScalar,
  normalizeVector,
  subVectors,
  vectorLength,
} from "./vector.js";

export const HARMONIZE_DEFAULTS = {
  // "G2" matches curvature across the joint. "G3" also matches its rate of
  // change, which is what removes the crease from the curvature comb. G3 is
  // tried first and falls back to G2 wherever it has no admissible answer.
  continuity: "G2",
  // Under G3, allow the joint itself to slide along its tangent where holding
  // it still leaves the construction with no answer inside its bounds. It is a
  // repair, so a joint that does not need it does not move.
  slideOnCurve: false,
  // Solve the two handle LENGTHS of every segment against a curvature shared by
  // both sides of each node, which is Curvatura's other command, instead of
  // sliding anything along a tangent. A different construction rather than a
  // variation on this one -- see `harmonizeHandlesInPlace`. It ignores
  // `continuity`, `slideOnCurve` and `handleBias`, which have no meaning in it.
  handlesOnly: false,
  handleBias: 1.0, //     0 = move the node, 1 = move the handles
  // Never shrink a handle below 15% of a nominal handle for its segment, which
  // is measured from the segment's chord and not from the handle itself. See
  // `cuspFloors`.
  cuspSafetyMargin: 0.85,
  toleranceUnits: 0.01, // convergence threshold, in font units
  // Sweeps over the whole candidate set, not passes per point. An isolated
  // joint is solved in one; a ring of coupled joints (an 'o') takes ~8. The
  // math is a handful of square roots, so the budget is generous on purpose.
  maxIterations: 50,
  // Tunni-equalize the two segments at each joint, before and after — the pass
  // SuperTool's Harmonize command wraps around the same math. It is what moves
  // the outer handles PP and NN. Costs exactness: see equalizeJointSegments.
  equalizeTension: false,
  // Ceiling on how far a handle may reach toward its segment's Tunni point.
  // At 1 it lands exactly on it; past 1 the segment's two handle lines cross
  // each other and the curve doubles back.
  maxHandleTension: 1,
  // The largest curvature step G3 may leave behind at a joint that arrived
  // better than this, as a fraction of the joint's own curvature.
  //
  // It is a perceptual bound, and it is named rather than derived because the
  // thing it bounds is perceptual: the comb draws fringe length against
  // curvature, so this IS the step in the comb, and "when does a designer see a
  // break" has no answer in the geometry. Three per cent was set against
  // judgement on `n` node 13 -- an answer at 2.34% reads as a good curve there
  // and one at 18.38% reads as broken. It is here as a setting rather than a
  // constant so it can be argued with.
  //
  // A ceiling and never a target: each joint's ceiling is the WORSE of this and
  // what the drawing arrived with, so a joint already 40% out is not forbidden
  // from being improved to 30%, and a joint that arrives clean cannot be
  // dirtied past it.
  maxCurvatureStep: 0.03,
  // Round the points this operation moved to whole units, once, at the end.
  // Off here so the math stays exact and testable; the editor turns it on,
  // because a document wants integer coordinates and the sweep does not.
  roundCoordinates: false,
};

// Every write in this module goes through here, so the set of points the
// operation actually moved is known at the end — which is what makes rounding
// possible without disturbing geometry nobody asked to touch.
function writePoint(path, touched, index, point) {
  const [x, y] = path.getPointPosition(index);
  if (x === point.x && y === point.y) {
    return;
  }
  path.setPointPosition(index, point.x, point.y);
  touched.add(index);
}

function crossProduct(vectorA, vectorB) {
  return vectorA.x * vectorB.y - vectorA.y * vectorB.x;
}

function neighborIndex(path, contourIndex, contourPointIndex, offset) {
  const numPoints = path.getNumPointsOfContour(contourIndex);
  let index = contourPointIndex + offset;
  if (path.contourInfo[contourIndex].isClosed) {
    index = ((index % numPoints) + numPoints) % numPoints;
  } else if (index < 0 || index >= numPoints) {
    return undefined;
  }
  return path.getAbsolutePointIndex(contourIndex, 0) + index;
}

function isCubicOffCurve(point) {
  return point?.type === POINT_TYPE_OFF_CURVE_CUBIC;
}

//
// Collect the five-point stencil around a smooth cubic joint.
//
// Returns `{contourIndex, pointIndex, indices, PP, P, node, N, NN}` on success,
// or `{reason}` when the point cannot be harmonized. It never throws, so
// callers can report every rejected point rather than dropping it silently.
//
export function getJointContext(path, pointIndex) {
  const node = path.getPoint(pointIndex);
  if (!node || node.type || !node.smooth) {
    return { reason: "not-smooth" };
  }

  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
  if (path.getNumPointsOfContour(contourIndex) < 5) {
    // too short for the stencil; on a closed contour it would alias onto itself
    return { reason: "not-curve-joint" };
  }

  const indices = {
    PP: neighborIndex(path, contourIndex, contourPointIndex, -2),
    P: neighborIndex(path, contourIndex, contourPointIndex, -1),
    N: neighborIndex(path, contourIndex, contourPointIndex, 1),
    NN: neighborIndex(path, contourIndex, contourPointIndex, 2),
  };

  const stencil = {};
  for (const [name, index] of Object.entries(indices)) {
    const point = index === undefined ? undefined : path.getPoint(index);
    if (!isCubicOffCurve(point)) {
      return { reason: "not-curve-joint" };
    }
    stencil[name] = { x: point.x, y: point.y };
  }

  return {
    contourIndex,
    pointIndex,
    indices,
    node: { x: node.x, y: node.y },
    ...stencil,
  };
}

//
// The harmonic position for the joint, and the correction that reaches it.
// Returns null when the construction is degenerate: parallel outer handle
// lines, or a zero-length handle that makes one of the ratios undefined.
//
export function calculateHarmonicTarget(ctx) {
  const { PP, P, node, N, NN } = ctx;

  const D = intersect(N, NN, P, PP);
  if (!D) {
    return null;
  }

  const ratio = Math.sqrt(
    (distance(NN, N) / distance(N, D)) * (distance(D, P) / distance(P, PP))
  );
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }

  const target = interpolateVectors(N, P, ratio / (ratio + 1));
  return { target, fixup: subVectors(node, target) };
}

//
// The size of the curvature jump across the joint, in 1/units. Zero exactly
// when the joint is G2. Nothing renders this in v1, but it is the definition
// harmonization is written against, so the tests measure the result with it
// rather than re-deriving the algorithm.
//
export function measureG2Discontinuity(ctx) {
  const { PP, P, node, N, NN } = ctx;

  const incoming = subVectors(node, P);
  const outgoing = subVectors(N, node);
  const incomingLength = vectorLength(incoming);
  const outgoingLength = vectorLength(outgoing);
  if (!incomingLength || !outgoingLength) {
    return Infinity;
  }

  // signed curvature at the end of the incoming cubic and at the start of the
  // outgoing one; both reduce to the 5-point stencil
  const curvatureIn =
    (-2 / 3) * (crossProduct(incoming, subVectors(P, PP)) / incomingLength ** 3);
  const curvatureOut =
    (2 / 3) * (crossProduct(outgoing, subVectors(NN, N)) / outgoingLength ** 3);

  return Math.abs(curvatureIn - curvatureOut);
}

//
// The derivative control points of a cubic at one of its ends. The first
// derivative is the quadratic through 3(P1-P0), 3(P2-P1), 3(P3-P2). The second
// is the linear through twice the differences of those. The third is constant.
//
function cubicDerivatives(points, atEnd) {
  const [p0, p1, p2, p3] = points;
  const d1 = mulVectorScalar(subVectors(p1, p0), 3);
  const d2 = mulVectorScalar(subVectors(p2, p1), 3);
  const d3 = mulVectorScalar(subVectors(p3, p2), 3);
  return {
    first: atEnd ? d3 : d1,
    second: mulVectorScalar(atEnd ? subVectors(d3, d2) : subVectors(d2, d1), 2),
    third: mulVectorScalar(addVectors(subVectors(d3, mulVectorScalar(d2, 2)), d1), 2),
  };
}

// Signed curvature at one end of a cubic, in 1/units.
function curvatureAt(points, atEnd) {
  const { first, second } = cubicDerivatives(points, atEnd);
  const speed = vectorLength(first);
  return speed ? crossProduct(first, second) / speed ** 3 : Infinity;
}

// How fast that curvature changes, per unit of arc length. Two segments meeting
// with the same curvature and the same rate join without a crease in the
// curvature comb, which is G3.
function curvatureRateAt(points, atEnd) {
  const { first, second, third } = cubicDerivatives(points, atEnd);
  const speed = vectorLength(first);
  if (!speed) {
    return Infinity;
  }
  return (
    crossProduct(first, third) / speed ** 4 -
    (3 * crossProduct(first, second) * dotVector(first, second)) / speed ** 6
  );
}

//
// The two measurements a joint is judged by. Both take the joint's two cubic
// segments as [onCurve, handle, handle, onCurve], travelling in contour order.
// Zero exactly when the joint is G2, respectively G3.
//
export function curvatureDiscontinuity(incoming, outgoing) {
  return Math.abs(curvatureAt(incoming, true) - curvatureAt(outgoing, false));
}

export function curvatureRateDiscontinuity(incoming, outgoing) {
  return Math.abs(curvatureRateAt(incoming, true) - curvatureRateAt(outgoing, false));
}

//
// G3 by moving the two inner handles, with the joint and both outer handles
// held still. After Linus Romer's construction
// (_external/curvatura/curvatura-doc.pdf section 6.5), with one correction
// noted below.
//
// In a frame with the joint at the origin and the tangent along one axis, the
// joint is G3 when the two curvatures agree and their two rates agree. That is
// two equations, and the two inner handle lengths are two unknowns, so the
// answer is exact and unique. There is nothing to iterate and nothing to pick
// between.
//
// Write the incoming handle at `-q * reach` and the outgoing one at `reach`.
// Equal curvature fixes `q` as the square root of the two outer handles'
// offsets from the tangent, and equal rate then gives `reach` outright.
//
// The correction: the donor matches the rate of curvature per unit of the
// segment's own PARAMETER. The two segments run at different speeds through
// the joint, so that leaves a rate mismatch equal to the ratio of the two --
// 10% on the reported glyph. The curvature comb is drawn against arc length,
// which is what a designer reads, so this matches the rate per unit of ARC.
// The two answers differ by about 0.03 units of handle and the arc form is
// exact.
//
// It needs the two outer handles on the same side of the tangent. Where they
// disagree the joint is an inflection: this construction asks for the square
// root of a negative product, and G2 cannot be reached there either.
//
// Returns the new positions of the two inner handles, or null.
//
export function calculateG3Targets(incoming, outgoing) {
  const [A, PP, P, node] = incoming;
  const [, N, NN, C] = outgoing;

  // The tangent runs between the two inner handles and is anchored on the
  // joint. A smooth joint keeps those three collinear. Where the drawing has
  // drifted off that, this direction splits the difference, and the answer puts
  // both handles back on one line.
  const span = subVectors(N, P);
  if (!vectorLength(span)) {
    return null;
  }
  const axis = normalizeVector(span);

  // Frame the stencil on that axis, taking the side the incoming outer handle
  // is on as positive, so the construction always sees the sign it assumes.
  const along = (point) => dotVector(subVectors(point, node), axis);
  const sidedness = (point) => crossProduct(axis, subVectors(point, node));
  const flip = sidedness(PP) < 0 ? -1 : 1;
  const across = (point) => flip * sidedness(point);

  const d = across(PP);
  const l = across(NN);
  if (!(d > 0) || !(l > 0)) {
    return null; // an inflection, or an outer handle lying on the tangent
  }

  const b = across(A);
  const c = along(PP);
  const k = along(NN);
  const n = across(C);

  const ratio = Math.sqrt(d / l);
  const ratioPow4 = (d / l) ** 2;
  const denominator = -ratio * (9 * d + b) - ratioPow4 * (n + 9 * l);
  if (!denominator) {
    return null;
  }
  const reachOut = (6 * (c * d - k * l * ratioPow4)) / denominator;
  const reachIn = -ratio * reachOut;

  // The incoming handle sits behind the joint and the outgoing one ahead of it.
  // An answer that puts either on the wrong side is not a handle.
  if (!(reachIn < 0) || !(reachOut > 0)) {
    return null;
  }

  return {
    P: addVectors(node, mulVectorScalar(axis, reachIn)),
    N: addVectors(node, mulVectorScalar(axis, reachOut)),
  };
}

//
// Map a point selection onto the on-curve points it implies: a selected handle
// stands for the joint it belongs to. An empty (or absent) selection means
// every on-curve point in the path.
//
export function expandToJoints(path, pointIndices) {
  const selection = pointIndices?.length
    ? pointIndices
    : Array.from({ length: path.numPoints }, (_, i) => i);

  const joints = new Set();
  for (const pointIndex of selection) {
    const point = path.getPoint(pointIndex);
    if (!point) {
      continue;
    }
    if (!point.type) {
      joints.add(pointIndex);
      continue;
    }
    const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(pointIndex);
    for (const offset of [-1, 1]) {
      const index = neighborIndex(path, contourIndex, contourPointIndex, offset);
      if (index !== undefined && !path.getPoint(index)?.type) {
        joints.add(index);
        break;
      }
    }
  }
  return [...joints].sort((a, b) => a - b);
}

//
// The two cubic segments meeting at the joint, as index quadruples
// [onCurve, handle, handle, onCurve]. `nearSide` says which end of the
// quadruple the joint itself sits at, so callers know which handle is its own.
//
// A segment is absent when an open contour runs out before it does, or when
// the far end is not a real on-curve point.
//
function jointSegments(path, ctx) {
  const [contourIndex, contourPointIndex] = path.getContourAndPointIndex(
    ctx.pointIndex
  );
  const candidates = [
    {
      nearSide: "end",
      indices: [
        neighborIndex(path, contourIndex, contourPointIndex, -3),
        ctx.indices.PP,
        ctx.indices.P,
        ctx.pointIndex,
      ],
    },
    {
      nearSide: "start",
      indices: [
        ctx.pointIndex,
        ctx.indices.N,
        ctx.indices.NN,
        neighborIndex(path, contourIndex, contourPointIndex, 3),
      ],
    },
  ];

  return candidates.filter(
    ({ indices }) =>
      !indices.some((index) => index === undefined) &&
      !path.getPoint(indices[0]).type &&
      !path.getPoint(indices[3]).type
  );
}

//
// The shortest a handle at this joint may ever get.
//
// The floor is a fraction of the chord between its segment's two on-curve
// points, not of the handle itself. Two on-curve points do not move while
// handles are being corrected, so this is the same number every time the
// command runs. A floor taken from the handle was measured again from the
// shortened handle on the next call and allowed another cut of the same size,
// so running harmonize repeatedly walked a handle down to nothing.
//
// Half a chord is about the handle length of a well-formed quarter arc, so the
// margin keeps the meaning it had: a fraction of a nominal handle.
//
function cuspFloors(path, ctx, segments, cuspSafetyMargin) {
  const fraction = (1 - cuspSafetyMargin) / 2;
  const floorFor = (nearSide, handleLength) => {
    const segment = segments.find((candidate) => candidate.nearSide === nearSide);
    if (!segment) {
      // No segment on this side to take a chord from: fall back to the handle.
      return (1 - cuspSafetyMargin) * handleLength;
    }
    const points = segmentPositions(path, segment.indices);
    return fraction * distance(points[0], points[3]);
  };
  return {
    P: floorFor("end", distance(ctx.node, ctx.P)),
    N: floorFor("start", distance(ctx.node, ctx.N)),
  };
}

function segmentPositions(path, indices) {
  return indices.map((index) => {
    const [x, y] = path.getPointPosition(index);
    return { x, y };
  });
}

//
// How far one handle reaches toward its segment's Tunni point: at 1 it lands
// exactly on it, and past 1 the segment's two handle lines have crossed. This
// is the donor's xPercent/yPercent (SuperTool+TunniEditing.m:196-197).
//
function handleTension(points, nearSide) {
  const tunniPoint = calculateTunniPoint(points);
  if (!tunniPoint) {
    return 0; // parallel handles: they never cross, so nothing to limit
  }
  const [onCurve, handle] =
    nearSide === "start" ? [points[0], points[1]] : [points[3], points[2]];
  const reach = distance(onCurve, tunniPoint);
  return reach ? distance(onCurve, handle) / reach : Infinity;
}

//
// The worst tension either of the joint's own handles would reach after a
// step, computed without touching the path.
//
function tensionAfterStep(path, ctx, segments, fixup, handleBias) {
  const nodeDelta = mulVectorScalar(fixup, -(1 - handleBias));
  const handleDelta = mulVectorScalar(fixup, handleBias);

  let worst = 0;
  for (const { nearSide, indices } of segments) {
    const points = segmentPositions(path, indices).map((point, i) => {
      const index = indices[i];
      if (index === ctx.pointIndex) {
        return addVectors(point, nodeDelta);
      }
      if (index === ctx.indices.P || index === ctx.indices.N) {
        return addVectors(point, handleDelta);
      }
      return point;
    });
    worst = Math.max(worst, handleTension(points, nearSide));
  }
  return worst;
}

// How many places the repair slide samples before it refines, and how many
// times it halves afterwards. Both are fixed: the slide is a search, and a
// search that decides its own trip count cannot be continuous in its input.
const G3_SLIDE_SAMPLES = 64;

// Two slide positions this close in error are the same answer, and the tie goes
// to whichever moves the joint less. Without a tolerance, floating-point dust
// decides, and a joint already standing at the best place walks off it.
const GRID_TIE_UNITS = 1e-9;

//
// The joint's two cubic segments, as point quadruples in contour order. Null
// where an open contour runs out before one of them.
//
function jointStencil(path, ctx) {
  const segments = jointSegments(path, ctx);
  if (segments.length < 2) {
    return null;
  }
  return {
    incoming: segmentPositions(path, segments[0].indices),
    outgoing: segmentPositions(path, segments[1].indices),
  };
}

//
// How far a joint sits from the condition the command is trying to establish.
//
// Two properties matter and neither is decoration. It is **relative**, because a
// selection holds joints of every size and an absolute curvature difference lets
// the tightest one own the whole score. And it measures the condition the caller
// asked for: under G3 the rate of change of curvature is half of what is being
// solved for, so a score that leaves it out judges a G3 answer by how well it
// does at G2. That is not a near miss. Measured on the outer arch of `n`, all
// four whole-unit placements bracketing the exact G3 answer score worse on
// curvature alone than the drawing they came from, so all four were reverted and
// G3 could never take over from a G2-harmonic joint.
//
// Curvature carries units of 1/length and its rate 1/length², so both are made
// dimensionless by the joint's own size — the mean of its two segments' chords.
// The two terms are then errors in the same unit and the total is their sum,
// with no weight to choose.
//
// The scale is the joint's LENGTH and deliberately not its curvature. Dividing
// by the curvature reads 2 at every inflection, whatever the drawing does,
// because the two curvatures have opposite signs there and the ratio saturates.
// A score with no gradient at an inflection cannot tell the G2 fallback's answer
// from the drawing it started on, and reverts it.
//
function jointError(stencil, continuity) {
  const { incoming, outgoing } = stencil;
  const length =
    (distance(incoming[0], incoming[3]) + distance(outgoing[0], outgoing[3])) / 2;
  if (!length || !Number.isFinite(length)) {
    return 0;
  }

  const curvatureIn = curvatureAt(incoming, true);
  const curvatureOut = curvatureAt(outgoing, false);
  let error = Math.abs(curvatureIn - curvatureOut) * length;

  if (continuity === "G3") {
    const rateIn = curvatureRateAt(incoming, true);
    const rateOut = curvatureRateAt(outgoing, false);
    error += Math.abs(rateIn - rateOut) * length ** 2;
  }

  // G1 is the rung the other two stand on, so it is scored alongside them
  // rather than assumed. Every construction here moves points along the
  // tangent and so preserves it exactly -- but the answer is then rounded to
  // whole units, the next attempt re-reads the tangent from those rounded
  // handles, and the joint walks. Over 2000 well-formed random joints 22.5% of
  // them finished with a kink past what the grid can excuse, the worst of them
  // 21 degrees against an allowance of 2.1. Left out of the score, a bent joint
  // is simply invisible: the grid search will happily buy a smaller curvature
  // step with a crease, and the best-state gate has no reason to refuse it.
  error += jointKink(incoming[2], incoming[3], outgoing[1]);

  // Infinity, and deliberately not zero.
  //
  // A joint whose handle has collapsed onto its on-curve point has no defined
  // curvature, and reading that as zero error made it the best answer available
  // -- so the grid search went looking for cusps, because they scored perfect.
  // On one joint in 2000 it found one: it put the handle exactly on the node
  // and every measurement in this file agreed that was an improvement.
  //
  // Infinity is the honest reading and it also ranks correctly: no state with
  // one can beat a state without, and a drawing that arrives degenerate can
  // still be improved, because a finite candidate beats an infinite incumbent.
  return Number.isFinite(error) ? error : Infinity;
}

//
// The angle in radians between the two handles meeting at a joint. Zero exactly
// when the joint is G1.
//
// Radians are the right unit and not a weight chosen to taste: curvature times
// length is the angle a segment turns through over that length, so |dk| * L is
// already an angle, and |dr| * L^2 with it. All three terms are the same
// quantity and the total is their sum.
//
// The most a whole-unit grid can bend a joint that is exactly straight. Each of
// the three points can land half a unit off along each axis, so sqrt(2)/2 in
// any direction; a handle has such a point at each end, so its direction can
// swing by atan(sqrt(2) / its own length), and the two handles' swings add. A
// bend inside this is the price of the document's coordinate space. A bend past
// it was chosen, and this module does not get to choose it.
function gridKinkAllowance(P, node, N) {
  const reach = Math.SQRT2;
  return (
    Math.atan(reach / Math.max(distance(P, node), reach)) +
    Math.atan(reach / Math.max(distance(node, N), reach))
  );
}

// The joint's curvature discontinuity as a fraction of its own curvature --
// which is exactly the step a designer sees in the curvature comb, the fringe
// on one side against the fringe on the other.
//
// This normalisation saturates at 2 across an inflection, where the two
// curvatures have opposite signs. That makes it useless as a gradient, which is
// why the residual does not use it. As a threshold it is fine: an inflection
// reads 200%, the drawing it arrived as reads 200% too, and the ceiling below
// simply does not bind.
function relativeCurvatureStep(path, ctx) {
  const stencil = jointStencil(path, ctx);
  if (!stencil) {
    return 0;
  }
  const inside = curvatureAt(stencil.incoming, true);
  const outside = curvatureAt(stencil.outgoing, false);
  const scale = (Math.abs(inside) + Math.abs(outside)) / 2;
  if (!scale || !Number.isFinite(scale)) {
    return 0;
  }
  const step = Math.abs(inside - outside) / scale;
  return Number.isFinite(step) ? step : Infinity;
}

function jointKink(P, node, N) {
  const incoming = subVectors(node, P);
  const outgoing = subVectors(N, node);

  // A handle sitting on its own on-curve point has no direction, and atan2 of
  // two zeros is zero -- so a collapsed handle read as PERFECTLY smooth and won
  // this rank outright against any honest drawing with a kink in it. That is
  // how a joint that arrived 10.5 degrees out ended up with its handle written
  // exactly onto the node: the degenerate state was the only one scoring no
  // crease at all.
  if (!vectorLength(incoming) || !vectorLength(outgoing)) {
    return Infinity;
  }

  const kink = Math.atan2(
    Math.abs(crossProduct(incoming, outgoing)),
    dotVector(incoming, outgoing)
  );
  return Number.isFinite(kink) ? kink : Infinity;
}

//
// How far a drawing is from what the command is trying to reach, over the whole
// candidate set.
//
// Two numbers, ranked, not one. A handle past the tension ceiling and a crease
// at a smooth point are defects rather than trades, so any number of them
// outranks any amount of curvature discontinuity: nothing may be bought with
// one. Below that the residual is the sum of `jointError` over the joints.
//
// Both commands in this module score themselves with this, so "better" means
// the same thing to the grid search, to the best-state gate, and across the two
// of them.
//
function scoreJoints(path, candidates, continuity, limits, arrival) {
  let broken = 0;
  let crossed = 0;
  let creased = 0;
  let stepped = 0;
  let residual = 0;
  let unfair = 0;
  for (const pointIndex of candidates) {
    const ctx = getJointContext(path, pointIndex);
    if (ctx.reason) {
      // A joint that arrived readable and is not readable any more has been
      // destroyed, and skipping it here scored that as flawless -- it simply
      // stopped contributing. Every other rank agreed: a handle sitting on its
      // own on-curve point has no curvature to be discontinuous and no
      // direction to be bent. So the search could always improve its score by
      // collapsing a handle, and on one joint in 2000 it did exactly that.
      //
      // A joint that was already unreadable when the command was handed the
      // drawing is not this module's doing and is not counted.
      if (arrival?.has(pointIndex)) {
        broken += 1;
      }
      continue;
    }

    // Still readable, and still destroyed. A handle sitting on its own on-curve
    // point survives `getJointContext`, and then every rank below reads it as
    // flawless: no curvature to be discontinuous, no direction to be bent, and
    // no length to be over the tension ceiling. So it beat a drawing that
    // honestly reported a kink and a tight handle, and the search had a
    // standing incentive to collapse one.
    if (
      !vectorLength(subVectors(ctx.node, ctx.P)) ||
      !vectorLength(subVectors(ctx.node, ctx.N))
    ) {
      broken += 1;
      continue;
    }

    // G3 contains G2, so it may not be reached by giving G2 up.
    //
    // The two terms below are added, which lets the search pay for a better
    // rate with a worse curvature -- and where the drawing arrives with a large
    // rate error, that payment is cheap. Measured on `n` node 13 as it was
    // drawn: arriving at 0.35% curvature and 1920% rate, the whole-unit answer
    // the sum picked was 18.38% curvature and 70% rate, and the command called
    // it harmonized. An 18% step is a visible break in the comb. It is not a G3
    // answer, whatever its rate does -- and the same grid was offering 2.23% at
    // that joint, which the sum passed over.
    //
    // So the curvature step is capped, ranked above any amount of residual, at
    // the worse of the perceptual bound and what the drawing already had.
    const arrived = arrival?.get(pointIndex);
    if (arrived !== undefined) {
      const ceiling = Math.max(arrived, limits.maxCurvatureStep);
      if (relativeCurvatureStep(path, ctx) > ceiling) {
        stepped += 1;
      }
    }
    // The seven-point stencil where the joint has both of its segments, which
    // is what the rate needs. Where an open contour runs out before one of
    // them there is no rate to measure and the five-point curvature stands.
    const stencil = jointStencil(path, ctx);
    if (stencil) {
      // Both, and in this order of magnitude on purpose. Joint continuity is
      // held by the `stepped` rank above, which will not let a visible break
      // through whatever this says; below that line the curve decides. That is
      // the ordering the reported glyph settled: a hand-made answer at 0.72%
      // across the joint against a drawn 0.48% was the better curve by every
      // measure of shape, and the old score -- which was joint continuity and
      // nothing else -- reverted it as 1.5x worse.
      const length =
        (distance(stencil.incoming[0], stencil.incoming[3]) +
          distance(stencil.outgoing[0], stencil.outgoing[3])) /
        2;
      residual += jointError(stencil, continuity);
      unfair += jointUnfairness(stencil, length);
    } else {
      const discontinuity = measureG2Discontinuity(ctx);
      residual += Number.isFinite(discontinuity) ? discontinuity : 0;
    }
    // A crease at a smooth point is a defect and not a trade. Curvature
    // continuity across a joint that has no common tangent does not mean
    // anything, so no amount of it may buy a bend past what the grid can
    // excuse -- and the search will buy it, given the chance: on the worst of
    // 2000 random joints the residual fell from 31.7 to 1.1 while the joint
    // creased from 0.5 degrees to 13.1, one attempt at a time, and every step
    // of that scored as an improvement.
    if (jointKink(ctx.P, ctx.node, ctx.N) > gridKinkAllowance(ctx.P, ctx.node, ctx.N)) {
      creased += 1;
    }

    for (const { nearSide, indices } of jointSegments(path, ctx)) {
      if (
        handleTension(segmentPositions(path, indices), nearSide) >
        limits.maxHandleTension
      ) {
        crossed += 1;
      }
    }
  }
  //
  // Which of the two the caller is here for decides how they combine, and they
  // are not commensurable: bending energy runs twenty to fifty times the size
  // of the joint terms, so summing them is a decision about which one wins.
  //
  // Under G2 there is no rate to chase and the curve is the whole of the
  // answer, so the two are summed and the curve carries it -- which is what
  // lets a joint go from 0.48% to 0.72% in exchange for a curve worth having.
  //
  // Under G3 the caller has asked for the rate by name. It gets its own rank
  // and the curve ranks below it, breaking ties rather than outvoting it.
  // Folded together instead, the median rate step left behind on 500 random
  // joints with equalization on went from 8.4% to 20.3%: the rate term was
  // still in the sum and was simply too small to be heard.
  //
  return continuity === "G3"
    ? { broken, crossed, creased, stepped, residual, unfair }
    : { broken, crossed, creased, stepped, residual: residual + unfair, unfair: 0 };
}

// Ranked, and deliberately not added up.
//
// These are four different kinds of wrong and one number cannot hold them: when
// the crease count and the tension count shared a counter, a state that brought
// an over-tension handle back under the ceiling and cost a crease scored level
// with the drawing that had neither fixed, and the tie fell to the residual --
// so a handle whose lines crossed was left crossed. Each rank is a defect the
// one below it may not be traded for.
//
//   broken    a joint that arrived readable and can no longer be measured
//   crossed   a handle past its segment's Tunni point: the curve doubles back
//   creased   a smooth point that is not smooth, past what the grid can excuse
//   stepped   a curvature break the eye can see, so the answer is not G3
//   residual  how far the joint is from the condition, once all four hold
//   unfair    the bending energy of the curve either side, under G3 only --
//             under G2 it is folded into the residual instead, see below
//
const SCORE_RANKS = ["broken", "crossed", "creased", "stepped", "residual", "unfair"];

function isBetter(candidate, incumbent) {
  for (const rank of SCORE_RANKS) {
    if (candidate[rank] !== incumbent[rank]) {
      return candidate[rank] < incumbent[rank];
    }
  }
  return false;
}

//
// Signed curvature at parameter `t` of a cubic. The end values agree with
// `curvatureAt`; this one can be asked about the middle.
//
function curvatureAtParameter([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const first = {
    x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
    y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
  };
  const second = {
    x: 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
    y: 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
  };
  const speed = vectorLength(first);
  return speed ? crossProduct(first, second) / speed ** 3 : 0;
}

// How many places the comb is read at when judging a segment's shape. Fixed,
// like every other trip count here.
const COMB_SAMPLES = 20;

// A comb that slackens in the middle of a segment and tightens again at both
// ends. It is the defect a designer names first and it is invisible to every
// measurement above, all of which are taken AT the joint: a joint can be
// exactly G3 and sit at the top of a spike with a hollow behind it.
//
// Measured on `n` node 13: every position on the tangent from -30 to +20 units
// leaves the incoming segment notched, and the slide was stopping at +21
// because it ranked candidates on how well whole units hold the condition at
// the point. Five units further on the notch is gone.
//
function combHasNotch(points) {
  let lowest = Infinity;
  let lowestAt = 0;
  const samples = [];
  for (let i = 0; i <= COMB_SAMPLES; i++) {
    const value = Math.abs(curvatureAtParameter(points, i / COMB_SAMPLES));
    samples.push(value);
    if (value < lowest) {
      lowest = value;
      lowestAt = i;
    }
  }
  if (lowestAt < 2 || lowestAt > COMB_SAMPLES - 2) {
    return false;
  }
  // Below BOTH ends, and by enough that a flat comb does not register as one.
  return lowest < 0.99 * Math.min(samples[0], samples[COMB_SAMPLES]);
}

//
// The bending energy of one cubic: the integral of squared curvature along it.
//
// This is the classical measure of a fair curve, and it is the only thing in
// this module that reads the curve BETWEEN its on-curve points. Everything else
// is taken at the joint, which is why a joint could be exactly G2 while the
// segment behind it carried a lump six times its own curvature and every
// measurement here reported success.
//
// Integrated against arc length, not parameter, for the same reason the G3
// solve matches the arc-length rate: the parameter runs at different speeds
// through different parts of a segment and the eye does not.
//
function bendingEnergyOf(points) {
  let total = 0;
  let previous = null;
  for (let i = 0; i <= COMB_SAMPLES; i++) {
    const t = i / COMB_SAMPLES;
    const curvature = curvatureAtParameter(points, t);
    const speed = vectorLength(cubicVelocity(points, t));
    const value = curvature * curvature * speed;
    if (previous !== null) {
      total += (previous + value) / 2 / COMB_SAMPLES;
    }
    previous = value;
  }
  return Number.isFinite(total) ? total : Infinity;
}

function cubicVelocity([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return {
    x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
    y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
  };
}

//
// How unfair the curve either side of a joint is, made dimensionless by the
// joint's own size the same way the other terms are. Energy carries 1/length,
// so one factor of length does it.
//
function jointUnfairness(stencil, length) {
  if (!length || !Number.isFinite(length)) {
    return 0;
  }
  return (
    (bendingEnergyOf(stencil.incoming) + bendingEnergyOf(stencil.outgoing)) * length
  );
}

//
// One G3 attempt, with the joint at `nodePosition`. Returns the two inner
// handle positions, or null where the construction has no answer or the answer
// is outside the same two limits the G2 path obeys: the cusp floor on the
// handle that shrinks, and the tangent intersection on the handle that grows.
//
function g3Attempt(stencil, nodePosition, limits) {
  const [A, PP] = stencil.incoming;
  const [, , NN, C] = stencil.outgoing;
  const targets = calculateG3Targets(
    [A, PP, stencil.incoming[2], nodePosition],
    [nodePosition, stencil.outgoing[1], NN, C]
  );
  if (!targets) {
    return null;
  }
  if (
    distance(nodePosition, targets.P) < limits.floors.P ||
    distance(nodePosition, targets.N) < limits.floors.N
  ) {
    return null;
  }
  const solvedIn = [A, PP, targets.P, nodePosition];
  const solvedOut = [nodePosition, targets.N, NN, C];
  if (
    handleTension(solvedIn, "end") > limits.maxHandleTension ||
    handleTension(solvedOut, "start") > limits.maxHandleTension
  ) {
    return null;
  }
  return targets;
}

//
// Where the joint goes under G2 when it is allowed to move.
//
// There is a free parameter here and the module has never used it. The harmonic
// ratio depends only on the two outer handles' offsets from the tangent, and
// sliding the joint along that tangent changes neither -- so EVERY position on
// it is exactly as G2 as every other. The construction has nothing to say about
// which, the old score had nothing to say about which, and so the joint stayed
// where it was and the command reported that there was nothing to do. On the
// reported glyph a designer used exactly this freedom by hand, slid the joint
// 22 units, and got a visibly better curve without changing how G2 the joint
// was at all.
//
// What separates the positions is the shape of the curve either side, which
// `scoreJoints` now measures. So this walks the tangent, builds the answer at
// each whole unit, and asks the same question the caller will ask at the end.
//
// The construction at a given position: the harmonic target is a fixed point on
// the tangent, so placing the joint at `here` and moving both handles by
// `here - target` satisfies G2 there exactly. The two outer on-curve points do
// not move, so each position gives a genuinely different pair of segments.
//
function g2BestSlide(path, ctx, state, options) {
  const target = calculateHarmonicTarget(ctx);
  if (!target) {
    return null;
  }
  const axis = normalizeVector(subVectors(ctx.N, ctx.P));
  if (!vectorLength(axis)) {
    return null;
  }
  const segments = jointSegments(path, ctx);
  if (segments.length < 2) {
    return null;
  }
  const [A] = segmentPositions(path, segments[0].indices);
  const C = segmentPositions(path, segments[1].indices)[3];

  const along = (point) => dotVector(subVectors(point, ctx.node), axis);
  const room = { "1": Math.max(0, along(C)), "-1": Math.max(0, -along(A)) };
  const reach = Math.max(room[1], room["-1"]);
  const step = Math.max(1, reach / G3_SLIDE_SAMPLES);
  const place = options.roundCoordinates
    ? (point) => ({ x: Math.round(point.x), y: Math.round(point.y) })
    : (point) => point;

  let best = null;
  const consider = (slide) => {
    const here = addVectors(ctx.node, mulVectorScalar(axis, slide));
    const shift = subVectors(here, target.target);
    const P = addVectors(ctx.P, shift);
    const N = addVectors(ctx.N, shift);
    if (distance(here, P) < state.floors.P || distance(here, N) < state.floors.N) {
      return;
    }
    const node = place(here);
    const stencil = {
      incoming: [A, ctx.PP, place(P), node],
      outgoing: [node, place(N), ctx.NN, C],
    };
    if (
      handleTension(stencil.incoming, "end") > options.maxHandleTension ||
      handleTension(stencil.outgoing, "start") > options.maxHandleTension
    ) {
      return;
    }
    const length =
      (distance(stencil.incoming[0], stencil.incoming[3]) +
        distance(stencil.outgoing[0], stencil.outgoing[3])) /
      2;
    const error = jointError(stencil, "G2") + jointUnfairness(stencil, length);
    const travel = Math.abs(slide);
    if (
      !best ||
      error < best.error - GRID_TIE_UNITS ||
      (error < best.error + GRID_TIE_UNITS && travel < best.travel)
    ) {
      best = { error, travel, node: here, P, N };
    }
  };

  consider(along(target.target));
  for (let sample = 0; sample <= G3_SLIDE_SAMPLES; sample++) {
    const slide = sample * step;
    for (const direction of [1, -1]) {
      if (slide <= room[direction]) {
        consider(direction * slide);
      }
    }
  }
  return best;
}

//
// The answer with the joint held where it is, in the shape the caller consumes.
//
function g3HeldSolve(stencil, limits) {
  const targets = g3Attempt(stencil, stencil.incoming[3], limits);
  return targets ? { node: null, targets } : null;
}

//
// Where the joint goes when it is allowed to move.
//
// The G3 construction is exact at EVERY admissible position on the tangent, so
// in exact arithmetic there is nothing to choose between them and the joint
// would never have a reason to move. What separates them is the grid: the
// command's answer lands on whole units, and how much of the exact answer
// survives that depends on where the joint sits. Measured on the outer arch of
// `n`, held at its drawn position the best whole-unit joint available is a 15.6%
// rate step; two units along the tangent it is 1.2%, and five units 0.51%.
//
// So each candidate is judged as it will be EMITTED, on the grid, which is the
// same rule the offset construction arrived at for its own candidates. The
// bracket search in `snapToGrid` polishes the winner afterwards; this stage only
// has to pick the position.
//
// Sampling is at whole units along the tangent, because that is the resolution
// the answer is stored at, with a fixed cap so a long range cannot buy itself
// more search. A search that picks its own trip count cannot be continuous in
// its input.
//
function g3BestSlide(stencil, limits, continuity, snapToWholeUnits) {
  const node = stencil.incoming[3];
  const span = subVectors(stencil.outgoing[1], stencil.incoming[2]);
  if (!vectorLength(span)) {
    return null;
  }
  const axis = normalizeVector(span);
  // The joint may travel as far as the on-curve point at the far end of either
  // of its two segments, measured along the tangent. Past that it has left the
  // segment it belongs to. The two directions have their own room.
  const along = (point) => dotVector(subVectors(point, node), axis);
  const room = {
    "1": Math.max(0, along(stencil.outgoing[3])),
    "-1": Math.max(0, -along(stencil.incoming[0])),
  };
  const reach = Math.max(room[1], room["-1"]);
  const step = Math.max(1, reach / G3_SLIDE_SAMPLES);
  const at = (slide) => addVectors(node, mulVectorScalar(axis, slide));

  // As it will be emitted. Where the caller is not rounding, that is the exact
  // answer, which is exactly G3 at every admissible position — so nothing
  // separates them, the tie-break takes over and the joint stays where it is.
  const place = snapToWholeUnits
    ? (point) => ({ x: Math.round(point.x), y: Math.round(point.y) })
    : (point) => point;
  const [A, PP] = stencil.incoming;
  const [, , NN, C] = stencil.outgoing;

  // The same question the caller asks at the end, and not a smaller one. Judged
  // on the joint alone, this search walked a node 221 units down its tangent on
  // one of 2000 random joints -- taking the incoming chord from 238 units to 46
  // -- because the joint it left there was fractionally more exact. The curve
  // it left behind carried 450,000 times the bending energy it started with.
  const errorAsEmitted = (nodePosition, targets) => {
    const placed = place(nodePosition);
    const stencil = {
      incoming: [A, PP, place(targets.P), placed],
      outgoing: [placed, place(targets.N), NN, C],
    };
    const length =
      (distance(stencil.incoming[0], stencil.incoming[3]) +
        distance(stencil.outgoing[0], stencil.outgoing[3])) /
      2;
    // Same split as `scoreJoints`: under G3 the rate leads and the curve breaks
    // ties, so the two are returned separately rather than added.
    const error = jointError(stencil, continuity);
    const unfairness = jointUnfairness(stencil, length);
    return continuity === "G3"
      ? { error, unfairness }
      : { error: error + unfairness, unfairness: 0 };
  };

  let best = null;
  const consider = (slide) => {
    const nodePosition = at(slide);
    const targets = g3Attempt(stencil, nodePosition, limits);
    if (!targets) {
      return;
    }
    const { error, unfairness } = errorAsEmitted(nodePosition, targets);
    const travel = Math.abs(slide);

    // The shape of the comb across both segments, ranked ahead of how exactly
    // the grid holds the condition at the joint. A notch is a defect the eye
    // reads immediately; a fraction of a per cent at the point is not visible
    // at all. Ranked and not added, for the same reason the score above ranks:
    // they are different kinds of wrong.
    const placed = place(nodePosition);
    const notched =
      (combHasNotch([A, PP, place(targets.P), placed]) ? 1 : 0) +
      (combHasNotch([placed, place(targets.N), NN, C]) ? 1 : 0);

    // Least notched, then least error, and where two positions are equally good
    // the one that moves the joint least -- so a joint already standing at the
    // best place stays.
    const ranked = [notched, error, unfairness, travel];
    const better =
      !best ||
      (() => {
        for (let i = 0; i < ranked.length; i++) {
          const tolerance = i === 3 ? 0 : GRID_TIE_UNITS;
          if (ranked[i] < best.ranked[i] - tolerance) {
            return true;
          }
          if (ranked[i] > best.ranked[i] + tolerance) {
            return false;
          }
        }
        return false;
      })();
    if (better) {
      best = { ranked, travel, node: nodePosition, targets };
    }
  };

  consider(0);
  for (let sample = 1; sample <= G3_SLIDE_SAMPLES; sample++) {
    const slide = sample * step;
    for (const direction of [1, -1]) {
      if (slide <= room[direction]) {
        consider(direction * slide);
      }
    }
  }

  if (!best) {
    return null;
  }
  return { node: best.travel ? best.node : null, targets: best.targets };
}

//
// Pull the joint's own handles back to the ceiling if they are already over it.
//
// A handle past its Tunni point is a defect, not a style: the segment's two
// handle lines have crossed and the curve doubles back. Harmonization slides
// along the tangent and cannot always undo that on its own, so an over-tension
// handle is shortened first — straight down its own direction, which leaves the
// tangent and therefore G1 untouched.
//
// Returns true when something was shortened.
//
function enforceHandleTension(path, ctx, maxHandleTension, touched) {
  let reduced = false;

  for (const { nearSide, indices } of jointSegments(path, ctx)) {
    const points = segmentPositions(path, indices);
    if (handleTension(points, nearSide) <= maxHandleTension) {
      continue;
    }

    const [onCurve, handle, handleIndex] =
      nearSide === "start"
        ? [points[0], points[1], indices[1]]
        : [points[3], points[2], indices[2]];
    const tunniPoint = calculateTunniPoint(points);
    const toHandle = subVectors(handle, onCurve);
    const toTunni = subVectors(tunniPoint, onCurve);

    // Only meaningful when the handle actually points at the Tunni point. If it
    // points away, the ratio is not an overshoot and shortening would be a
    // guess about a differently-broken segment.
    if (dotVector(toHandle, toTunni) <= 0) {
      continue;
    }

    const reach = maxHandleTension * vectorLength(toTunni);
    const shortened = addVectors(
      onCurve,
      mulVectorScalar(normalizeVector(toHandle), reach)
    );
    writePoint(path, touched, handleIndex, shortened);
    reduced = true;
  }

  return reduced;
}

//
// Tunni-equalize the two segments meeting at a joint.
//
// This is the one thing that moves the *outer* handles, PP and NN, which belong
// to the neighbouring segments. The G2 construction itself never does: PP and NN
// are inputs to the curvature at the joint, not outputs.
//
// SuperTool's Harmonize menu command brackets its per-node harmonize with
// `[self balance]` (SuperTool+Harmonize.m:61,75), so this is donor behaviour —
// but note the donor's trailing balance changes handle lengths after the fact,
// which perturbs the very curvature match harmonization just established. Off
// by default for that reason; see HARMONIZE_DEFAULTS.equalizeTension.
//
function equalizeJointSegments(path, ctx, touched) {
  for (const { indices } of jointSegments(path, ctx)) {
    const points = segmentPositions(path, indices);

    // The donor skips inflected segments, where equalizing would fight the
    // shape rather than tidy it (SuperTool+TunniEditing.m:198-199).
    const startTension = handleTension(points, "start");
    const endTension = handleTension(points, "end");
    if (!startTension && !endTension) {
      continue;
    }
    if (startTension > 1 && endTension > 1) {
      continue;
    }
    if (startTension < 0.01 && endTension < 0.01) {
      continue;
    }

    const balanced = balanceSegment(points);
    for (const i of [1, 2]) {
      writePoint(path, touched, indices[i], balanced[i]);
    }
  }
}

function applyFixup(path, ctx, fixup, handleBias, touched) {
  if (handleBias < 1) {
    const delta = mulVectorScalar(fixup, -(1 - handleBias));
    const node = addVectors(ctx.node, delta);
    writePoint(path, touched, ctx.pointIndex, node);
  }
  if (handleBias > 0) {
    const delta = mulVectorScalar(fixup, handleBias);
    for (const name of ["P", "N"]) {
      const handle = addVectors(ctx[name], delta);
      writePoint(path, touched, ctx.indices[name], handle);
    }
  }
}

//
// Harmonize the given joints. `pointIndices` is the exact candidate set —
// callers that start from a UI selection run it through `expandToJoints` first
// and drop whatever they refuse (see the generated-contour guard in
// scene-controller.js). An empty or absent set means the whole path.
//
// Returns a new path plus a report entry per candidate:
//
//     {pointIndex, contourIndex, status, reason, iterations}
//
//     status  harmonized | partial | skipped
//     reason  clamped | tension-limited | not-converged   (partial)
//             not-smooth | not-curve-joint | degenerate
//             | already-harmonic                          (skipped)
//
// A joint's verdict is read at the end of the sweep and not during it. Every
// joint on a closed contour shares a segment with the two beside it, so a joint
// that has nothing left to correct can be moved off again by a neighbour on a
// later pass. Nothing is finished until the whole set is quiet.
//
// Total: no geometric situation throws.
//
// Pure wrapper around `harmonizePathInPlace` — see there for why the editor
// uses the in-place form instead.
//
export function harmonizePath(path, pointIndices, options = {}) {
  const newPath = path.copy();
  return {
    path: newPath,
    report: harmonizePathInPlace(newPath, pointIndices, options),
  };
}

//
// Same, but writes into `path` and returns only the report.
//
// This is what the editor calls. Every write goes through `setPointPosition`,
// which the change recorder proxies into a fine-grained `=xy` change with a
// matching rollback. Building a new path and assigning it to `layerGlyph.path`
// instead would put a live VarPackedPath into the change payload, and what
// comes back out the other side is a plain object with plain arrays — which
// then fails interpolation with `coordinates.addItemwise is not a function`.
//
// How many times the sweep may be run and rounded before it gives up on
// reaching a whole-unit answer that stays put. Each attempt starts from the
// rounded geometry the previous one produced, and the loop stops as soon as a
// state comes round a second time — which on almost every drawing is the second
// attempt. The budget only matters where the grid and the handle limits push
// the geometry round a long orbit: over 400 random rings it takes 11 of them
// out of the 0.5 per cent that still move after one call at a budget of 12.
const ROUNDING_SETTLE_ATTEMPTS = 40;

// How many times the grid search sweeps the points it may move. Fixed, not
// chosen: a search that decides its own trip count cannot be continuous in its
// input. Three is one pass to place every point and two to let them answer each
// other; the reported joint settles on the first.
const GRID_SEARCH_PASSES = 3;

//
// Put the answer on the grid, choosing the whole-unit position rather than
// taking the nearest one.
//
// The sweep settles on fractional coordinates and the document wants whole
// units. Rounding each coordinate to its own nearest unit looks like the
// obvious way to get there and is not, because harmonization does not state a
// pair of positions — it states a RATIO between the two handles either side of
// the joint. Curvature at a cubic's end goes as the outer handle's offset over
// the square of the inner handle's length, so the whole correction lives in
// that ratio, and rounding the two ends independently can put it back exactly
// where it started.
//
// Measured on the arch joint of `n`: the exact answer is a move of 0.344 units,
// which takes a 3.156% curvature mismatch to zero. Rounded to the nearest unit
// the mismatch comes back at 3.537% — worse than the drawing, and the
// best-state gate then reverts the lot, which is why the command wrote nothing
// and still reported success. One unit away sits a whole-unit state at 0.430%.
//
// So: snap to the nearest position, then let each moved point try the
// whole-unit positions bracketing its own exact answer, keeping whatever scores
// best. The starting drawing is still a candidate through the caller's own
// best-state gate, so a command that can only make things worse leaves the
// drawing alone.
//
function snapToGrid(path, touched, jointResidual, isBetter) {
  const exact = new Map();
  for (const index of touched) {
    const [x, y] = path.getPointPosition(index);
    exact.set(index, { x, y });
    path.setPointPosition(index, Math.round(x), Math.round(y));
  }

  const indices = [...touched].sort((a, b) => a - b);
  let best = jointResidual();

  for (let pass = 0; pass < GRID_SEARCH_PASSES; pass++) {
    let improved = false;
    for (const index of indices) {
      const { x, y } = exact.get(index);
      const [heldX, heldY] = path.getPointPosition(index);
      let chosenX = heldX;
      let chosenY = heldY;
      for (const candidateX of [Math.floor(x), Math.ceil(x)]) {
        for (const candidateY of [Math.floor(y), Math.ceil(y)]) {
          if (candidateX === chosenX && candidateY === chosenY) {
            continue;
          }
          path.setPointPosition(index, candidateX, candidateY);
          const score = jointResidual();
          if (isBetter(score, best)) {
            best = score;
            chosenX = candidateX;
            chosenY = candidateY;
            improved = true;
          }
        }
      }
      path.setPointPosition(index, chosenX, chosenY);
    }
    if (!improved) {
      break;
    }
  }
}

export function harmonizePathInPlace(path, pointIndices, options = {}) {
  // One entry point, two constructions. Dispatching here rather than at each
  // call site is what lets the editor, the skeleton panel and the tests all
  // reach the second one by passing an option along with the rest.
  if (options.handlesOnly) {
    return harmonizeHandlesInPlace(path, pointIndices, options);
  }

  const {
    continuity,
    slideOnCurve,
    handleBias: rawHandleBias,
    cuspSafetyMargin,
    toleranceUnits,
    maxIterations,
    equalizeTension,
    maxHandleTension,
    maxCurvatureStep,
    roundCoordinates,
  } = {
    ...HARMONIZE_DEFAULTS,
    ...options,
  };

  const touched = new Set();

  // The bias decides which points move at all, so a value that is a string, out
  // of range, or NaN must not silently land in the middle and move everything.
  // null and undefined mean "not set", not zero — Number(null) is 0, which
  // would silently select the point-moves-instead mode.
  const numericBias = rawHandleBias == null ? NaN : Number(rawHandleBias);
  const handleBias = Number.isFinite(numericBias)
    ? Math.min(1, Math.max(0, numericBias))
    : HARMONIZE_DEFAULTS.handleBias;

  const candidates = pointIndices?.length
    ? [...new Set(pointIndices)].sort((a, b) => a - b)
    : expandToJoints(path, undefined);

  // The whole thing may have to run more than once, and only because of the
  // grid. The sweep settles on fractional coordinates. Rounding them to whole
  // units is a nudge the sweep never saw, and from the rounded geometry there
  // is a real correction to make again. Running it here is what the user used
  // to do by pressing the button again.
  //
  // Rounding is still applied once per attempt and never inside the sweep: a
  // residual that is rounded mid-sweep sits permanently above the convergence
  // tolerance and nothing ever settles.
  //
  // Rounding can also put the geometry into a short cycle rather than onto a
  // fixed point: attempt A rounds to B, and B rounds back to A. Every state the
  // loop lands on is kept, the loop stops the moment one comes round again, and
  // the best of them is what the command leaves behind. Picking the best of a
  // cycle deterministically is what makes running the command twice a no-op.
  //
  const attempts = roundCoordinates ? ROUNDING_SETTLE_ATTEMPTS : 1;
  const seen = new Set();
  let states = [];
  let best = null;
  let bestStates = null;

  // How far the drawing is from what the command is trying to reach. A handle
  // over the tension ceiling is a defect and not a trade, so any number of them
  // outranks any amount of curvature discontinuity.
  // What each joint's curvature discontinuity was when the command was handed
  // the drawing. Captured once, before anything moves, because it is a ceiling
  // on the answer and not a running measurement.
  const arrivalCurvature = new Map();
  for (const pointIndex of candidates) {
    const ctx = getJointContext(path, pointIndex);
    if (!ctx.reason) {
      arrivalCurvature.set(pointIndex, relativeCurvatureStep(path, ctx));
    }
  }

  const scoreLimits = { maxHandleTension, maxCurvatureStep };
  const jointResidual = () =>
    scoreJoints(path, candidates, continuity, scoreLimits, arrivalCurvature);

  // The drawing exactly as it arrived. The verdict at the end is read against
  // this, so a joint can only be called harmonized if something actually moved.
  const original = Array.from(path.coordinates);

  best = { score: jointResidual(), coordinates: Array.from(path.coordinates) };

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (equalizeTension) {
      // donor order: balance, harmonize, balance (SuperTool+Harmonize.m:61,75)
      for (const pointIndex of candidates) {
        const ctx = getJointContext(path, pointIndex);
        if (!ctx.reason) {
          equalizeJointSegments(path, ctx, touched);
        }
      }
    }

    states = candidates.map((pointIndex) => {
      const state = {
        pointIndex,
        contourIndex: path.getContourIndex(pointIndex),
        status: undefined,
        reason: undefined,
        iterations: 0,
        floors: undefined,
        segments: [],
        tensionReduced: false,
        everMoved: false,
        quiet: false,
        tensionLimited: false,
        clamped: false,
        construction: "g2",
        mode: continuity === "G3" ? "g3" : "g2",
        done: false,
      };

      let ctx = getJointContext(path, pointIndex);
      if (ctx.reason) {
        return state;
      }

      // An over-tension handle is a defect to correct, not a state to preserve:
      // shorten it back to the ceiling first, so the sweep starts from a joint
      // whose handle lines do not cross.
      state.tensionReduced = enforceHandleTension(path, ctx, maxHandleTension, touched);
      if (state.tensionReduced) {
        ctx = getJointContext(path, pointIndex);
      }

      state.segments = jointSegments(path, ctx);
      // A handle may never end up shorter than this, however many passes it takes
      // and however many times the command is run.
      state.floors = cuspFloors(path, ctx, state.segments, cuspSafetyMargin);
      return state;
    });

    function settle(state, status, reason) {
      state.status = status;
      state.reason = reason;
      state.done = true;
    }

    for (let pass = 0; pass < maxIterations; pass++) {
      let anyMoved = false;

      for (const state of states) {
        if (state.done) {
          continue;
        }

        let ctx = getJointContext(path, state.pointIndex);
        if (ctx.reason) {
          settle(state, "skipped", ctx.reason);
          continue;
        }

        // The ceiling is enforced on every pass, not only at setup. Each joint
        // limits its own step, but the handle it shortens belongs to a segment
        // the next joint along shares, so a neighbour's step can push it back
        // over. Left until the next call, that one over-tension handle blocked
        // this joint for the rest of the sweep and then released a large move as
        // soon as the command was run again.
        if (enforceHandleTension(path, ctx, maxHandleTension, touched)) {
          state.tensionReduced = true;
          state.quiet = false;
          anyMoved = true;
          ctx = getJointContext(path, state.pointIndex);
          if (ctx.reason) {
            settle(state, "skipped", ctx.reason);
            continue;
          }
        }

        if (state.mode === "g3") {
          const stencil = jointStencil(path, ctx);
          const limits = { floors: state.floors, maxHandleTension };
          let outcome = null;
          if (stencil) {
            // The slide is opt-in, and when it is on it is the whole search:
            // every admissible position on the tangent including the one the
            // joint already holds. It is not a fallback for when holding the
            // joint still fails, because holding it still almost never fails —
            // so as a fallback the option did nothing on any healthy joint.
            outcome = slideOnCurve
              ? g3BestSlide(stencil, limits, continuity, roundCoordinates)
              : g3HeldSolve(stencil, limits);
          }
          if (outcome) {
            const movement = Math.max(
              distance(outcome.targets.P, ctx.P),
              distance(outcome.targets.N, ctx.N),
              outcome.node ? distance(outcome.node, ctx.node) : 0
            );
            if (movement < toleranceUnits) {
              state.quiet = true;
              continue;
            }
            state.quiet = false;
            if (outcome.node) {
              writePoint(path, touched, state.pointIndex, outcome.node);
            }
            writePoint(path, touched, ctx.indices.P, outcome.targets.P);
            writePoint(path, touched, ctx.indices.N, outcome.targets.N);
            state.construction = "g3";
            state.iterations += 1;
            anyMoved = true;
            continue;
          }
          // No admissible answer here. G2 is the rung below, and it starts from
          // the geometry as it stands rather than from anything G3 attempted.
          state.mode = "g2";
        }

        // Opt-in, and when it is on it is the whole search -- the same rule the
        // G3 slide arrived at. Under G2 the bias has nothing left to decide,
        // because the search chooses where the joint goes outright.
        if (slideOnCurve) {
          const slid = g2BestSlide(path, ctx, state, {
            roundCoordinates,
            maxHandleTension,
          });
          if (slid) {
            const movement = Math.max(
              distance(slid.node, ctx.node),
              distance(slid.P, ctx.P),
              distance(slid.N, ctx.N)
            );
            if (movement < toleranceUnits) {
              state.quiet = true;
              continue;
            }
            state.quiet = false;
            writePoint(path, touched, state.pointIndex, slid.node);
            writePoint(path, touched, ctx.indices.P, slid.P);
            writePoint(path, touched, ctx.indices.N, slid.N);
            state.iterations += 1;
            anyMoved = true;
            continue;
          }
        }

        const solution = calculateHarmonicTarget(ctx);
        if (!solution) {
          settle(state, "skipped", "degenerate");
          continue;
        }

        const fixupLength = vectorLength(solution.fixup);
        if (fixupLength < toleranceUnits) {
          state.quiet = true;
          continue;
        }
        state.quiet = false;

        // The node and the handles always end up `fixup` apart no matter how the
        // bias splits the motion, so one handle grows and the other shrinks by
        // exactly |fixup|. Scale the whole step back if that would take the
        // shrinking one past its floor.
        let scale = 1;
        for (const name of ["P", "N"]) {
          const length = distance(ctx.node, ctx[name]);
          const shrunk = distance(ctx.node, addVectors(ctx[name], solution.fixup));
          if (shrunk < state.floors[name]) {
            scale = Math.min(scale, (length - state.floors[name]) / fixupLength);
          }
        }
        const clamped = scale < 1;
        scale = Math.max(scale, 0);

        // Second limit, on the handle that *grows*: never let it reach past its
        // segment's Tunni point, where the segment's two handle lines cross each
        // other. The tension is monotone in the step size, so bisect for the
        // largest admissible step rather than case-analysing the sign.
        let tensionLimited = false;
        if (
          scale > 0 &&
          tensionAfterStep(
            path,
            ctx,
            state.segments,
            mulVectorScalar(solution.fixup, scale),
            handleBias
          ) > maxHandleTension
        ) {
          let low = 0;
          let high = scale;
          for (let step = 0; step < 24; step++) {
            const mid = (low + high) / 2;
            const tension = tensionAfterStep(
              path,
              ctx,
              state.segments,
              mulVectorScalar(solution.fixup, mid),
              handleBias
            );
            if (tension > maxHandleTension) {
              high = mid;
            } else {
              low = mid;
            }
          }
          scale = low;
          tensionLimited = true;
        }

        if (scale > 0) {
          applyFixup(
            path,
            ctx,
            mulVectorScalar(solution.fixup, scale),
            handleBias,
            touched
          );
          state.iterations += 1;
          anyMoved = true;
        }
        // A limit shortens this step. It does not finish the joint: the next
        // pass measures the limit again from where the step landed, and there is
        // usually more room there. Settling here took one scaled-back step and
        // stopped, which is why running the command again used to keep helping.
        state.tensionLimited = state.tensionLimited || tensionLimited;
        state.clamped = state.clamped || clamped;
      }

      if (!anyMoved) {
        break;
      }
    }

    // The sweep is over. A joint that was quiet on the last pass is finished,
    // whatever it ran into on the way, because quiet means its own correction is
    // now under the tolerance.
    for (const state of states) {
      if (state.done) {
        continue;
      }
      if (state.quiet) {
        if (state.iterations) {
          settle(state, "harmonized", undefined);
        } else {
          settle(state, "skipped", "already-harmonic");
        }
      } else if (state.tensionLimited) {
        settle(state, "partial", "tension-limited");
      } else if (state.clamped) {
        settle(state, "partial", "clamped");
      } else {
        settle(state, "partial", "not-converged");
      }
    }

    if (equalizeTension) {
      for (const state of states) {
        if (state.status === "skipped") {
          continue;
        }
        const ctx = getJointContext(path, state.pointIndex);
        if (!ctx.reason) {
          equalizeJointSegments(path, ctx, touched);
          // balance averages the two tensions of a segment, and that average can
          // itself land above the ceiling — so the invariant is re-established
          // here rather than assumed to have survived
          state.tensionReduced =
            enforceHandleTension(
              path,
              getJointContext(path, state.pointIndex),
              maxHandleTension,
              touched
            ) || state.tensionReduced;
        }
      }
    }

    if (roundCoordinates) {
      // Once, at the end, and only on points this operation moved. Rounding
      // during the sweep would put the residual permanently above the
      // convergence tolerance, so nothing would ever settle.
      snapToGrid(path, touched, jointResidual, isBetter);
    }

    const coordinates = Array.from(path.coordinates);

    // Per joint, whether ANY attempt ever put it somewhere else -- which is
    // what separates "the correction was smaller than the grid can hold" from
    // "an answer was drawn and the drawing beat it". Recorded here, before the
    // best-state gate below can put the drawing back.
    for (const state of states) {
      if (state.everMoved) {
        continue;
      }
      const ctx = getJointContext(path, state.pointIndex);
      const stencil = ctx.reason
        ? [state.pointIndex]
        : [state.pointIndex, ...Object.values(ctx.indices)];
      state.everMoved = stencil.some(
        (index) =>
          original[index * 2] !== coordinates[index * 2] ||
          original[index * 2 + 1] !== coordinates[index * 2 + 1]
      );
    }

    const score = jointResidual();
    if (isBetter(score, best.score)) {
      best = { score, coordinates };
      bestStates = states;
    }
    const key = coordinates.join(",");
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
  }

  // Put the best state back if the loop wandered off it. The geometry the
  // command was handed counts as one of the candidates, so a command that can
  // only make things worse leaves the drawing alone — which is what makes
  // running it a second time do nothing.
  states = bestStates ?? states;
  for (let index = 0; index < path.numPoints; index++) {
    const [x, y] = path.getPointPosition(index);
    const bestX = best.coordinates[index * 2];
    const bestY = best.coordinates[index * 2 + 1];
    if (bestX !== x || bestY !== y) {
      path.setPointPosition(index, bestX, bestY);
      touched.add(index);
    }
  }

  // A verdict describes the drawing that was kept, never one that was computed
  // and then dropped. The sweep works in floats and the answer has to land on
  // the grid, so a joint can converge exactly and still have nothing to write:
  // its correction was smaller than the grid can hold, and the whole-unit
  // position it already sits on is the best one available. That is a real
  // outcome and the report has to say so, rather than claiming success on a
  // drawing it did not change.
  //
  // `partial` is read here as well as `harmonized`. A clamped or unconverged
  // answer can be reverted whole by the gate -- a handle at its cusp floor
  // carries a spike the fairness term reads as the worse curve -- and it used
  // to go on reporting `partial/clamped` about a drawing nothing had touched.
  //
  // Two ways to end up unchanged and they are not the same news. `below-grid`
  // means the correction was real and smaller than a whole unit, so the
  // position the joint already sits on is the best one available. `reverted`
  // means an answer was drawn, on the grid, and the drawing scored better than
  // it -- which is the one a designer needs to see, because it says the command
  // looked and decided against, not that it had nothing to do.
  //
  for (const state of states) {
    if (state.status !== "harmonized" && state.status !== "partial") {
      continue;
    }
    const ctx = getJointContext(path, state.pointIndex);
    const stencil = ctx.reason
      ? [state.pointIndex]
      : [state.pointIndex, ...Object.values(ctx.indices)];
    const moved = stencil.some((index) => {
      const [x, y] = path.getPointPosition(index);
      return original[index * 2] !== x || original[index * 2 + 1] !== y;
    });
    if (!moved) {
      state.status = "skipped";
      state.reason = state.everMoved ? "reverted" : "below-grid";
    }
  }

  return states.map(
    ({
      pointIndex,
      contourIndex,
      status,
      reason,
      iterations,
      tensionReduced,
      construction,
    }) => ({
      pointIndex,
      contourIndex,
      status,
      reason,
      iterations,
      tensionReduced,
      construction,
    })
  );
}

// --- the donors' other command: harmonize by handle LENGTH -------------------
//
// Everything above answers "fix this joint": it takes one smooth point and
// slides something along its tangent until the two sides agree there. Curvatura
// ships a second command that answers a different question -- "make these
// curves harmonious" -- and it is not a variation on the first
// (_external/curvatura/Curvatura.py:519, `harmonizehandles_contour`).
//
// It works in two halves:
//
//   1. Every selected node is given a TARGET curvature: the mean of the two
//      magnitudes it currently has, one on each side, with each side keeping
//      its own sign. At an inflection, where the two signs disagree, there is
//      no magnitude they can share and the target is zero -- which is what an
//      inflection ought to be anyway.
//
//   2. Every segment then has BOTH of its handle lengths solved so that it
//      reaches its own two ends' targets. Two unknowns, two equations, and no
//      choice left to make: `scaleHandles` below.
//
// Two things follow from that, and they are why the port is worth having. The
// handles keep their DIRECTIONS, so this construction cannot bend a joint --
// G1 holds by the shape of the answer rather than by a check. And because the
// target is shared between the two sides of a node instead of derived from one
// of them, a whole run of segments is pulled onto one curvature profile at
// once, rather than each joint being repaired against whatever its neighbour
// happens to be doing at the time.
//
// The price is that a node's target depends on its neighbours' curvature, which
// the previous round has just changed, so it takes the donor's five rounds to
// settle rather than converging on its own.
//

//
// The real roots of a polynomial of degree at most four, highest power first.
//
// The donor runs Newton from zero and divides out each root it finds
// (Curvatura.py:145). Deflation folds the error of every root already found
// into the next one, and Newton from a fixed start reaches whichever root it
// reaches -- on a quartic with two admissible roots there is no telling which,
// and the caller is choosing between them by bending energy. So the roots are
// bracketed instead. Between two consecutive turning points a polynomial is
// monotone and holds at most one root, so the derivative's roots plus a bound
// on the root radius cut the line into intervals that bisection resolves
// exactly. No starting guess, a fixed trip count, and either every real root or
// none.
//
function realRoots(coefficients) {
  const poly = [...coefficients];
  while (poly.length && !poly[0]) {
    poly.shift();
  }
  if (poly.some((value) => !Number.isFinite(value))) {
    return [];
  }
  const degree = poly.length - 1;
  if (degree < 1) {
    return [];
  }
  if (degree === 1) {
    return [-poly[1] / poly[0]];
  }
  if (degree === 2) {
    const [a, b, c] = poly;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return [];
    }
    if (!discriminant) {
      return [-b / (2 * a)];
    }
    // The pair that does not cancel: one root from the formula, the other from
    // the product of the two.
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(discriminant));
    return [q / a, c / q].sort((x, y) => x - y);
  }

  const bound =
    1 + Math.max(...poly.slice(1).map((value) => Math.abs(value / poly[0])));
  const turning = realRoots(derivePolynomial(poly)).filter(
    (value) => value > -bound && value < bound
  );
  const knots = [-bound, ...turning, bound].sort((x, y) => x - y);

  const roots = [];
  const keep = (root) => {
    if (Number.isFinite(root) && !roots.includes(root)) {
      roots.push(root);
    }
  };
  for (let i = 0; i < knots.length - 1; i++) {
    const low = knots[i];
    const high = knots[i + 1];
    const atLow = evaluatePolynomial(poly, low);
    const atHigh = evaluatePolynomial(poly, high);
    if (!atLow) {
      keep(low);
      continue;
    }
    if (!atHigh) {
      keep(high);
      continue;
    }
    if (atLow < 0 !== atHigh < 0) {
      keep(bisectPolynomial(poly, low, high, atLow));
    }
  }
  return roots.sort((x, y) => x - y);
}

function evaluatePolynomial(poly, x) {
  let value = poly[0];
  for (let i = 1; i < poly.length; i++) {
    value = value * x + poly[i];
  }
  return value;
}

function derivePolynomial(poly) {
  const degree = poly.length - 1;
  return poly.slice(0, degree).map((value, i) => value * (degree - i));
}

// Enough halvings to take any bracket this module produces down to the last bit
// of a double, and the same number every time.
const BISECTION_STEPS = 80;

function bisectPolynomial(poly, low, high, atLow) {
  let lo = low;
  let hi = high;
  const negativeAtLo = atLow < 0;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) {
      break;
    }
    if (evaluatePolynomial(poly, mid) < 0 === negativeAtLo) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

//
// The bending energy of a cubic from (0,0) to (1,0) whose handles leave at
// angles `alpha` and `beta` with lengths `a` and `b`: the integral of squared
// curvature, by Simpson's rule over ten intervals (Curvatura.py:66).
//
// It only ever chooses between two exact answers, so the accuracy of the
// quadrature does not enter the geometry. It breaks a tie.
//
function bendingEnergy(alpha, beta, a, b) {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const ca = Math.cos(alpha);
  const cb = Math.cos(beta);
  const dx = [3 * b * cb + 3 * a * ca - 2, -2 * b * cb - 4 * a * ca + 2, a * ca];
  const dy = [-3 * b * sb + 3 * a * sa, -4 * a * sa + 2 * b * sb, a * sa];
  const ddx = [3 * b * cb + 3 * a * ca - 2, -b * cb - 2 * a * ca + 1];
  const ddy = [-3 * b * sb + 3 * a * sa, b * sb - 2 * a * sa];

  const squaredCurvature = (t) => {
    const x1 = 3 * (dx[0] * t * t + dx[1] * t + dx[2]);
    const y1 = 3 * (dy[0] * t * t + dy[1] * t + dy[2]);
    const x2 = 6 * (ddx[0] * t + ddx[1]);
    const y2 = 6 * (ddy[0] * t + ddy[1]);
    const speed = x1 * x1 + y1 * y1;
    return speed ? (x1 * y2 - x2 * y1) ** 2 / speed ** 2.5 : Infinity;
  };

  let integral = 0;
  let atStart = squaredCurvature(0);
  for (let step = 1; step <= 10; step++) {
    const t = step / 10;
    const atEnd = squaredCurvature(t);
    integral += (0.1 / 6) * (atStart + 4 * squaredCurvature(t - 0.05) + atEnd);
    atStart = atEnd;
  }
  return integral / 10;
}

function safeSqrt(value) {
  return value >= 0 ? Math.sqrt(value) : NaN;
}

//
// The two handle lengths that give a cubic from (0,0) to (1,0), leaving at
// angles `alpha` and `beta`, the curvature `ka` at its start and `kb` at its
// end. Lengths are in chord units. Null where there is no admissible answer.
//
// Writing the handles as a*(cos alpha, sin alpha) and (1,0) + b*(-cos beta,
// sin beta), the curvature at the start comes out as
//
//     ka = (2/3) * (b*sin(alpha+beta) - sin(alpha)) / a^2
//
// and by symmetry the same with the two ends swapped. Eliminating `a` between
// the two leaves a quartic in `b`, which is the polynomial below -- the donor's
// coefficients (Curvatura.py:437), rederived here rather than trusted, and they
// agree.
//
// Where the two tangents are parallel the quartic degenerates: sin(alpha+beta)
// is zero, the coupling term with it, and each handle is then fixed by its own
// end's curvature alone.
//
// A quartic can leave two admissible roots, and both are exact answers to the
// question asked. The tie goes to the one that bends less, which is the donor's
// rule and the only one available that does not need a preference invented for
// it.
//
function scaleHandles(alpha, beta, ka, kb) {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const sba = Math.sin(alpha + beta);
  const solutions = [];

  if (Math.abs(sba) < 1e-12) {
    const a = ka ? safeSqrt((-2 * sa) / (3 * ka)) : Math.cos(alpha);
    const b = kb ? safeSqrt((2 * sa) / (3 * kb)) : Math.cos(beta);
    if (a > 0 && b > 0) {
      solutions.push([a, b]);
    }
  } else {
    const roots = realRoots([
      27 * ka * kb * kb,
      0,
      36 * ka * sb * kb,
      -8 * sba ** 3,
      8 * sa * sba * sba + 12 * ka * sb * sb,
    ]);
    for (const b of roots) {
      if (!(b > 0)) {
        continue;
      }
      const a = (sb + 1.5 * kb * b * b) / sba;
      if (a > 0) {
        solutions.push([a, b]);
      }
    }
  }

  if (!solutions.length) {
    return null;
  }
  let best = solutions[0];
  let bestEnergy = bendingEnergy(alpha, beta, best[0], best[1]);
  for (const [a, b] of solutions.slice(1)) {
    const energy = bendingEnergy(alpha, beta, a, b);
    if (energy < bestEnergy) {
      best = [a, b];
      bestEnergy = energy;
    }
  }
  return { a: best[0], b: best[1] };
}

//
// A segment's chord length, the signed angles its two handles make with that
// chord, and the two unit directions those handles leave along. The direction
// at an end whose handle sits on top of its on-curve point falls back to the
// next point along, so it is never the zero vector (Curvatura.py:46).
//
function chordFrame(points) {
  const [p0, p1, p2, p3] = points;
  const chord = subVectors(p3, p0);
  const length = vectorLength(chord);
  if (!length) {
    return null;
  }
  const direction = (from, ...candidates) => {
    for (const candidate of candidates) {
      const step = subVectors(candidate, from);
      if (vectorLength(step)) {
        return normalizeVector(step);
      }
    }
    return null;
  };
  const start = direction(p0, p1, p2, p3);
  const end = direction(p3, p2, p1, p0);
  if (!start || !end) {
    return null;
  }
  const angle = (unit) =>
    Math.asin(Math.min(1, Math.max(-1, crossProduct(chord, unit) / length)));
  return { length, alpha: angle(start), beta: angle(end), start, end };
}

//
// The segment's two handles, rescaled along their own directions so that it
// reaches `kStart` at its first on-curve point and `kEnd` at its last. Null
// where there is no admissible answer, in which case the caller leaves the
// segment as it found it -- the donor's behaviour too.
//
export function adjustHandles(points, kStart, kEnd) {
  const frame = chordFrame(points);
  if (!frame) {
    return null;
  }
  const solved = scaleHandles(
    frame.alpha,
    frame.beta,
    kStart * frame.length,
    kEnd * frame.length
  );
  if (!solved) {
    return null;
  }
  const handles = [
    addVectors(points[0], mulVectorScalar(frame.start, solved.a * frame.length)),
    addVectors(points[3], mulVectorScalar(frame.end, solved.b * frame.length)),
  ];
  return handles.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    ? handles
    : null;
}

// The donor's count (Curvatura.py:524).
const HARMONIZE_HANDLES_ROUNDS = 5;

//
// The curvature each selected node is being pulled towards, and the two
// segments it is pulled through. Recomputed every round, because the previous
// round moved the handles these are read from.
//
function handleTargets(path, candidates) {
  const targets = new Map();
  for (const pointIndex of candidates) {
    const ctx = getJointContext(path, pointIndex);
    if (ctx.reason) {
      continue;
    }
    const segments = jointSegments(path, ctx);
    if (segments.length < 2) {
      continue;
    }
    const incoming = segmentPositions(path, segments[0].indices);
    const outgoing = segmentPositions(path, segments[1].indices);
    const before = curvatureAt(incoming, true);
    const after = curvatureAt(outgoing, false);
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
      continue;
    }
    // An inflection is the one node where the two sides cannot share a
    // magnitude: they curve opposite ways, so the only curvature they can both
    // hold is none. That is also what an inflection is supposed to be.
    const inflection = before * after < 0;
    const mean = (Math.abs(before) + Math.abs(after)) / 2;
    targets.set(pointIndex, {
      before: inflection ? 0 : before < 0 ? -mean : mean,
      after: inflection ? 0 : after < 0 ? -mean : mean,
      incoming: segments[0].indices,
      outgoing: segments[1].indices,
    });
  }
  return targets;
}

//
// Write one segment's solved handles, or refuse the whole segment.
//
// The donor has no limits and does not need them: it is not competing with a
// tension ceiling or a cusp floor. This module has both, and they are
// invariants rather than preferences -- a handle past its segment's Tunni point
// has crossed the other one and the curve doubles back. The answer here is one
// pair, not a direction to step along, so there is nothing to scale back: it is
// taken whole or not at all, and the joint reports that it was limited.
//
function writeSolvedHandles(path, indices, solved, cuspSafetyMargin, maxHandleTension) {
  const points = segmentPositions(path, indices);
  const floor = ((1 - cuspSafetyMargin) / 2) * distance(points[0], points[3]);
  const settled = [points[0], solved[0], solved[1], points[3]];
  if (
    distance(points[0], solved[0]) < floor ||
    distance(points[3], solved[1]) < floor
  ) {
    return { refused: "clamped" };
  }
  if (
    handleTension(settled, "start") > maxHandleTension ||
    handleTension(settled, "end") > maxHandleTension
  ) {
    return { refused: "tension-limited" };
  }
  return { settled };
}

//
// Harmonize by handle length. Same call shape and same report shape as
// `harmonizePathInPlace`, so the editor can put the two behind one command.
//
export function harmonizeHandlesInPlace(path, pointIndices, options = {}) {
  const { cuspSafetyMargin, maxHandleTension, maxCurvatureStep, roundCoordinates } = {
    ...HARMONIZE_DEFAULTS,
    ...options,
  };

  const touched = new Set();
  const candidates = pointIndices?.length
    ? [...new Set(pointIndices)].sort((a, b) => a - b)
    : expandToJoints(path, undefined);

  const states = candidates.map((pointIndex) => ({
    pointIndex,
    contourIndex: path.getContourIndex(pointIndex),
    status: "skipped",
    reason: undefined,
    iterations: 0,
    tensionReduced: false,
    construction: "handles",
    limited: false,
  }));
  const byIndex = new Map(states.map((state) => [state.pointIndex, state]));

  for (const state of states) {
    const ctx = getJointContext(path, state.pointIndex);
    if (ctx.reason) {
      state.reason = ctx.reason;
    } else if (jointSegments(path, ctx).length < 2) {
      state.reason = "not-curve-joint";
    }
  }
  const solvable = states
    .filter((state) => !state.reason)
    .map((state) => state.pointIndex);
  if (!solvable.length) {
    return states.map(report);
  }

  // The drawing as it arrived is one of the candidates, so a run that can only
  // make things worse leaves it alone and the second press does nothing.
  const original = Array.from(path.coordinates);
  const scored = () =>
    scoreJoints(path, solvable, "G2", { maxHandleTension, maxCurvatureStep });
  const originalScore = scored();

  for (let round = 0; round < HARMONIZE_HANDLES_ROUNDS; round++) {
    const targets = handleTargets(path, solvable);

    const apply = (indices, kStart, kEnd, owners) => {
      const solved = adjustHandles(segmentPositions(path, indices), kStart, kEnd);
      const outcome = solved
        ? writeSolvedHandles(path, indices, solved, cuspSafetyMargin, maxHandleTension)
        : { refused: "degenerate" };
      if (outcome.refused) {
        for (const owner of owners) {
          const state = byIndex.get(owner);
          if (state) {
            state.limited = outcome.refused;
          }
        }
        return;
      }
      writePoint(path, touched, indices[1], outcome.settled[1]);
      writePoint(path, touched, indices[2], outcome.settled[2]);
      for (const owner of owners) {
        const state = byIndex.get(owner);
        if (state) {
          state.iterations += 1;
        }
      }
    };

    for (const [pointIndex, target] of targets) {
      // The segment arriving at this node. Where its far end is selected too,
      // that end's own target is what this segment has to reach there -- which
      // is how a run of segments ends up on one profile instead of each joint
      // pulling its neighbour about.
      const arriving = segmentPositions(path, target.incoming);
      const startNode = target.incoming[0];
      const kStart = targets.has(startNode)
        ? targets.get(startNode).after
        : curvatureAt(arriving, false);
      apply(target.incoming, kStart, target.before, [pointIndex, startNode]);

      // The segment leaving it is the next node's arriving segment, so it is
      // only solved here when there is no next node to do it -- at the far end
      // of the selection, where the curvature it has now is what it keeps.
      const endNode = target.outgoing[3];
      if (!targets.has(endNode)) {
        const leaving = segmentPositions(path, target.outgoing);
        apply(target.outgoing, target.after, curvatureAt(leaving, true), [pointIndex]);
      }
    }
  }

  if (roundCoordinates) {
    snapToGrid(path, touched, scored, isBetter);
  }

  if (!isBetter(scored(), originalScore)) {
    for (let index = 0; index < path.numPoints; index++) {
      const [x, y] = path.getPointPosition(index);
      if (original[index * 2] !== x || original[index * 2 + 1] !== y) {
        path.setPointPosition(index, original[index * 2], original[index * 2 + 1]);
      }
    }
    for (const state of states) {
      state.iterations = 0;
    }
  }

  for (const state of states) {
    if (state.reason) {
      continue;
    }
    // A verdict describes the drawing that was kept, never one that was
    // computed and then dropped: below the grid, or beaten by the drawing it
    // started from.
    const ctx = getJointContext(path, state.pointIndex);
    const stencil = ctx.reason
      ? [state.pointIndex]
      : [state.pointIndex, ...Object.values(ctx.indices)];
    const moved = stencil.some((index) => {
      const [x, y] = path.getPointPosition(index);
      return original[index * 2] !== x || original[index * 2 + 1] !== y;
    });
    if (moved) {
      state.status = state.limited ? "partial" : "harmonized";
      state.reason = state.limited || undefined;
    } else if (state.iterations) {
      // Solved, and then not kept: the correction was smaller than the grid can
      // hold, or the drawing it started from scored better than the answer.
      state.status = "skipped";
      state.reason = "below-grid";
    } else {
      // Nothing was written at all. Saying "already harmonic" here would be a
      // lie whenever every solve was refused by a limit, which is exactly the
      // case a designer needs told: the answer exists and this module will not
      // draw it, because reaching it would put a handle under its cusp floor or
      // past its segment's Tunni point.
      state.status = "skipped";
      state.reason = state.limited || "already-harmonic";
    }
  }

  return states.map(report);
}

function report({
  pointIndex,
  contourIndex,
  status,
  reason,
  iterations,
  tensionReduced,
  construction,
}) {
  return {
    pointIndex,
    contourIndex,
    status,
    reason,
    iterations,
    tensionReduced,
    construction,
  };
}
