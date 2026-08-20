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
const G3_SLIDE_REFINEMENTS = 24;

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
// The repair. Where the joint's own position admits no G3 answer, slide it
// along the tangent by the smallest distance that does, and let the two inner
// handles take the rest. The slide is a repair and not a preference: it is
// tried outward from zero, so a joint that never needed it never moves.
//
function g3AfterSlide(stencil, limits) {
  const node = stencil.incoming[3];
  const span = subVectors(stencil.outgoing[1], stencil.incoming[2]);
  if (!vectorLength(span)) {
    return null;
  }
  const axis = normalizeVector(span);
  // The joint may travel as far as the on-curve point at the far end of either
  // of its two segments, measured along the tangent. Past that it has left the
  // segment it belongs to. The two directions have their own room, so they are
  // bounded separately and searched together, nearest first.
  const along = (point) => dotVector(subVectors(point, node), axis);
  const room = {
    "1": Math.max(0, along(stencil.outgoing[3])),
    "-1": Math.max(0, -along(stencil.incoming[0])),
  };
  const step = Math.max(room["1"], room["-1"]) / G3_SLIDE_SAMPLES;
  if (!step) {
    return null;
  }
  const at = (slide) => addVectors(node, mulVectorScalar(axis, slide));

  for (let sample = 1; sample <= G3_SLIDE_SAMPLES; sample++) {
    for (const direction of [1, -1]) {
      if (sample * step > room[direction]) {
        continue;
      }
      let inside = direction * sample * step;
      if (!g3Attempt(stencil, at(inside), limits)) {
        continue;
      }
      let outside = direction * (sample - 1) * step;
      for (let i = 0; i < G3_SLIDE_REFINEMENTS; i++) {
        const middle = (inside + outside) / 2;
        if (g3Attempt(stencil, at(middle), limits)) {
          inside = middle;
        } else {
          outside = middle;
        }
      }
      const nodePosition = at(inside);
      const targets = g3Attempt(stencil, nodePosition, limits);
      return targets ? { node: nodePosition, targets } : null;
    }
  }
  return null;
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
  const {
    continuity,
    slideOnCurve,
    handleBias: rawHandleBias,
    cuspSafetyMargin,
    toleranceUnits,
    maxIterations,
    equalizeTension,
    maxHandleTension,
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
  const jointResidual = () => {
    let violations = 0;
    let residual = 0;
    for (const pointIndex of candidates) {
      const ctx = getJointContext(path, pointIndex);
      if (ctx.reason) {
        continue;
      }
      const discontinuity = measureG2Discontinuity(ctx);
      residual += Number.isFinite(discontinuity) ? discontinuity : 0;
      for (const { nearSide, indices } of jointSegments(path, ctx)) {
        if (
          handleTension(segmentPositions(path, indices), nearSide) > maxHandleTension
        ) {
          violations += 1;
        }
      }
    }
    return { violations, residual };
  };

  const isBetter = (candidate, incumbent) =>
    candidate.violations !== incumbent.violations
      ? candidate.violations < incumbent.violations
      : candidate.residual < incumbent.residual;

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
            const held = g3Attempt(stencil, ctx.node, limits);
            outcome = held
              ? { node: null, targets: held }
              : slideOnCurve
                ? g3AfterSlide(stencil, limits)
                : null;
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
