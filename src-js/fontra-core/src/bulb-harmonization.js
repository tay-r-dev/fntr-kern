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
  movePoints = false,
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
  const count = movePoints ? 13 : 8;
  const place = (q) => {
    const a = anchors.map((p) => ({ ...p }));
    const axes = directions.map((d) => ({ ...d }));
    if (movePoints) {
      a[1] = { ...a[1], ...shift(a[1], axes[2], 0.15 * scale * Math.tanh(q[8])) };
      a[2] = { ...a[2], ...shift(a[2], axes[4], 0.15 * scale * Math.tanh(q[9])) };
      a[3].x += 0.15 * scale * Math.tanh(q[10]);
      a[3].y += 0.15 * scale * Math.tanh(q[11]);
      const turn = 0.35 * Math.tanh(q[12]);
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
          cross(axes[k], chord) / determinant,
        ];
        if (reaches.every((r) => r > 0)) limits = reaches;
      }
      for (let j = k; j < k + 2; j++) {
        const length =
          lengths[j] === 0
            ? 0
            : Math.min(
                limits[j - k],
                Math.max(scale * 1e-7, lengths[j] * Math.exp(q[j]))
              );
        Object.assign(placed[handles[j]], shift(a[anchorOf[j]], axes[j], length));
      }
    }
    return placed;
  };
  const residuals = (q) => {
    const p = place(q);
    const curves = [0, 3, 6, 9].map((i) => p.slice(i, i + 4));
    const pairs = [[targetEntry, bulbEndCurvature(curves[0])]];
    for (let i = 1; i < 4; i++) {
      if (i === 3 && corner) continue;
      pairs.push([bulbEndCurvature(curves[i - 1], true), bulbEndCurvature(curves[i])]);
    }
    if (Number.isFinite(nextCurvature))
      pairs.push([bulbEndCurvature(curves[3], true), nextCurvature]);
    return pairs.map(
      ([a, b]) =>
        ((a - b) * scale) / Math.max(1, Math.abs(a * scale), Math.abs(b * scale))
    );
  };
  let q = Array(count).fill(0);
  const norm = (v) => dotArray(v, v);
  // A small preference term picks the nearby solution of the underdetermined
  // system. It is not a substitute for the five signed curvature conditions.
  const merit = (q, r) => norm(r) + 1e-10 * norm(q);
  for (let iteration = 0; iteration < 90; iteration++) {
    const r = residuals(q);
    const jacobian = r.map(() => Array(count).fill(0));
    const h = 1e-4;
    for (let k = 0; k < count; k++) {
      const plus = [...q],
        minus = [...q];
      plus[k] += h;
      minus[k] -= h;
      const rp = residuals(plus),
        rm = residuals(minus);
      r.forEach((_, i) => (jacobian[i][k] = (rp[i] - rm[i]) / (2 * h)));
    }
    const preference = q.map((v) => -0.04 * v);
    const matrix = jacobian.map((row, i) =>
      jacobian.map((other, j) => dotArray(row, other) + (i === j ? 1e-8 : 0))
    );
    const rhs = r.map((v, i) => -v - dotArray(jacobian[i], preference));
    const multipliers = solveLinear(matrix, rhs);
    if (!multipliers) break;
    const step = preference.map(
      (v, k) => v + jacobian.reduce((sum, row, i) => sum + row[k] * multipliers[i], 0)
    );
    const damping = Math.min(0.8, 0.35 / Math.max(...step.map(Math.abs), 1e-12));
    const before = merit(q, r);
    for (let backtrack = 0; backtrack < 10; backtrack++) {
      const factor = damping / 2 ** backtrack;
      const trial = q.map((v, k) => Math.max(-8, Math.min(8, v + factor * step[k])));
      if (merit(trial, residuals(trial)) <= before) {
        q = trial;
        break;
      }
    }
  }
  const error = Math.max(...residuals(q).map(Math.abs));
  return { points: place(q), error, status: error < 1e-5 ? "matched" : "bounded" };
}

function dotArray(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

// The curvature system has at most five rows. Pivoting also makes a flat or
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
