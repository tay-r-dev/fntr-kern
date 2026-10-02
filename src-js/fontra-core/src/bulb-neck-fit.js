import { harmonizeBulb } from "./bulb-harmonization.js";
import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { makeSlideCandidate, projectPointToSegment } from "./point-slide.js";

const copy = (points) => points.map((p) => ({ ...p }));
const curves = (points) =>
  Array.from({ length: (points.length - 1) / 3 }, (_, i) =>
    points.slice(3 * i, 3 * i + 4)
  );
const samples = (points) =>
  curves(points).flatMap((curve) =>
    Array.from({ length: 33 }, (_, i) => cubicPointAt(curve, i / 32))
  );

function closest(point, spans) {
  let best;
  for (const [i, points] of spans.entries()) {
    const hit = projectPointToSegment({ kind: "cubic", points }, point);
    const distance = Math.hypot(hit.point.x - point.x, hit.point.y - point.y);
    if (!best || distance < best.distance)
      best = { start: 6 + 3 * i, t: hit.t, distance, point };
  }
  return best;
}

// Measure the drawn curves in both directions, not corresponding control
// points or equal t values. A changed parameterization is not a shape error.
export function bulbNeckDeparture(points, reference) {
  const a = curves(points),
    b = curves(reference);
  return Math.max(
    ...samples(points).map((p) => closest(p, b).distance),
    ...samples(reference).map((p) => closest(p, a).distance)
  );
}

function merge(a, b) {
  // splitCubicAt returns coordinates only; restore off-curve types before
  // handing the spans to the shared contour V-slide fitter.
  const run = [...a, ...b.slice(1)].map((p, i) => ({
    ...p,
    ...(i % 3 ? { type: "cubic" } : { smooth: true }),
  }));
  return makeSlideCandidate(
    { points: run, isClosed: false },
    3,
    "previous",
    0
  ).points.slice(3);
}

// Reduce C-A-W-Q to C-N-Q. N belongs to the fit, not necessarily to the
// source wall. Fix the body and Q, fit both adjacent spans, and retain the
// preview as an independent target throughout curvature harmonization.
export function fitBulbNeck({
  points,
  reference,
  wall,
  radius,
  nextCurvature,
  neckOffsets,
}) {
  const target = samples(reference);
  const seeds = [];
  for (const t of [0, 0.15, 0.3, 0.5, 0.75, 1]) {
    const split = splitCubicAt(reference.slice(3, 7), t);
    const left =
      t === 0 ? copy(reference.slice(0, 4)) : merge(reference.slice(0, 4), split.first);
    const right =
      t === 1 ? copy(reference.slice(6)) : merge(split.second, reference.slice(6));
    const candidate = [...copy(points.slice(0, 6)), ...left, ...right.slice(1)];
    // Keep authored C and the body fixed, including its vertical tangent.
    const dx = points[6].x - candidate[6].x,
      dy = points[6].y - candidate[6].y;
    for (const i of [6, 7]) {
      candidate[i].x += dx;
      candidate[i].y += dy;
    }
    candidate[7].x = candidate[6].x;
    candidate[9].smooth = true;
    candidate[9].skipColinear = true;
    seeds.push({
      points: candidate,
      departure: bulbNeckDeparture(candidate.slice(6), reference),
    });
  }
  seeds.sort((a, b) => a.departure - b.departure);
  let best;
  for (const seed of seeds.slice(0, 2)) {
    let current = seed.points;
    const preferredPoints = copy(current);
    const preferenceWeights = Array(13).fill(0);
    for (let i = 0; i < 3; i++) {
      const offset = neckOffsets?.[i];
      if (!offset || (!offset.x && !offset.y)) continue;
      preferredPoints[8 + i].x += offset.x;
      preferredPoints[8 + i].y += offset.y;
      preferenceWeights[8 + i] = 0.01;
    }
    for (let round = 0; round < 4; round++) {
      const spans = curves(current.slice(6));
      const curveTargets = target.map((p) => closest(p, spans));
      const fit = harmonizeBulb({
        points: current,
        wall,
        radius,
        nextCurvature,
        movePoints: true,
        apexMotion: 0,
        neckMotion: 2,
        neckTurn: 1.5,
        fixedHandles: [1, 2, 4, 5],
        preferenceWeights,
        preferredPoints,
        curveTargets,
        shapeWeight: 8,
        maxIterations: 70,
      });
      const departure = bulbNeckDeparture(fit.points.slice(6), reference);
      if (Number.isFinite(departure) && (!best || departure < best.departure))
        best = { ...fit, departure };
      current = fit.points;
    }
  }
  // Do not let an endpoint-curvature root override the visible shape. The
  // residual remains available to callers; a bounded fit is not exact G2.
  const fallback = seeds[0];
  if (!best || best.departure > Math.max(0.02 * radius, fallback.departure * 1.25))
    best = fallback;
  return best;
}
