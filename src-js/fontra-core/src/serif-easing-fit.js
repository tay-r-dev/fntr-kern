import { cubicPointAt } from "./offset-contour.js";

const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const along = (p, d, length) => ({ x: p.x + d.x * length, y: p.y + d.y * length });

function sampleRun(cubics) {
  const samples = [{ point: cubics[0][0], length: 0 }];
  for (const cubic of cubics) {
    for (let i = 1; i <= 64; i++) {
      const point = cubicPointAt(cubic, i / 64);
      const previous = samples.at(-1);
      samples.push({
        point,
        length: previous.length + distance(previous.point, point),
      });
    }
  }
  return samples;
}

function pointAtLength(samples, length) {
  let i = 1;
  while (i < samples.length - 1 && samples[i].length < length) i++;
  const a = samples[i - 1],
    b = samples[i];
  const t = b.length > a.length ? (length - a.length) / (b.length - a.length) : 0;
  return along(a.point, subtract(b.point, a.point), t);
}

function distanceToRun(point, samples) {
  let best = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].point,
      b = samples[i].point;
    const d = subtract(b, a);
    const t = Math.max(0, Math.min(1, dot(subtract(point, a), d) / (dot(d, d) || 1)));
    best = Math.min(best, distance(point, along(a, d, t)));
  }
  return best;
}

// A strictly convex two-variable fit: endpoints and tangent directions stay
// fixed, only positive bounded handle lengths vary. Unlike pattern search,
// its unique answer varies continuously as the source curves move.
export function fitSerifEasing(cubics, startDirection, endDirection, preceding) {
  const start = cubics[0][0],
    end = cubics.at(-1)[3];
  const chord = distance(start, end);
  if (chord < 1e-6) return null;
  const unit = (d) => along({ x: 0, y: 0 }, d, 1 / Math.hypot(d.x, d.y));
  const d0 = unit(startDirection),
    d1 = unit(endDirection);
  const samples = sampleRun(cubics);
  const total = samples.at(-1).length;
  const limit = chord;
  let parameters = Array.from({ length: 65 }, (_, i) => i / 64);
  let h0, h1;
  // A fixed number of arc-length reparameterizations improves geometric fit
  // without a closest-point search that can switch between competing roots.
  for (let iteration = 0; iteration < 8; iteration++) {
    // A small quadratic regularizer keeps near-singular fits uniquely defined.
    let aa = 1e-4,
      bb = 1e-4,
      ab = 0;
    let ar = (aa * chord) / 3,
      br = (bb * chord) / 3;
    for (let i = 1; i < 64; i++) {
      const t = parameters[i],
        s = 1 - t;
      const a = 3 * s * s * t,
        b = 3 * s * t * t;
      const base = along(start, subtract(end, start), b + t ** 3);
      const residual = subtract(pointAtLength(samples, (i / 64) * total), base);
      aa += a * a;
      bb += b * b;
      ab += a * b * dot(d0, d1);
      ar += a * dot(d0, residual);
      br += b * dot(d1, residual);
    }
    const clamp = (v) => Math.max(0, Math.min(limit, v));
    const determinant = aa * bb - ab * ab;
    const candidates = [];
    const x = (ar * bb - br * ab) / determinant;
    const y = (br * aa - ar * ab) / determinant;
    if (x >= 0 && x <= limit && y >= 0 && y <= limit) candidates.push([x, y]);
    for (const edge of [0, limit]) {
      candidates.push([edge, clamp((br - ab * edge) / bb)]);
      candidates.push([clamp((ar - ab * edge) / aa), edge]);
    }
    const energy = ([a, b]) =>
      aa * a * a + 2 * ab * a * b + bb * b * b - 2 * ar * a - 2 * br * b;
    candidates.sort((a, b) => energy(a) - energy(b));
    [h0, h1] = candidates[0];
    if (h0 < 1e-6 || h1 < 1e-6) return null;

    const fitted = sampleRun([[start, along(start, d0, h0), along(end, d1, h1), end]]);
    const fittedLength = fitted.at(-1).length;
    parameters = parameters.map((_, i) => {
      const target = (fittedLength * i) / 64;
      let j = 1;
      while (j < fitted.length - 1 && fitted[j].length < target) j++;
      const a = fitted[j - 1].length,
        b = fitted[j].length;
      return (j - 1 + (b > a ? (target - a) / (b - a) : 0)) / 64;
    });
  }

  if (preceding) {
    // Scale both fitted handles together to match incoming curvature. On a
    // monotone interval the curvature equation has at most one answer; refuse
    // competing roots or changes larger than twenty percent.
    const tangent = subtract(preceding[3], preceding[2]);
    const acceleration = {
      x: preceding[3].x - 2 * preceding[2].x + preceding[1].x,
      y: preceding[3].y - 2 * preceding[2].y + preceding[1].y,
    };
    const tangentLength = Math.hypot(tangent.x, tangent.y);
    if (
      tangentLength < 1e-6 ||
      dot(tangent, d0) <= 0 ||
      Math.abs(cross(tangent, d0)) > 1e-6 * tangentLength
    )
      return null;
    const curvature = ((2 / 3) * cross(tangent, acceleration)) / tangentLength ** 3;
    const a = 1.5 * curvature * h0 * h0;
    const b = -h1 * cross(d0, d1);
    const c = -cross(d0, subtract(end, start));
    const residual = (scale) => a * scale * scale + b * scale + c;
    let low = 0.8,
      high = Math.min(1.2, limit / Math.max(h0, h1));
    if (high < low || (2 * a * low + b) * (2 * a * high + b) < 0) return null;
    if (Math.abs(residual(1)) > 1e-9) {
      if (residual(low) * residual(high) > 0) return null;
      const negative = residual(low) < 0;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (residual(mid) < 0 === negative) low = mid;
        else high = mid;
      }
      const scale = (low + high) / 2;
      h0 *= scale;
      h1 *= scale;
    }
  }
  const result = [start, along(start, d0, h0), along(end, d1, h1), end];
  const fitted = sampleRun([result]);
  // Test both directions: a fit must neither cut across nor add a new bulge.
  const tolerance = Math.max(0.5, Math.min(2, total * 0.02));
  if (
    samples.some(({ point }) => distanceToRun(point, fitted) > tolerance) ||
    fitted.some(({ point }) => distanceToRun(point, samples) > tolerance)
  )
    return null;
  return result;
}
