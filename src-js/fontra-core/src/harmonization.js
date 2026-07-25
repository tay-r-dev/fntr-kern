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
};

const ZERO_VECTOR = { x: 0, y: 0 };

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
function equalizeJointSegments(path, ctx) {
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
      path.setPointPosition(indices[i], balanced[i].x, balanced[i].y);
    }
  }
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
export function harmonizePathInPlace(path, pointIndices, options = {}) {
  const {
    handleBias: rawHandleBias,
    cuspSafetyMargin,
    toleranceUnits,
    maxIterations,
    equalizeTension,
    maxHandleTension,
  } = {
    ...HARMONIZE_DEFAULTS,
    ...options,
  };

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

  if (equalizeTension) {
    // donor order: balance, harmonize, balance (SuperTool+Harmonize.m:61,75)
    for (const pointIndex of candidates) {
      const ctx = getJointContext(path, pointIndex);
      if (!ctx.reason) {
        equalizeJointSegments(path, ctx);
      }
    }
  }

  const states = candidates.map((pointIndex) => {
    // Floors are captured up front, from the untouched geometry: a handle may
    // never end up shorter than this, however many passes it takes.
    const ctx = getJointContext(path, pointIndex);
    const floors = ctx.reason
      ? undefined
      : {
          P: (1 - cuspSafetyMargin) * distance(ctx.node, ctx.P),
          N: (1 - cuspSafetyMargin) * distance(ctx.node, ctx.N),
        };
    // A handle already over the ceiling is not made worse, but neither is it
    // held hostage: the joint still harmonizes as far as it can.
    const segments = ctx.reason ? [] : jointSegments(path, ctx);
    const ceiling = segments.length
      ? Math.max(
          maxHandleTension,
          tensionAfterStep(path, ctx, segments, ZERO_VECTOR, handleBias)
        )
      : Infinity;
    return {
      pointIndex,
      contourIndex: path.getContourIndex(pointIndex),
      status: undefined,
      reason: undefined,
      iterations: 0,
      floors,
      segments,
      ceiling,
      done: false,
    };
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

      const ctx = getJointContext(path, state.pointIndex);
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
        ) > state.ceiling
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
          if (tension > state.ceiling) {
            high = mid;
          } else {
            low = mid;
          }
        }
        scale = low;
        tensionLimited = true;
      }

      if (scale > 0) {
        applyFixup(path, ctx, mulVectorScalar(solution.fixup, scale), handleBias);
        state.iterations += 1;
        anyMoved = true;
      }
      if (tensionLimited) {
        settle(state, "partial", "tension-limited");
      } else if (clamped) {
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

  if (equalizeTension) {
    for (const state of states) {
      if (state.status === "skipped") {
        continue;
      }
      const ctx = getJointContext(path, state.pointIndex);
      if (!ctx.reason) {
        equalizeJointSegments(path, ctx);
      }
    }
  }

  return states.map(({ pointIndex, contourIndex, status, reason, iterations }) => ({
    pointIndex,
    contourIndex,
    status,
    reason,
    iterations,
  }));
}
