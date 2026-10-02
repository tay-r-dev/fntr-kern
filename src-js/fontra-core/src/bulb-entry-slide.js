import { bulbEndCurvature } from "./bulb-harmonization.js";
import { cubicPointAt } from "./offset-contour.js";
import { makeSlideCandidate, projectPointToSegment } from "./point-slide.js";

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

export function slideBulbEntryForCurvature({
  wall,
  points,
  radius,
  sourceWall = wall,
  sourceArc = null,
}) {
  const entry = points.slice(0, 4);
  const target = bulbEndCurvature(points.slice(3, 7));
  const mismatch =
    Math.max(
      Math.abs(bulbEndCurvature(wall, true) - bulbEndCurvature(entry)),
      Math.abs(bulbEndCurvature(entry, true) - target)
    ) * radius;
  if (mismatch < 0.001) return null;
  const ballRun = { points: [...wall, ...entry.slice(1)], isClosed: false };
  const sourceFirst = sourceArc ? sourceArc.map((p) => ({ ...p })) : entry;
  if (sourceArc) {
    sourceFirst[2].x += entry[3].x - sourceFirst[3].x;
    sourceFirst[2].y += entry[3].y - sourceFirst[3].y;
    sourceFirst[3] = entry[3];
  }
  const wallRun = { points: [...sourceWall, ...sourceFirst.slice(1)], isClosed: false };
  // An authored entry may already be boxy. A wall candidate may correct that
  // error, but must not depart farther from the original ball than the input.
  let baselineDeparture = 0;
  for (let k = 0; k <= 32; k++) {
    const p = cubicPointAt(entry, k / 32);
    const distances = [sourceFirst, sourceWall].map((curve) => {
      const q = projectPointToSegment({ kind: "cubic", points: curve }, p).point;
      return norm(sub(p, q));
    });
    baselineDeparture = Math.max(baselineDeparture, Math.min(...distances));
  }
  const maxDeparture = Math.max(0.02 * radius, baselineDeparture);
  let best = null;
  const consider = (direction, t) => {
    const run = direction === "previous" ? wallRun : ballRun;
    const candidate = makeSlideCandidate(run, 3, direction, t).points;
    let keptWall = candidate.slice(0, 4);
    let fitted;
    if (direction === "previous") {
      fitted = matchCubicEndCurvatures(
        candidate.slice(3),
        bulbEndCurvature(keptWall, true),
        target,
        radius
      );
    } else {
      // Keep the ball-side subcurve exact. Only the wall is refit here.
      fitted = candidate.slice(3);
      if (Math.abs(bulbEndCurvature(fitted, true) - target) * radius > 0.001) return;
      keptWall = matchCubicEndCurvatures(
        keptWall,
        bulbEndCurvature(sourceWall),
        bulbEndCurvature(fitted),
        radius
      );
    }
    if (!fitted || !keptWall) return;
    // Measure the old ball span against the new entry span (and retained
    // wall when E advances onto the ball). The rest of the ball is exact.
    let departure = 0;
    for (let k = 0; k <= 32; k++) {
      const p = cubicPointAt(sourceFirst, k / 32);
      const distance = (curve) => {
        const q = projectPointToSegment({ kind: "cubic", points: curve }, p).point;
        return norm(sub(p, q));
      };
      departure = Math.max(departure, Math.min(distance(fitted), distance(keptWall)));
    }
    for (let k = 0; k <= 32; k++) {
      const p = cubicPointAt(fitted, k / 32);
      const distance = (curve) => {
        const q = projectPointToSegment({ kind: "cubic", points: curve }, p).point;
        return norm(sub(p, q));
      };
      departure = Math.max(
        departure,
        Math.min(distance(sourceFirst), distance(sourceWall))
      );
    }
    if (!best || departure < best.departure)
      best = {
        wall: keptWall,
        points: [...fitted, ...points.slice(4)],
        departure,
        direction,
        parameter: t,
      };
  };
  // A valid wall-side solution wins even if a ball-side fit has a smaller
  // numeric score. Otherwise that score repeatedly migrates E onto the ball.
  for (const direction of ["previous", "next"]) {
    best = null;
    for (let i = 1; i <= 45; i++)
      consider(direction, direction === "previous" ? 1 - i / 50 : i / 50);
    for (const window of [0.02, 0.004]) {
      if (!best) break;
      const { parameter } = best;
      for (let i = -4; i <= 4; i++) {
        const t = parameter + (i * window) / 5;
        if (t > 0.01 && t < 0.99) consider(direction, t);
      }
    }
    if (best?.departure <= maxDeparture) return best;
  }
  // V-slide may refit the adjacent span, but never loosen the ball's limits.
  return best?.departure <= maxDeparture ? best : null;
}
