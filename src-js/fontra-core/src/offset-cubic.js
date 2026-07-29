import {
  parameterizeAgainstCubic,
  solveHandleLengths,
  solveHandleScale,
} from "./fit-cubic.js";
import {
  calculateTunniPoint,
  equalizeTensions,
  shiftTensionsToMean,
} from "./tunni-calculations.js";

//
// One cubic side of a stroke offset: the endpoints and both tangent directions
// are fixed by the ribs and the skeleton, so the only free numbers are two
// handle lengths, and this module is how they are chosen.
//
// ---------------------------------------------------------------------------
// The feasible box
//
// Both lengths are carried as TENSIONS - a handle's length over the distance
// along its own direction to where the two tangent rays meet. In that space the
// useful pairs are a box: `[1/reach, 1]` on each axis. Tension 1 puts a handle
// exactly on the tangent intersection, the fullest a cubic gets before its two
// handle lines cross and the curve loops; the lower end is the one-unit grid
// floor, below which a handle cannot express a direction at all.
//
// **Every stage below produces a point inside that box.** That single invariant
// is what this module is. There is no stage that hands an infeasible pair to a
// later stage to repair, and so there is no stage that has to know what an
// earlier one might have done. It replaces, with one clamp applied wherever a
// number is produced: the correction band on the fit, the chord cap, the
// one-unit floor, the cusp floor on lambda, the tension ceiling in its two
// forms, the scale band on the magnitude re-solve, and the rule that a
// candidate split must be judged as it will be emitted.
//
// It is also the fix for the jitter this construction shipped with. The
// correction loop used to solve UNBOUNDED and reparameterize against whatever it
// got back. On an offset no cubic can represent - a wide stroke on the inside of
// a bend - the least squares asks for a start handle at 2.4x its own reach and a
// NEGATIVE end handle, so the loop's iterate was a self-intersecting curve.
// Newton's root find on a looped curve is multivalued: one sample's parameter
// walked 0.907 -> 0.200 -> 0.319 -> 0.635 across four passes, and a one-unit
// move of the skeleton sent it down a different branch. A fixed trip count makes
// that deterministic; it does not make it continuous. Measured on the reported
// glyph, generated handles oscillated by +-20 units under a 1.7-unit sweep step,
// so the outline jumped and rebounded inside a single-directed drag. Inside the
// box every iterate is a curve you could draw, the root find is single-valued,
// and the loop is a contraction: worst step 27.2 -> 2.2.
//
// ---------------------------------------------------------------------------
// The continuity contract
//
// Regeneration runs on every frame of a drag, so the output must be a continuous
// function of the input. Four properties buy that and none of them is negotiable:
// **fixed trip count, fixed seed, no convergence test, no threshold search.** An
// iteration that stops when it is happy is a step function of its input, and two
// masters can stop at different iterations and stop interpolating. Clamping is
// allowed and iterating is allowed; deciding is not.
//
// Three discontinuities are deliberate, and no continuity test may span them:
// the generator's 0.5-unit collapsed-side threshold, the forward/behind flip of
// the tangent-ray intersection, and grid rounding at emission.
//

const EPSILON = 1e-9;

// The grid floor. A handle shorter than a unit cannot carry a direction: the
// eight lattice neighbours are the only directions expressible at that size.
const MIN_HANDLE_LENGTH = 1;

// Where the tangent rays are an unusable yardstick, the chord stands in.
//
// FLOOR - the intersection slides backwards onto the start point whenever a
// start tangent points near the far endpoint, not only past a 180 degree turn as
// was first assumed. Measured on an ordinary curve, the handle squeezed to 0.6
// units and then sprang back 41.9. A third of the chord at least means
// something: it is the handle length of a neutral cubic.
//
// CAP - with the rays near parallel the intersection runs off to infinity, and a
// handle several times its own chord distends the curve whatever its tension
// says.
const REACH_FLOOR_RATIO = 1 / 3;
const REACH_CAP_RATIO = 2;

// Where the true offset is sampled, and how many times the fit is re-solved
// against re-placed samples. Fixed count, taken every time, no early exit.
const CORRECTION_SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];
const CORRECTION_PASSES = 4;

// How much extra deviation from the true offset the equalization walk may spend
// over what the fit alone achieves: a fraction of the fit's own error, plus a
// floor in font units.
//
// The floor alone was the whole allowance once, and it silenced the walk on
// exactly the segments that need it. Constant-width segments come out of the fit
// at 0.11-0.49 total deviation, so a quarter unit is real room there. Tapered
// ones sit at 3.6-14.4, because handle DIRECTION is skeleton-owned and no length
// can absorb a direction error - and a tapered segment is also where the fit's
// own answer comes out most lopsided, since lambda is applied per end and the
// two ends of a cubic differ in curvature. So the stage that exists to rebalance
// the pair went quiet precisely where the pair was worst, leaving one handle on
// the tension ceiling and its partner starved, off a skeleton whose own two
// handles were symmetric to three decimals.
const EQUALIZE_ALLOWANCE = 0.25;
const EQUALIZE_ALLOWANCE_RATIO = 0.15;

// Bisection on "is this split still within the allowance", from the fitted split
// toward the equal one. Fixed count, no convergence test, no early exit. There
// is deliberately no `if fully equal is affordable, take it` shortcut: that test
// would be a step function, and what it saves is 2^-STEPS of the way to equal.
const EQUALIZE_STEPS = 6;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function tangentIntersectionDistances(q0, u0, q3, u1) {
  const point = calculateTunniPoint([
    q0,
    { x: q0.x + u0.x, y: q0.y + u0.y },
    { x: q3.x + u1.x, y: q3.y + u1.y },
    q3,
  ]);
  if (!point) return { startLimit: Infinity, endLimit: Infinity };
  const startLimit = (point.x - q0.x) * u0.x + (point.y - q0.y) * u0.y;
  const endLimit = (point.x - q3.x) * u1.x + (point.y - q3.y) * u1.y;
  return {
    startLimit: startLimit > EPSILON ? startLimit : Infinity,
    endLimit: endLimit > EPSILON ? endLimit : Infinity,
  };
}

//
// The box, built once per side. `reach` is the yardstick both tensions are
// measured against, so tension 1 is the tangent intersection wherever that is a
// usable distance and the chord backstop where it is not.
//
function feasibleBox(q0, q3, u0, u1) {
  const chord = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const floor = Math.max(chord * REACH_FLOOR_RATIO, MIN_HANDLE_LENGTH);
  const cap = Math.max(chord * REACH_CAP_RATIO, floor);
  const { startLimit, endLimit } = tangentIntersectionDistances(q0, u0, q3, u1);
  const reachOf = (limit) => Math.min(Math.max(limit, floor), cap);
  const startReach = reachOf(startLimit);
  const endReach = reachOf(endLimit);
  return {
    startReach,
    endReach,
    minStart: MIN_HANDLE_LENGTH / startReach,
    minEnd: MIN_HANDLE_LENGTH / endReach,
  };
}

//
// The one place a number is admitted into the pipeline. Anything outside the box
// is pulled to its nearest face, and anything that is not a number at all falls
// back to the last pair that was - so a degenerate solve costs the stage that
// produced it, and nothing downstream needs its own finiteness test.
//
function clampToBox(tensions, box, fallback) {
  const axis = (value, minimum, back) =>
    Number.isFinite(value) ? Math.min(Math.max(value, minimum), 1) : back;
  return {
    start: axis(tensions.start, box.minStart, fallback?.start ?? box.minStart),
    end: axis(tensions.end, box.minEnd, fallback?.end ?? box.minEnd),
  };
}

function tensionsFromLengths(startLength, endLength, box) {
  return { start: startLength / box.startReach, end: endLength / box.endReach };
}

function lengthsFromTensions(tensions, box) {
  return {
    startLength: tensions.start * box.startReach,
    endLength: tensions.end * box.endReach,
  };
}

function offsetPointAt(p0, p1, p2, p3, d0, d3, t) {
  const mt = 1 - t;
  const base = {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
  const deriv = {
    x:
      3 * mt * mt * (p1.x - p0.x) +
      6 * mt * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * mt * mt * (p1.y - p0.y) +
      6 * mt * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
  const speed = Math.hypot(deriv.x, deriv.y);
  if (speed < EPSILON) return base;
  const distance = d0 + (d3 - d0) * t;
  return {
    x: base.x + (deriv.y * distance) / speed,
    y: base.y - (deriv.x * distance) / speed,
  };
}

function cubicAt(a, b, c, d, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t ** 3 * d.x,
    y: mt ** 3 * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t ** 3 * d.y,
  };
}

function sideCurve(q0, q3, u0, u1, startLength, endLength) {
  return [
    q0,
    { x: q0.x + u0.x * startLength, y: q0.y + u0.y * startLength },
    { x: q3.x + u1.x * endLength, y: q3.y + u1.y * endLength },
    q3,
  ];
}

// Worst distance from the true offset to a candidate pair, measured at the
// samples the correction pass already computed. Each sample is re-projected onto
// the candidate before measuring, seeded from the parameters the correction
// settled on: comparing at fixed parameters would charge a candidate for
// parameterization drift rather than for shape.
function offsetDeviation(tensions, box, { q0, q3, u0, u1, samples, parameters }) {
  const { startLength, endLength } = lengthsFromTensions(tensions, box);
  const curve = sideCurve(q0, q3, u0, u1, startLength, endLength);
  const projected = parameterizeAgainstCubic(curve, samples, parameters);
  let worst = 0;
  for (let i = 0; i < samples.length; i++) {
    const point = cubicAt(...curve, projected[i]);
    worst = Math.max(worst, Math.hypot(point.x - samples[i].x, point.y - samples[i].y));
  }
  return worst;
}

function endDerivatives(p0, p1, p2, p3, atEnd) {
  if (atEnd) {
    return {
      d1: { x: 3 * (p3.x - p2.x), y: 3 * (p3.y - p2.y) },
      d2: { x: 6 * (p3.x - 2 * p2.x + p1.x), y: 6 * (p3.y - 2 * p2.y + p1.y) },
    };
  }
  return {
    d1: { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) },
    d2: { x: 6 * (p2.x - 2 * p1.x + p0.x), y: 6 * (p2.y - 2 * p1.y + p0.y) },
  };
}

export function endpointCurvature(p0, p1, p2, p3, atEnd) {
  const { d1, d2 } = endDerivatives(p0, p1, p2, p3, atEnd);
  const speed = Math.hypot(d1.x, d1.y);
  return speed < EPSILON ? 0 : cross(d1, d2) / speed ** 3;
}

//
// Stage 1 - the seed.
//
// Offsetting a cubic preserves its tangent direction exactly and scales its
// speed by `1 + d * curvature`, so the generated handle is the skeleton handle
// scaled by that factor at its OWN end. Past the cusp the factor goes negative,
// which reads as a collapsed handle and lands on the box floor.
//
// Lambda is applied per end and the two ends of a cubic differ in curvature, so
// on anything but an arc the two factors differ - 1.07 against 2.61 on the
// segment that first exposed this. The seed is a starting point, not an answer;
// keeping that asymmetry off the outline is stage 3's job.
//
function seedTensions(p0, p1, p2, p3, d0, d3, box) {
  const startHandle = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const endHandle = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  return clampToBox(
    tensionsFromLengths(
      startHandle * (1 + d0 * endpointCurvature(p0, p1, p2, p3, false)),
      endHandle * (1 + d3 * endpointCurvature(p0, p1, p2, p3, true)),
      box
    ),
    box
  );
}

//
// Stage 2 - the correction.
//
// A sample taken at parameter t does not belong at the generated curve's t. An
// offset is stretched on the convex side and compressed on the concave one, so
// the two parameterizations drift apart, and on an inflected segment they drift
// in opposite directions either side of the inflection. Solving against the
// source's own parameters fits the wrong correspondence and returns lengths that
// are either indistinguishable from the seed or negative. Re-place each sample
// on the curve actually being solved for, then solve again.
//
// The box is entered on every pass, not on the way out. That is the whole of the
// jitter fix: it is what keeps each iterate a curve the samples can be projected
// onto unambiguously.
//
function correctTensions(seed, box, context) {
  const { q0, q3, u0, u1, samples } = context;
  let tensions = seed;
  let parameters = CORRECTION_SAMPLE_TS;
  for (let pass = 0; pass < CORRECTION_PASSES; pass++) {
    const { startLength, endLength } = lengthsFromTensions(tensions, box);
    parameters = parameterizeAgainstCubic(
      sideCurve(q0, q3, u0, u1, startLength, endLength),
      samples,
      parameters
    );
    const { alphaL, alphaR } = solveHandleLengths(
      [q0, ...samples, q3],
      [0, ...parameters, 1],
      u0,
      u1
    );
    tensions = clampToBox(tensionsFromLengths(alphaL, alphaR, box), box, tensions);
  }
  return { tensions, parameters };
}

//
// Stage 3 - the split.
//
// A cubic's tension is exactly the harmonic mean of its two handles' tensions,
// so a pair decomposes into a MAGNITUDE and a SPLIT. This stage owns the split:
// it walks from the fitted one toward fully equal for as long as the allowance
// holds, and stops where the deviation from the true offset has grown past what
// the fit alone achieves by more than the allowance.
//
// Each candidate is measured at ITS OWN best magnitude, re-solved in closed form
// by `solveHandleScale` - the two-handle normal equations collapsed onto one
// unknown along the ray through the candidate. Redistributing tension moves the
// curve, so a candidate judged at the fitted magnitude is charged for a scale
// nobody would pair it with, and the walk rejects magnitudes while believing it
// is rejecting splits. The re-solve is exactly inert on the joint optimum, so a
// segment the fit got right passes through unchanged.
//
// The candidate is normalized to the fitted pair's magnitude before the scale is
// solved. `equalizeTensions` holds the harmonic mean, and the mean of a pair with
// one dead handle is itself dead, so an un-normalized equal candidate arrives as
// two near-zero handles: a direction that is right and a magnitude that means
// nothing.
//
function balanceSplit(fitted, box, context) {
  const { q0, q3, u0, u1, samples, parameters } = context;
  const fittedLengths = lengthsFromTensions(fitted, box);
  const fittedNorm = Math.hypot(fittedLengths.startLength, fittedLengths.endLength);
  const candidateAt = (amount) => {
    const split = equalizeTensions(fitted, amount);
    let { startLength, endLength } = lengthsFromTensions(split, box);
    const norm = Math.hypot(startLength, endLength);
    if (norm > EPSILON && fittedNorm > EPSILON) {
      startLength = (startLength / norm) * fittedNorm;
      endLength = (endLength / norm) * fittedNorm;
    }
    const scale = solveHandleScale(
      [q0, ...samples, q3],
      [0, ...parameters, 1],
      u0,
      u1,
      startLength,
      endLength
    );
    return clampToBox(
      tensionsFromLengths(startLength * scale, endLength * scale, box),
      box,
      fitted
    );
  };

  // Symmetric geometry arrives here already equal, so the walk has nowhere to go
  // and costs nothing. The baseline is the candidate at zero rather than the
  // fitted pair itself, so that every value compared is built the same way.
  const baseline = offsetDeviation(candidateAt(0), box, context);
  const threshold = baseline * (1 + EQUALIZE_ALLOWANCE_RATIO) + EQUALIZE_ALLOWANCE;
  let affordable = 0;
  let excessive = 1;
  for (let step = 0; step < EQUALIZE_STEPS; step++) {
    const amount = (affordable + excessive) / 2;
    if (offsetDeviation(candidateAt(amount), box, context) <= threshold) {
      affordable = amount;
    } else {
      excessive = amount;
    }
  }
  return candidateAt(affordable);
}

//
// Stage 4 - the hand.
//
// An attached handle offset is a displacement from wherever the construction put
// the handle, so it rides on top of stages 1 to 3 and survives a skeleton edit.
// It is resolved on the grid, because the point it describes is a point the
// designer placed and sees.
//
function adjustedLength(length, anchor, direction, adjustment) {
  if (!adjustment || adjustment.detached) {
    return length;
  }
  const base = {
    x: anchor.x + direction.x * length,
    y: anchor.y + direction.y * length,
  };
  const placed = {
    x: Math.round(base.x + (adjustment.x || 0)),
    y: Math.round(base.y + (adjustment.y || 0)),
  };
  return (placed.x - anchor.x) * direction.x + (placed.y - anchor.y) * direction.y;
}

// A detached handle is absolute: it is where it was put, and no stage above
// reaches it.
function detachedLength(anchor, direction, adjustment) {
  const placed = {
    x: Math.round(anchor.x + (adjustment.x || 0)),
    y: Math.round(anchor.y + (adjustment.y || 0)),
  };
  return Math.max(
    (placed.x - anchor.x) * direction.x + (placed.y - anchor.y) * direction.y,
    MIN_HANDLE_LENGTH
  );
}

export function offsetCubicSide({
  p0,
  p1,
  p2,
  p3,
  d0,
  d3,
  q0,
  q3,
  u0,
  u1,
  pinnedTension = null,
  startAdjustment = null,
  endAdjustment = null,
}) {
  const box = feasibleBox(q0, q3, u0, u1);
  const samples = CORRECTION_SAMPLE_TS.map((t) =>
    offsetPointAt(p0, p1, p2, p3, d0, d3, t)
  );
  const seed = seedTensions(p0, p1, p2, p3, d0, d3, box);
  const { tensions: fitted, parameters } = correctTensions(seed, box, {
    q0,
    q3,
    u0,
    u1,
    samples,
  });
  const context = { q0, q3, u0, u1, samples, parameters };
  const split = balanceSplit(fitted, box, context);

  const placed = clampToBox(
    tensionsFromLengths(
      adjustedLength(split.start * box.startReach, q0, u0, startAdjustment),
      adjustedLength(split.end * box.endReach, q3, u1, endAdjustment),
      box
    ),
    box,
    split
  );

  // Stage 5 - the pin. Attached adjustments own the split; the pin owns the
  // magnitude, as one shared tension increment. They are orthogonal, so the two
  // compose without a precedence rule and neither overwrites the other. The pin
  // saturates each tension at 1 on its own, which is the box ceiling, so it needs
  // no separate bound.
  const pinned = Number.isFinite(pinnedTension)
    ? clampToBox(shiftTensionsToMean(placed, pinnedTension, 1), box, placed)
    : placed;

  const { startLength, endLength } = lengthsFromTensions(pinned, box);
  return {
    startLength: startAdjustment?.detached
      ? detachedLength(q0, u0, startAdjustment)
      : startLength,
    endLength: endAdjustment?.detached
      ? detachedLength(q3, u1, endAdjustment)
      : endLength,
  };
}
