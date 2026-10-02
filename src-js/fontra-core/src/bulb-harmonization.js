import * as vector from "./vector.js";

// Signed endpoint curvature, in traversal order. Comparing magnitudes would
// accept a convex-to-concave jump as a match.
export function bulbEndCurvature(points, end = false) {
  const [p, h, far] = end ? [...points].reverse() : points;
  const u = vector.subVectors(h, p);
  const v = vector.subVectors(far, h);
  const speed = Math.hypot(u.x, u.y);
  return speed > 1e-12 ? ((end ? -1 : 1) * (2 / 3) * cross(u, v)) / speed ** 3 : 0;
}

const cross = (a, b) => a.x * b.y - a.y * b.x;
const unit = (v) => {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-12 ? vector.mulVectorScalar(v, 1 / length) : { x: 0, y: 0 };
};
const shift = (p, t, d) => vector.addVectors(p, vector.mulVectorScalar(t, d));

// E-B-C-N-W, four cubic spans, with a fixed incoming wall and a fixed outgoing
// wall curvature. E and W are boundary conditions. All eight free handle
// lengths solve together. Optional bounded slides of B/C and movement/turn of
// N give the body room to harmonize without losing its rib-grown proportions.
// The same input always starts at the same preferred construction; there is no
// gesture memory, root picking by previous frame, or alternating join solve.
export function harmonizeBulb({
  points,
  wall,
  nextCurvature,
  radius,
  corner = false,
  neckScale = 1,
  movePoints = false,
  turnNeck = true,
}) {
  const anchors = [0, 3, 6, 9, 12].map((i) => points[i]);
  const handles = [1, 2, 4, 5, 7, 8, 10, 11];
  const anchorOf = [0, 1, 1, 2, 2, 3, 3, 4];
  const directions = handles.map((i, k) =>
    unit(vector.subVectors(points[i], anchors[anchorOf[k]]))
  );
  const lengths = handles.map((i, k) =>
    vector.distance(points[i], anchors[anchorOf[k]])
  );
  const scale = Math.max(radius, 1e-6);
  const targetEntry = bulbEndCurvature(wall, true);
  const count = movePoints ? (turnNeck ? 13 : 12) : 8;
  const place = (q, virtualNeck = false) => {
    const a = anchors.map((p) => ({ ...p }));
    const axes = directions.map((d) => ({ ...d }));
    if (movePoints) {
      a[1] = { ...a[1], ...shift(a[1], axes[2], 0.15 * scale * Math.tanh(q[8])) };
      a[2] = { ...a[2], ...shift(a[2], axes[4], 0.15 * scale * Math.tanh(q[9])) };
      a[3].x += 0.15 * scale * Math.tanh(q[10]);
      a[3].y += 0.15 * scale * Math.tanh(q[11]);
      const turn = turnNeck ? 0.35 * Math.tanh(q[12]) : 0;
      for (const k of [5, 6]) {
        const d = axes[k];
        axes[k] = {
          x: d.x * Math.cos(turn) - d.y * Math.sin(turn),
          y: d.x * Math.sin(turn) + d.y * Math.cos(turn),
        };
      }
    }
    const placed = points.map((p) => ({ ...p }));
    a.forEach((p, i) => (placed[i * 3] = p));
    for (let span = 0; span < 4; span++) {
      const chord = vector.subVectors(a[span + 1], a[span]);
      const distance = Math.hypot(chord.x, chord.y);
      const k = span * 2;
      let limits = [2 * distance, 2 * distance];
      // Only the two convex body quarters have a tangent triangle. C-N is
      // allowed to inflect: imposing this triangle there destroys the neck.
      const determinant = cross(axes[k], axes[k + 1]);
      if (span < 2 && Math.abs(determinant) > 1e-10) {
        const reaches = [
          cross(chord, axes[k + 1]) / determinant,
          cross(chord, axes[k]) / determinant,
        ];
        if (reaches.every((r) => r > 0)) limits = reaches;
      }
      for (let j = k; j < k + 2; j++) {
        const limit = Math.max(scale * 1e-6, limits[j - k]);
        const floor = Math.min(0.02 * scale, 0.25 * lengths[j], 0.1 * limit);
        const fraction = Math.min(
          0.999999,
          Math.max(1e-7, (lengths[j] - floor) / (limit - floor))
        );
        const odds = fraction / (1 - fraction);
        const length =
          lengths[j] === 0
            ? 0
            : floor +
              ((limit - floor) * odds * Math.exp(q[j])) / (1 + odds * Math.exp(q[j]));
        Object.assign(
          placed[handles[j]],
          shift(
            a[anchorOf[j]],
            axes[j],
            length * (!virtualNeck && (j === 5 || j === 6) ? neckScale : 1)
          )
        );
      }
    }
    return placed;
  };
  // Multiply curvature equalities by their positive squared handle lengths.
  // This removes divisions by shrinking handles from the solve. At N use the
  // uncollapsed handles: the common easing squared cancels from both sides,
  // including the limit at zero. Actual endpoint curvatures still verify the
  // result; a collapsed or bounded span is never reported as an exact match.
  const endData = (curve, end = false) => {
    const p = end ? [...curve].reverse() : curve;
    const d = vector.subVectors(p[1], p[0]);
    const length = Math.hypot(d.x, d.y);
    const tangent = vector.mulVectorScalar(unit(d), end ? -1 : 1);
    return { bend: cross(tangent, vector.subVectors(p[2], p[0])), length };
  };
  const residuals = (q, measured = false) => {
    const p = place(q),
      virtual = place(q, true);
    const curves = [0, 3, 6, 9].map((i) => p.slice(i, i + 4));
    const first = endData(curves[0]);
    const r = [(first.bend - 1.5 * targetEntry * first.length ** 2) / scale];
    if (measured) r[0] = (bulbEndCurvature(curves[0]) - targetEntry) * scale;
    for (let i = 1; i < 4; i++) {
      if (i === 3 && corner) continue;
      const left = i === 3 ? virtual.slice(6, 10) : curves[i - 1];
      const right = i === 3 ? virtual.slice(9, 13) : curves[i];
      const a = endData(left, true),
        b = endData(right);
      r.push(
        measured
          ? (bulbEndCurvature(left, true) - bulbEndCurvature(right)) * scale
          : (a.bend * b.length ** 2 - b.bend * a.length ** 2) /
              (scale * Math.max(1e-20, a.length ** 2 + b.length ** 2))
      );
    }
    if (Number.isFinite(nextCurvature)) {
      const last = endData(curves[3], true);
      r.push(
        measured
          ? (bulbEndCurvature(curves[3], true) - nextCurvature) * scale
          : (last.bend - 1.5 * nextCurvature * last.length ** 2) / scale
      );
    }
    return r;
  };
  let q = Array(count).fill(0);
  const initial = place(q, true);
  const displacement = (q) =>
    place(q, true).flatMap((p, i) => [
      (p.x - initial[i].x) / scale,
      (p.y - initial[i].y) / scale,
    ]);
  const norm = (v) => dotArray(v, v);
  const merit = (q, weight) => norm(residuals(q)) + weight * norm(displacement(q));
  // First prefer small physical displacement, then tighten the five joins.
  // Penalizing log-length changes instead made a short neck handle as costly
  // to move as the long wall handle, and selected visibly different solutions
  // on neighboring slider samples. All iterations start from this frame's seed.
  for (let iteration = 0; iteration < 140; iteration++) {
    const r = residuals(q),
      d = displacement(q);
    const weight = iteration < 100 ? 1e-4 : 1e-9;
    const jacobian = Array.from({ length: count }, () => []);
    const motion = Array.from({ length: count }, () => []);
    const h = 1e-4;
    for (let k = 0; k < count; k++) {
      const plus = [...q],
        minus = [...q];
      plus[k] += h;
      minus[k] -= h;
      const rp = residuals(plus),
        rm = residuals(minus);
      const dp = displacement(plus),
        dm = displacement(minus);
      jacobian[k] = rp.map((v, i) => (v - rm[i]) / (2 * h));
      motion[k] = dp.map((v, i) => (v - dm[i]) / (2 * h));
    }
    const matrix = jacobian.map((row, i) =>
      jacobian.map(
        (other, j) =>
          dotArray(row, other) +
          weight * dotArray(motion[i], motion[j]) +
          (i === j ? 1e-12 : 0)
      )
    );
    const rhs = jacobian.map(
      (row, i) => -dotArray(row, r) - weight * dotArray(motion[i], d)
    );
    const step = solveLinear(matrix, rhs);
    if (!step) break;
    const damping = Math.min(0.8, 0.5 / Math.max(...step.map(Math.abs), 1e-12));
    const before = merit(q, weight);
    for (let backtrack = 0; backtrack < 10; backtrack++) {
      const factor = damping / 2 ** backtrack;
      const trial = q.map((v, k) => Math.max(-8, Math.min(8, v + factor * step[k])));
      if (merit(trial, weight) <= before) {
        q = trial;
        break;
      }
    }
  }
  const error = Math.max(...residuals(q, true).map(Math.abs));
  const virtual = place(q, true);
  return {
    points: place(q),
    error,
    status: error < 1e-5 ? "matched" : "bounded",
    neckTangent: unit(vector.subVectors(virtual[10], virtual[8])),
  };
}

function dotArray(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

// The normal system has at most thirteen rows. Pivoting also makes a flat or
// collapsed span an ordinary bounded case, rather than emitting NaNs.
function solveLinear(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  const n = rhs.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    if (Math.abs(a[k][k]) < 1e-20) return null;
    const divisor = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= divisor;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = a[i][k];
      for (let j = k; j <= n; j++) a[i][j] -= factor * a[k][j];
    }
  }
  return a.map((row) => row[n]);
}
