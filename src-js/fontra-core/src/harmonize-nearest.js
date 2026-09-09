//
// The nearest answer.
//
// One equation -- the two curvatures at a joint must be equal -- and four
// unknowns, one multiplier per handle length. Infinitely many sets of
// multipliers satisfy it. This module returns the set nearest to the drawing.
//
// It is ported from `_external/g1_g2_g3_bezier_harmonizer.html`, which is about
// thirty lines of solver. Three details of that solver are load-bearing and are
// kept exactly.
//
//   * The unknowns are the LOGARITHMS of the multipliers. So a small change is a
//     small percentage of each handle rather than a small number of units, and
//     the correction spreads over the four handles in proportion to what each
//     one can contribute.
//   * The step is the minimum-norm Gauss-Newton step. That is what makes the
//     answer the nearest one rather than one particular one.
//   * Each step is capped at forty per cent of any one multiplier and then taken
//     at nine tenths. Without the cap and the undershoot a step near an
//     ill-conditioned joint overshoots and the next step comes back.
//
// Two limits are added here and are not in the reference. Neither is optional.
//
//   * No handle may pass its segment's tangent-ray crossing. Past it the two
//     handle lines cross and the curve doubles back. Where the two curvatures
//     both approach zero -- a joint near an inflection -- matching them asks for
//     arbitrarily long handles, so this limit is reached in ordinary use rather
//     than at an extreme. Measured on point 19 of `_external/problem-glyphs/I^1.json`:
//     over three units of drag the answer asks for a tension of 3.85.
//   * No handle may be shorter than one unit. This is the automatic answer's
//     floor, the same one the offset construction uses. A hand may put a handle
//     on its own point; a solver may not, because below a unit a handle
//     expresses only three directions on the grid.
//
// Both limits are computed ONCE, before the first step, and they do not move.
// The handles keep their directions, so the tangent-ray crossing is fixed for
// the whole solve.
//
import { calculateTunniPoint } from "./tunni-calculations.js";

// The residual is scaled by a fixed length so that the Gauss-Newton system is
// conditioned in the same range whatever the glyph's units are. With one
// equation the scale cancels out of the step exactly; it is kept because the
// reference has it and because it will not cancel if a second equation is ever
// added here.
const RESIDUAL_SCALE = 200;

// The finite difference used to build the Jacobian, in log space.
const DERIVATIVE_STEP = 1e-4;

// No multiplier's logarithm may change by more than this in one iteration.
const MAX_LOG_STEP = 0.4;

// Each step is taken at this fraction of its full length.
const UNDERSHOOT = 0.9;

// The answer is matched when the relative curvature difference is under this.
const MATCHED = 1e-6;

const MAX_ITERATIONS = 80;

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v) {
  return Math.hypot(v.x, v.y);
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Signed curvature at one end of a cubic, from that end's last three control
// points. This is the whole of what the end curvature depends on.
function endCurvature([p0, p1, p2, p3], atEnd) {
  const [a, b, c] = atEnd ? [p3, p2, p1] : [p0, p1, p2];
  const first = { x: 3 * (b.x - a.x), y: 3 * (b.y - a.y) };
  const second = { x: 6 * (c.x - 2 * b.x + a.x), y: 6 * (c.y - 2 * b.y + a.y) };
  const speed = length(first);
  if (speed < 1e-9) {
    return 0;
  }
  // Reversing a curve flips the sign of its signed curvature, so the end read
  // backwards is negated to bring both ends into one frame.
  const k = cross(first, second) / (speed * speed * speed);
  return atEnd ? -k : k;
}

// The four handles of a joint, each as the on-curve point it grows from, its
// direction and its present length. The order is the order of `scales`:
// [A -> PP, node -> P, node -> N, C -> NN].
function handlesOf(stencil) {
  const [A, PP, P, node, N, NN, C] = stencil;
  const one = (from, handle) => {
    const delta = subtract(handle, from);
    const len = length(delta) || 1e-9;
    return { from, ux: delta.x / len, uy: delta.y / len, length: len };
  };
  return [one(A, PP), one(node, P), one(node, N), one(C, NN)];
}

function buildStencil(stencil, handles, scales) {
  const placed = handles.map((h, k) => ({
    x: h.from.x + h.ux * h.length * scales[k],
    y: h.from.y + h.uy * h.length * scales[k],
  }));
  return [
    stencil[0],
    placed[0],
    placed[1],
    stencil[3],
    placed[2],
    placed[3],
    stencil[6],
  ];
}

function segmentsOf(points) {
  return [points.slice(0, 4), points.slice(3, 7)];
}

function curvatureStepOf(points) {
  const [incoming, outgoing] = segmentsOf(points);
  const kIn = endCurvature(incoming, true);
  const kOut = endCurvature(outgoing, false);
  return Math.abs(kIn - kOut) / Math.max(Math.abs(kIn), Math.abs(kOut), 1e-12);
}

function residualOf(points) {
  const [incoming, outgoing] = segmentsOf(points);
  return (
    (endCurvature(incoming, true) - endCurvature(outgoing, false)) * RESIDUAL_SCALE
  );
}

//
// The largest multiplier each handle may take, from the tangent-ray crossing of
// its own segment. Where the two rays do not cross ahead of the segment there
// is nothing to pass, so that handle has no ceiling here.
//
function ceilingScales(stencil, handles, maxHandleTension) {
  const [incoming, outgoing] = segmentsOf(stencil);
  const reach = (segment, nearSide) => {
    const crossing = calculateTunniPoint(segment);
    if (!crossing) {
      return Infinity;
    }
    const onCurve = nearSide === "start" ? segment[0] : segment[3];
    return length(subtract(crossing, onCurve));
  };
  const reaches = [
    reach(incoming, "start"),
    reach(incoming, "end"),
    reach(outgoing, "start"),
    reach(outgoing, "end"),
  ];
  return reaches.map((r, k) =>
    Number.isFinite(r) ? (maxHandleTension * r) / handles[k].length : Infinity
  );
}

export function solveNearestHandleScales(stencil, options = {}) {
  const {
    maxHandleTension = 1,
    minHandleLength = 1,
    iterations = MAX_ITERATIONS,
    // Hold the two outer handles still. This exists so a test can compare the
    // four-handle answer against the same solve restricted to the two handles
    // the other constructions move. Production never sets it.
    outerHandlesHold = false,
  } = options;

  const handles = handlesOf(stencil);
  const scales = [1, 1, 1, 1];
  const arrived = curvatureStepOf(stencil);
  if (arrived <= MATCHED) {
    return {
      scales,
      status: "skipped",
      reason: "already-harmonic",
      curvatureStep: arrived,
    };
  }

  const dials = outerHandlesHold ? [0, 1, 1, 0] : [1, 1, 1, 1];
  const ceilings = ceilingScales(stencil, handles, maxHandleTension);
  const floors = handles.map((h, k) =>
    Math.min(minHandleLength / h.length, ceilings[k])
  );
  const onALimit = () =>
    scales.some(
      (s, k) => dials[k] && (s >= ceilings[k] - 1e-12 || s <= floors[k] + 1e-12)
    );

  for (let iteration = 0; iteration < iterations; iteration++) {
    const residual = residualOf(buildStencil(stencil, handles, scales));
    if (Math.abs(residual) < 1e-10) {
      break;
    }

    // One row, four columns: how the residual answers a small change in each
    // multiplier's logarithm.
    const jacobian = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      if (!dials[k]) {
        continue;
      }
      const stepped = scales.slice();
      stepped[k] *= Math.exp(DERIVATIVE_STEP);
      const other = residualOf(buildStencil(stencil, handles, stepped));
      jacobian[k] = (other - residual) / DERIVATIVE_STEP;
    }

    // The minimum-norm solution of one equation in four unknowns: the step lies
    // along the Jacobian's own direction. The small addition keeps the division
    // finite where the joint gives the solver nothing to pull on.
    let normal = 1e-7;
    for (let k = 0; k < 4; k++) {
      normal += jacobian[k] * jacobian[k];
    }
    const multiplier = -residual / normal;

    let largest = 0;
    for (let k = 0; k < 4; k++) {
      largest = Math.max(largest, Math.abs(jacobian[k] * multiplier));
    }
    if (largest === 0) {
      break;
    }
    const damping = largest > MAX_LOG_STEP ? MAX_LOG_STEP / largest : 1;

    for (let k = 0; k < 4; k++) {
      if (!dials[k]) {
        continue;
      }
      scales[k] *= Math.exp(jacobian[k] * multiplier * damping * UNDERSHOOT);
      scales[k] = Math.min(ceilings[k], Math.max(floors[k], scales[k]));
    }
  }

  const curvatureStep = curvatureStepOf(buildStencil(stencil, handles, scales));
  if (curvatureStep <= MATCHED) {
    return { scales, status: "solved", reason: undefined, curvatureStep };
  }
  return {
    scales,
    status: "partial",
    // A limit stopped it, or no set of lengths can match these two sides at all.
    // The second happens where the two sides curve to opposite sides of the
    // tangent: one curvature is positive and the other negative, and scaling a
    // length cannot change a sign.
    reason: onALimit() ? "tension-limited" : "degenerate",
    curvatureStep,
  };
}

// The four handle positions an answer asks for, in the stencil's own order.
export function applyHandleScales(stencil, scales) {
  return buildStencil(stencil, handlesOf(stencil), scales);
}
