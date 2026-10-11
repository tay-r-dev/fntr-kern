import { Bezier } from "bezier-js";
import { bulbEndCurvature } from "./bulb-harmonization.js";
import { cubicPointAt } from "./offset-contour.js";
import { makeSlideCandidate } from "./point-slide.js";

// The smallest shape tolerance, in units.
const MIN_SHAPE_TOLERANCE = 2;
const cross = (a, b) => a.x * b.y - a.y * b.x;
// One curve object per target: it caches its lookup table, which a fresh
// object per projection rebuilds every time.
const distanceTo = (curve) => {
  const bezier = new Bezier(curve);
  return (p) => {
    const q = bezier.project(p);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
};
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

export function slideBulbEntryForCurvature({
  wall,
  points,
  radius,
  sourceWall = wall,
  sourceArc = null,
  entryParameter = 1,
}) {
  const entry = points.slice(0, 4);
  const target = bulbEndCurvature(points.slice(3, 7));
  const mismatch =
    Math.max(
      Math.abs(bulbEndCurvature(wall, true) - bulbEndCurvature(entry)),
      Math.abs(bulbEndCurvature(entry, true) - target)
    ) * radius;
  if (mismatch < 0.001) return null;
  const sourceFirst = sourceArc ? sourceArc.map((p) => ({ ...p })) : entry;
  if (sourceArc) {
    sourceFirst[2].x += entry[3].x - sourceFirst[3].x;
    sourceFirst[2].y += entry[3].y - sourceFirst[3].y;
    sourceFirst[3] = entry[3];
  }
  const wallRun = { points: [...sourceWall, ...sourceFirst.slice(1)], isClosed: false };
  const toSourceFirst = distanceTo(sourceFirst),
    toSourceWall = distanceTo(sourceWall);
  // How far a curve set strays from the reference ball and the outer wall,
  // both ways. The fit must reproduce both; this is a requirement, not a
  // tie-break.
  const departureOf = (span, keptWall) => {
    const toSpan = distanceTo(span),
      toKeptWall = distanceTo(keptWall);
    let departure = 0;
    for (const [curve, toA, toB] of [
      [sourceFirst, toSpan, toKeptWall],
      [span, toSourceFirst, toSourceWall],
    ])
      for (let k = 0; k <= 32; k++) {
        const p = cubicPointAt(curve, k / 32);
        departure = Math.max(departure, Math.min(toA(p), toB(p)));
      }
    return departure;
  };
  // Never finer than the grid: 2% of a small ball (0.92 units on skeletron
  // `h`) refused every fit a hand V-slide makes, and left a 64% jump.
  const tolerance = Math.max(
    0.02 * radius,
    MIN_SHAPE_TOLERANCE,
    departureOf(entry, wall)
  );
  // The wall piece E keeps is exact; only E-B's two lengths are solved, to
  // meet the wall's curvature at E and B-C's at B.
  const fitAt = (keptWall, span, parameter, direction) => {
    const fitted = matchCubicEndCurvatures(
      span,
      bulbEndCurvature(keptWall, true),
      target,
      radius
    );
    if (!fitted) return null;
    const departure = departureOf(fitted, keptWall);
    if (departure > tolerance) return null;
    return {
      wall: keptWall,
      points: [...fitted, ...points.slice(4)],
      departure,
      direction,
      parameter,
    };
  };
  // 1. E at the extreme, orthogonal, with the outer wall exact.
  const atExtreme = fitAt(wall, entry, entryParameter, "stationary");
  if (atExtreme) return atExtreme;
  // 2. Otherwise V-slide E along the outer wall toward its centre, and stop
  // at the first position that fits. Never past the centre.
  for (let t = Math.min(entryParameter, 1) - 0.01; t >= 0.5 - 1e-9; t -= 0.01) {
    const candidate = makeSlideCandidate(wallRun, 3, "previous", t).points;
    const slid = fitAt(candidate.slice(0, 4), candidate.slice(3), t, "previous");
    if (slid) return slid;
  }
  // Nothing fits both shapes: E stays at the extreme, and the remaining jump
  // is published through the bulb's harmonization error.
  return null;
}
