// The stem wall as the serif sees it: one curve in the terminal's own frame,
// running from the rib end into the stroke, with depth (v) growing inward.
//
// This module knows nothing about serifs, strokes, ribs or contours. It is one
// curve and four questions asked of it. That is what lets the serif's geometry
// attach to the real wall without learning what a stroke is, and lets the
// generator stay out of curve algebra.
//
// Every search here has a fixed sample count and a fixed bisection count. There
// is no convergence test and no tolerance to cross, because a threshold in a
// shape path makes the output a step function of its input.

// Samples used to bracket a crossing before bisecting into it.
const SCAN_SAMPLES = 256;
// Bisection steps. 40 halvings take a bracket of one parameter unit below
// 1e-12, which is far under the grid the result is rounded onto.
const BISECT_STEPS = 40;
// A terminal may consume its own segment and no more. The wall stops short of
// its own far end so a splice always has curve left on both sides of the cut.
const MAX_CONSUMED_FRACTION = 0.95;
// Samples in the arc-length table that resolves that fraction.
const LENGTH_SAMPLES = 256;

function lerp(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

function evaluate(points, t) {
  if (points.length === 2) {
    return lerp(points[0], points[1], t);
  }
  const a = lerp(points[0], points[1], t);
  const b = lerp(points[1], points[2], t);
  const c = lerp(points[2], points[3], t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function derivative(points, t) {
  if (points.length === 2) {
    return { u: points[1].u - points[0].u, v: points[1].v - points[0].v };
  }
  const s = 1 - t;
  return {
    u:
      3 * s * s * (points[1].u - points[0].u) +
      6 * s * t * (points[2].u - points[1].u) +
      3 * t * t * (points[3].u - points[2].u),
    v:
      3 * s * s * (points[1].v - points[0].v) +
      6 * s * t * (points[2].v - points[1].v) +
      3 * t * t * (points[3].v - points[2].v),
  };
}

function normalize(direction) {
  const length = Math.hypot(direction.u, direction.v);
  if (!(length > 0)) {
    return { u: 0, v: 1 };
  }
  return { u: direction.u / length, v: direction.v / length };
}

// The parameter at `fraction` of the curve's own length. A fixed table rather
// than a solve, for the same reason as everything else here.
function parameterAtLengthFraction(points, fraction) {
  let total = 0;
  const cumulative = [0];
  let previous = evaluate(points, 0);
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const current = evaluate(points, i / LENGTH_SAMPLES);
    total += Math.hypot(current.u - previous.u, current.v - previous.v);
    cumulative.push(total);
    previous = current;
  }
  if (!(total > 0)) {
    return fraction;
  }
  const target = total * fraction;
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    if (cumulative[i] >= target) {
      const span = cumulative[i] - cumulative[i - 1];
      const within = span > 0 ? (target - cumulative[i - 1]) / span : 0;
      return (i - 1 + within) / LENGTH_SAMPLES;
    }
  }
  return 1;
}

// Bisect a function that changes sign between `low` and `high`.
function bisect(signAt, low, high) {
  const lowSign = signAt(low) < 0;
  let a = low;
  let b = high;
  for (let step = 0; step < BISECT_STEPS; step++) {
    const mid = (a + b) / 2;
    if (signAt(mid) < 0 === lowSign) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * A wall built from a line (2 points) or a cubic (4 points), in frame
 * coordinates, ordered from the rib end into the stroke.
 * @param {Array<{u: number, v: number}>} points
 */
export function makeSerifWall(points) {
  const maxParameter = parameterAtLengthFraction(points, MAX_CONSUMED_FRACTION);
  const maxDepth = evaluate(points, maxParameter).v;

  const pointAt = (t) => evaluate(points, t);
  const tangentAt = (t) => normalize(derivative(points, t));

  // The first parameter whose depth reaches `depth`. "First" matters: a wall
  // that turns far enough can reach one depth twice, and the serif wants the
  // one nearer the rib end. A wall that never gets that deep is consumed to its
  // limit, which is the continuous answer — as the request grows the parameter
  // slides up to the limit and stays there.
  const parameterAtDepth = (depth) => {
    if (!(depth > pointAt(0).v)) {
      return 0;
    }
    if (depth >= maxDepth) {
      return maxParameter;
    }
    const below = (t) => pointAt(t).v - depth;
    let previous = 0;
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      if (below(t) >= 0) {
        return bisect(below, previous, t);
      }
      previous = t;
    }
    return maxParameter;
  };

  // Where the wall crosses a ray. The sign function is the cross product of the
  // ray direction with the offset to the wall, so its zeros are where the wall
  // meets the ray's line; a crossing behind the ray's origin is discarded.
  const meetRay = (origin, direction) => {
    const cross = (t) => {
      const p = pointAt(t);
      return direction.u * (p.v - origin.v) - direction.v * (p.u - origin.u);
    };
    const ahead = (t) => {
      const p = pointAt(t);
      return direction.u * (p.u - origin.u) + direction.v * (p.v - origin.v) >= 0;
    };
    let previous = 0;
    let previousCross = cross(0);
    if (previousCross === 0 && ahead(0)) {
      return 0;
    }
    for (let i = 1; i <= SCAN_SAMPLES; i++) {
      const t = (i / SCAN_SAMPLES) * maxParameter;
      const current = cross(t);
      if (current === 0) {
        if (ahead(t)) return t;
      } else if (previousCross !== 0 && previousCross < 0 !== current < 0) {
        const hit = bisect(cross, previous, t);
        if (ahead(hit)) return hit;
      }
      previous = t;
      previousCross = current;
    }
    return null;
  };

  return { pointAt, tangentAt, parameterAtDepth, meetRay, maxParameter, maxDepth };
}
