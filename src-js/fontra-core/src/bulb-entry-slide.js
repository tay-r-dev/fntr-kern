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
