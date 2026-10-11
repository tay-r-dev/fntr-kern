import { bulbEndCurvature } from "./bulb-harmonization.js";
import { makeSlideCandidate } from "./point-slide.js";

// A comb step under this share of the larger side counts as even.
const EVEN_STEP = 0.01;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (v) => Math.hypot(v.x, v.y);
const unit = (v) => {
  const n = norm(v);
  return { x: v.x / n, y: v.y / n };
};

// Fit just E-B's two lengths to the retained wall and the unchanged B-C span.
// None of the remaining bulb controls participate in this solve.
export function matchCubicEndCurvatures(curve, incoming, outgoing, radius) {
  const [e, h0, h1, b] = curve;
  const t0 = unit(sub(h0, e)),
    t1 = unit(sub(b, h1)),
    d = sub(b, e);
  let a = norm(sub(h0, e)),
    c = norm(sub(b, h1));
  if (!(a > 1e-8 && c > 1e-8)) return null;
  const place = () => [
    e,
    { ...h0, x: e.x + a * t0.x, y: e.y + a * t0.y },
    { ...h1, x: b.x - c * t1.x, y: b.y - c * t1.y },
    b,
  ];
  const residual = () => [
    (bulbEndCurvature(place()) - incoming) * radius,
    (bulbEndCurvature(place(), true) - outgoing) * radius,
  ];
  for (let i = 0; i < 40; i++) {
    const [r0, r1] = residual();
    if (Math.max(Math.abs(r0), Math.abs(r1)) < 1e-7) return place();
    const k0 = r0 / radius + incoming,
      k1 = r1 / radius + outgoing;
    const j00 = ((-2 * k0) / a) * radius,
      j01 = ((-(2 / 3) * cross(t0, t1)) / (a * a)) * radius;
    const j10 = (j01 * a * a) / (c * c),
      j11 = ((-2 * k1) / c) * radius;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-14) break;
    const da = (-r0 * j11 + j01 * r1) / det;
    const dc = (-j00 * r1 + j10 * r0) / det;
    const oldA = a,
      oldC = c;
    let accepted = false;
    for (let j = 0; j < 12; j++) {
      const f = 0.5 ** j;
      a = oldA + f * da;
      c = oldC + f * dc;
      if (a <= 1e-5 || c <= 1e-5 || Math.max(a, c) > 2 * norm(d)) continue;
      const r = residual();
      if (r[0] ** 2 + r[1] ** 2 < r0 ** 2 + r1 ** 2) {
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      a = oldA;
      c = oldC;
      break;
    }
  }
  return null;
}

// Every pair of handle lengths that gives a cubic curvature k0 at its start and
// k1 at its end, with its ends and handle directions held. The start equation
// gives the start length from the end length in closed form, so the end length
// is scanned and each sign change of the end equation bisected. Lengths stay
// within twice the chord. The pair closest to the curve as given comes first.
export function solveCubicEndCurvatures(curve, k0, k1) {
  const [e, h0, h1, b] = curve;
  const t0 = unit(sub(h0, e)),
    t1 = unit(sub(b, h1)),
    d = sub(b, e);
  const chord = norm(d);
  const a0 = norm(sub(h0, e)),
    c0 = norm(sub(b, h1));
  if (!(chord > 1e-8 && a0 > 1e-8 && c0 > 1e-8)) return [];
  const X = cross(t0, d),
    Y = cross(t0, t1),
    Z = cross(d, t1);
  const place = (a, c) => [
    e,
    { ...h0, x: e.x + a * t0.x, y: e.y + a * t0.y },
    { ...h1, x: b.x - c * t1.x, y: b.y - c * t1.y },
    b,
  ];
  const max = 2 * chord;
  const pairs = [];
  if (Math.abs(k0) < 1e-9) {
    // A straight start fixes the end length; the end equation is then linear
    // in the start length.
    if (Math.abs(Y) > 1e-12) {
      const c = X / Y,
        a = (Z - 1.5 * k1 * c * c) / Y;
      if (c > 0 && c <= max && a > 0 && a <= max) pairs.push([a, c]);
    }
  } else {
    const startLength = (c) => {
      const s = ((2 / 3) * (X - c * Y)) / k0;
      return s > 0 ? Math.sqrt(s) : NaN;
    };
    const f = (c) => {
      const a = startLength(c);
      return Number.isFinite(a) && a <= max ? k1 * c * c - (2 / 3) * (Z - a * Y) : NaN;
    };
    const STEPS = 120;
    let previous = { c: 0, v: f(1e-9) };
    for (let i = 1; i <= STEPS; i++) {
      const c = (max * i) / STEPS,
        v = f(c);
      if (Number.isFinite(v) && Number.isFinite(previous.v) && previous.v * v <= 0) {
        let lo = previous.c,
          hi = c,
          sign = Math.sign(previous.v);
        for (let j = 0; j < 50; j++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(f(mid)) === sign) lo = mid;
          else hi = mid;
        }
        const root = (lo + hi) / 2,
          a = startLength(root);
        if (root > 1e-6 && a > 1e-6) pairs.push([a, root]);
      }
      previous = { c, v };
    }
  }
  return pairs
    .sort(
      ([a1, c1], [a2, c2]) =>
        Math.abs(a1 - a0) / a0 +
        Math.abs(c1 - c0) / c0 -
        (Math.abs(a2 - a0) / a0 + Math.abs(c2 - c0) / c0)
    )
    .map(([a, c]) => place(a, c));
}

// A run of cubics, end to end, made G2 at every join by changing handle
// lengths only: every on-curve and every handle direction stays. `start` and
// `end` are curvatures the run's first start and last end must also meet, or
// null. The answer is the nearest one, as harmonize's nearest answer is: the
// unknowns are the logarithms of the lengths' multipliers and each step is the
// minimum-norm Gauss-Newton step, so the change spreads over every handle in
// proportion to what each can give. Returns the run, or null where it does not
// settle.
export function harmonizeCubicRun(
  curves,
  { start = null, end = null, radius = 1 } = {}
) {
  const frames = curves.map(([e, h0, h1, b]) => {
    const t0 = unit(sub(h0, e)),
      t1 = unit(sub(b, h1)),
      d = sub(b, e);
    return { X: cross(t0, d), Y: cross(t0, t1), Z: cross(d, t1), t0, t1 };
  });
  let lengths = curves.flatMap(([e, h0, h1, b]) => [
    norm(sub(h0, e)),
    norm(sub(b, h1)),
  ]);
  if (lengths.some((l) => !(l > 1e-8))) return null;
  const startK = (i, a, c) => ((2 / 3) * (frames[i].X - c * frames[i].Y)) / (a * a);
  const endK = (i, a, c) => ((2 / 3) * (frames[i].Z - a * frames[i].Y)) / (c * c);
  // Each equation, as a residual and its gradient in the log lengths.
  const equations = (L) => {
    const rows = [];
    const startRow = (i) => {
      const a = L[2 * i],
        c = L[2 * i + 1],
        k = startK(i, a, c);
      const g = Array(L.length).fill(0);
      g[2 * i] = -2 * k;
      g[2 * i + 1] = (-(2 / 3) * frames[i].Y * c) / (a * a);
      return { k, g };
    };
    const endRow = (i) => {
      const a = L[2 * i],
        c = L[2 * i + 1],
        k = endK(i, a, c);
      const g = Array(L.length).fill(0);
      g[2 * i] = (-(2 / 3) * frames[i].Y * a) / (c * c);
      g[2 * i + 1] = -2 * k;
      return { k, g };
    };
    if (start !== null) {
      const s = startRow(0);
      rows.push({ r: (s.k - start) * radius, g: s.g.map((v) => v * radius) });
    }
    for (let i = 0; i + 1 < curves.length; i++) {
      const left = endRow(i),
        right = startRow(i + 1);
      rows.push({
        r: (left.k - right.k) * radius,
        g: left.g.map((v, j) => (v - right.g[j]) * radius),
      });
    }
    if (end !== null) {
      const e = endRow(curves.length - 1);
      rows.push({ r: (e.k - end) * radius, g: e.g.map((v) => v * radius) });
    }
    return rows;
  };
  const MAX_STEP = Math.log(1.4);
  for (let iteration = 0; iteration < 80; iteration++) {
    const rows = equations(lengths);
    const worst = Math.max(...rows.map(({ r }) => Math.abs(r)));
    if (worst < 1e-9) break;
    // Minimum-norm step: solve (J J^T) y = -r, then step = J^T y.
    const m = rows.length;
    const A = rows.map((p) =>
      rows.map(
        (q, j) => p.g.reduce((s, v, k) => s + v * q.g[k], 0) + (p === q ? 1e-12 : 0)
      )
    );
    const y = solveLinear(
      A,
      rows.map(({ r }) => -r)
    );
    if (!y) return null;
    let step = lengths.map((_, k) =>
      rows.reduce((s, row, i) => s + row.g[k] * y[i], 0)
    );
    const largest = Math.max(...step.map(Math.abs));
    if (largest > MAX_STEP) step = step.map((v) => (v * MAX_STEP) / largest);
    lengths = lengths.map((l, k) => l * Math.exp(0.9 * step[k]));
    if (iteration === 79) return null;
  }
  return curves.map(([e, h0, h1, b], i) => [
    e,
    {
      ...h0,
      x: e.x + lengths[2 * i] * frames[i].t0.x,
      y: e.y + lengths[2 * i] * frames[i].t0.y,
    },
    {
      ...h1,
      x: b.x - lengths[2 * i + 1] * frames[i].t1.x,
      y: b.y - lengths[2 * i + 1] * frames[i].t1.y,
    },
    b,
  ]);
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-18) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// The comb step at E, as a fraction of the larger side.
const combStep = (wall, span) => {
  const a = bulbEndCurvature(wall, true),
    b = bulbEndCurvature(span);
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return larger ? Math.abs(a - b) / larger : 0;
};

// If the comb jumps at E, V-slide E along the outer wall toward its centre,
// exactly as the editor's V-slide does on a realized contour: the wall is cut
// exactly and E-B is refit to keep drawing the same path. Stop at the first
// position where the comb is even. If none is, stop where the step is
// smallest. Nothing else is solved.
export function slideBulbEntryForCurvature({
  wall,
  points,
  sourceWall = wall,
  sourceArc = null,
  entryParameter = 1,
}) {
  const entry = points.slice(0, 4);
  const start = combStep(wall, entry);
  if (start < EVEN_STEP) return null;
  const sourceFirst = sourceArc ? sourceArc.map((p) => ({ ...p })) : entry;
  if (sourceArc) {
    sourceFirst[2].x += entry[3].x - sourceFirst[3].x;
    sourceFirst[2].y += entry[3].y - sourceFirst[3].y;
    sourceFirst[3] = entry[3];
  }
  const wallRun = { points: [...sourceWall, ...sourceFirst.slice(1)], isClosed: false };
  let best = null;
  for (let t = Math.min(entryParameter, 1) - 0.01; t >= 0.5 - 1e-9; t -= 0.01) {
    const candidate = makeSlideCandidate(wallRun, 3, "previous", t)?.points;
    if (!candidate) break;
    const keptWall = candidate.slice(0, 4),
      span = candidate.slice(3, 7);
    const step = combStep(keptWall, span);
    if (!best || step < best.step)
      best = {
        wall: keptWall,
        points: [...span, ...points.slice(4)],
        direction: "previous",
        parameter: t,
        step,
      };
    if (step < EVEN_STEP) break;
  }
  return best && best.step < start ? best : null;
}
