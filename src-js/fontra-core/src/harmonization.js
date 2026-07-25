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

import { POINT_TYPE_OFF_CURVE_CUBIC } from "./var-path.js";
import {
  addVectors,
  distance,
  interpolateVectors,
  intersect,
  mulVectorScalar,
  subVectors,
  vectorLength,
} from "./vector.js";

export const HARMONIZE_DEFAULTS = {
  handleBias: 1.0, //     0 = move the node, 1 = move the handles
  cuspSafetyMargin: 0.85, // never shrink a handle below 15% of its length
  toleranceUnits: 0.01, // convergence threshold, in font units
  maxIterations: 10,
};

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

function applyFixup(path, ctx, fixup, handleBias) {
  if (handleBias < 1) {
    const delta = mulVectorScalar(fixup, -(1 - handleBias));
    const node = addVectors(ctx.node, delta);
    path.setPointPosition(ctx.pointIndex, node.x, node.y);
  }
  if (handleBias > 0) {
    const delta = mulVectorScalar(fixup, handleBias);
    for (const name of ["P", "N"]) {
      const handle = addVectors(ctx[name], delta);
      path.setPointPosition(ctx.indices[name], handle.x, handle.y);
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
//     reason  clamped | not-converged                     (partial)
//             not-smooth | not-curve-joint | degenerate
//             | already-harmonic                          (skipped)
//
// Total: no geometric situation throws.
//
export function harmonizePath(path, pointIndices, options = {}) {
  const { handleBias, cuspSafetyMargin, toleranceUnits, maxIterations } = {
    ...HARMONIZE_DEFAULTS,
    ...options,
  };

  const newPath = path.copy();
  const candidates = pointIndices?.length
    ? [...new Set(pointIndices)].sort((a, b) => a - b)
    : expandToJoints(newPath, undefined);

  const states = candidates.map((pointIndex) => ({
    pointIndex,
    contourIndex: newPath.getContourIndex(pointIndex),
    status: undefined,
    reason: undefined,
    iterations: 0,
    // lower bounds on the two handle lengths, captured from the geometry as it
    // was before the first pass, so repeated passes cannot nibble a handle away
    floors: undefined,
    done: false,
  }));

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

      const ctx = getJointContext(newPath, state.pointIndex);
      if (ctx.reason) {
        settle(state, "skipped", ctx.reason);
        continue;
      }

      const solution = calculateHarmonicTarget(ctx);
      if (!solution) {
        settle(state, "skipped", "degenerate");
        continue;
      }

      const fixupLength = vectorLength(solution.fixup);
      if (fixupLength < toleranceUnits) {
        if (state.iterations) {
          settle(state, "harmonized", undefined);
        } else {
          settle(state, "skipped", "already-harmonic");
        }
        continue;
      }

      const lengths = {
        P: distance(ctx.node, ctx.P),
        N: distance(ctx.node, ctx.N),
      };
      state.floors ??= {
        P: (1 - cuspSafetyMargin) * lengths.P,
        N: (1 - cuspSafetyMargin) * lengths.N,
      };

      // The node and the handles always end up `fixup` apart no matter how the
      // bias splits the motion, so one handle grows and the other shrinks by
      // exactly |fixup|. Scale the whole step back if that would take the
      // shrinking one past its floor.
      let scale = 1;
      for (const name of ["P", "N"]) {
        const shrunk = distance(ctx.node, addVectors(ctx[name], solution.fixup));
        if (shrunk < state.floors[name]) {
          scale = Math.min(scale, (lengths[name] - state.floors[name]) / fixupLength);
        }
      }
      const clamped = scale < 1;
      scale = Math.max(scale, 0);

      if (scale > 0) {
        applyFixup(newPath, ctx, mulVectorScalar(solution.fixup, scale), handleBias);
        state.iterations += 1;
        anyMoved = true;
      }
      if (clamped) {
        settle(state, "partial", "clamped");
      }
    }

    if (!anyMoved) {
      break;
    }
  }

  for (const state of states) {
    if (!state.done) {
      settle(state, "partial", "not-converged");
    }
  }

  return {
    path: newPath,
    report: states.map(({ pointIndex, contourIndex, status, reason, iterations }) => ({
      pointIndex,
      contourIndex,
      status,
      reason,
      iterations,
    })),
  };
}
