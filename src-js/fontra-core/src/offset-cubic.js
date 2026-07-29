import {
  parameterizeAgainstCubic,
  solveHandleLengths,
  solveHandleScale,
} from "./fit-cubic.js";
import {
  calculateTunniPoint,
  equalizeTensions,
  handleTensions,
  shiftTensionsToMean,
} from "./tunni-calculations.js";

// Floor on the offset speed factor lambda, as a fraction of the un-offset handle
// length. A handle far past the cusp keeps this fraction rather than collapsing.
const CUSP_FLOOR = 0.02;

// Blend window for every smooth min/max here, so each bound is EXACTLY inert
// outside its window. Do not substitute a sqrt-based soft floor: that form is
// never exactly inert, shifts lambda by c^2/lambda, and the shift scales with
// handle length - 0.022 units on a 55-unit handle at c = 0.02.
const CUSP_FLOOR_WINDOW = 0.1;

const EPSILON = 1e-9;
const SMOOTH_MIN_WINDOW = 0.15;
const MAX_HANDLE_TO_CHORD_RATIO = 2;
const MIN_HANDLE_LENGTH = 1;
const MIN_HANDLE_WINDOW = 0.5;
const TENSION_LIMIT_FLOOR_RATIO = 1 / 3;
const CORRECTION_SAMPLE_TS = [0.125, 0.25, 0.5, 0.75, 0.875];
const CORRECTION_BAND_LOW = 0.25;
const CORRECTION_BAND_HIGH = 4;
const CORRECTION_BAND_WINDOW = 0.05;

// Fixed trip count, no convergence test, no early exit. That is the whole
// difference between this and the sample-and-fit path that used to live in the
// generator: an adaptive loop's output jumps when its stopping test flips, so it
// is not a continuous function of the skeleton, and two masters can stop at
// different iterations and stop interpolating. A fixed number of passes from a
// fixed seed is just a composition of smooth maps.
const CORRECTION_PASSES = 4;

// How much extra deviation from the true offset equalization may spend over
// what the fit alone achieves: a fraction of the fit's own error, plus a floor
// in font units.
//
// The floor alone was the whole allowance once, and it silenced the walk on
// exactly the segments that need it. Constant-width segments come out of the fit
// at 0.11-0.49 total deviation, so a quarter unit is real room there. Tapered
// ones sit at 3.6-14.4, because handle DIRECTION is pinned to the skeleton (D11)
// and no length can absorb a direction error - and a tapered segment is also
// where the fit's own answer comes out most lopsided, since lambda is applied per
// end and the two ends of a cubic differ in curvature. So the stage that exists
// to rebalance the pair went quiet precisely where the pair was worst, leaving
// one handle on the tension ceiling and its partner starved, off a skeleton whose
// own two handles were symmetric to three decimals.
//
// Sized against the fit's own error, the room to rebalance appears where the
// error is. The floor stays for segments the fit nails, where a proportional
// allowance would be too small to let the walk move at all.
const EQUALIZE_ALLOWANCE = 0.25;
const EQUALIZE_ALLOWANCE_RATIO = 0.25;

// The magnitude re-solve is a least squares like any other here, and gets the
// same treatment as the handle fit: bounded to a band around the split it was
// asked about, so a degenerate system cannot return a wild scale.
const SCALE_BAND_LOW = 0.25;
const SCALE_BAND_HIGH = 4;

// Bisection on "is this split still within the allowance", from the fitted
// split toward the equal one. Fixed count, taken every time, no convergence
// test and no early exit - the same contract the correction pass above lives
// under, and for the same reason.
//
// Note there is no `if fully equal is affordable, take it` shortcut: that test
// would be a step function, and the value it saves is 2^-STEPS of the way to
// equal, which is invisible.
const EQUALIZE_STEPS = 6;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Polynomial smooth minimum: exactly min(a, b) when they differ by more than
// `window`, blending quadratically inside it. C1 at the join.
function smoothMin(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.min(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.min(a, b) - h * h * window * 0.25;
}

// Mirror of smoothMin: exactly max(a, b) outside the window.
function smoothMax(a, b, window) {
  if (!(window > EPSILON) || !Number.isFinite(b)) {
    return Math.max(a, b);
  }
  const h = Math.max(window - Math.abs(a - b), 0) / window;
  return Math.max(a, b) + h * h * window * 0.25;
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

// `limit` is Infinity where there is no ceiling to apply — either the tangent
// rays give no reach ahead, or the segment is pinned and has already had the
// ceiling enforced against the rendered rib ends.
//
// A pinned segment must not be bounded twice. This bound eases into its limit
// over a blend window, so a handle sitting exactly ON the limit still comes back
// about 3.75% short of it; measured against the construction's rib ends while
// the pin was measured against the rendered ones, that shortfall also moved with
// the nudge. A pin of 1 rendered as 0.91-0.96 depending on how the on-curve
// gizmo had been used. The pin's own per-handle cap is the same guarantee - no
// handle past the tangent intersection - stated in the space the number was read
// in, so it is the one that survives.
//
// `hardLimit` is the same ceiling stated exactly, with no blend window, and it is
// what a HAND-PLACED handle gets. The smooth form is right for the fit, whose
// answer must be a continuous function of the skeleton, and wrong for a length the
// designer chose: eased, it lands a few percent short of what was asked for, so a
// handle could never quite reach the tangent intersection and a curvature baked out
// of a pin came back shaved. Measured before this: 5.0 units short at tension 1,
// with the last third of the drag's travel absorbed by the blend window - the
// "resistance" report. Tension 1 is still the wall (D1); it is now exactly where
// the wall is.
function boundLength(length, limit, chord, hardLimit = Infinity) {
  let bounded = Math.min(length, hardLimit);
  if (Number.isFinite(limit)) {
    const flooredLimit = Math.max(limit, chord * TENSION_LIMIT_FLOOR_RATIO);
    bounded = smoothMin(bounded, flooredLimit, SMOOTH_MIN_WINDOW * flooredLimit);
  }
  const chordCap = Math.max(chord * MAX_HANDLE_TO_CHORD_RATIO, EPSILON);
  return smoothMax(
    smoothMin(bounded, chordCap, SMOOTH_MIN_WINDOW * chordCap),
    MIN_HANDLE_LENGTH,
    MIN_HANDLE_WINDOW
  );
}

function easeIntoBand(solved, analytic) {
  if (!Number.isFinite(solved) || !(analytic > EPSILON)) {
    return analytic;
  }
  const window = CORRECTION_BAND_WINDOW * analytic;
  const low = CORRECTION_BAND_LOW * analytic;
  const high = CORRECTION_BAND_HIGH * analytic;
  return smoothMin(smoothMax(solved, low, window), high, window);
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

// Worst distance from the true offset to a candidate pair of handle lengths,
// measured at the samples the correction pass already computed. Each sample is
// re-projected onto the candidate before measuring, seeded from the parameters
// the correction settled on: comparing at fixed parameters would charge a
// candidate for parameterization drift rather than for shape.
function offsetDeviation(q0, q3, u0, u1, startLength, endLength, samples, parameters) {
  const curve = sideCurve(q0, q3, u0, u1, startLength, endLength);
  const projected = parameterizeAgainstCubic(curve, samples, parameters);
  let worst = 0;
  for (let i = 0; i < samples.length; i++) {
    const point = cubicAt(...curve, projected[i]);
    worst = Math.max(worst, Math.hypot(point.x - samples[i].x, point.y - samples[i].y));
  }
  return worst;
}

//
// Steps 2 through 4 of the pipeline: equalize the split, apply attached
// per-handle adjustments, then apply the pin.
//
// Both are stated in tension space and both are no-ops where a tension does not
// exist, so a segment whose tangent rays meet behind an endpoint passes through
// with exactly the lengths the fit gave it.
//
// Every stage uses the construction rib ends. Nudge is a pure emission post-step
// on on-curves and never enters handle length, reach, adjustment, or pin math.
//
function shapeTensions(
  startLength,
  endLength,
  startReach,
  endReach,
  { q0, q3, u0, u1, samples, parameters, pinnedTension, startAdjustment, endAdjustment }
) {
  const fitted = handleTensions(startLength, endLength, startReach, endReach);
  if (!fitted) {
    return { startLength, endLength, pinned: false };
  }

  // A candidate split, taken at ITS OWN best magnitude. Walking the split alone
  // moves the curve, so every candidate but the fitted one would be measured
  // carrying a magnitude that does not belong to it, and the walk would be
  // rejecting magnitudes while believing it was rejecting splits. Re-solving the
  // scale costs one closed form and is exactly inert on the fitted pair, which
  // is already the joint optimum.
  //
  // The candidate is normalized to the fitted pair's magnitude before the scale
  // is solved, so the band below means "how far the magnitude may travel from
  // the fit's" rather than being read against whatever magnitude the ratio path
  // happened to leave behind. equalizeTensions holds the harmonic mean, and the
  // mean of a pair with one dead handle is itself dead, so an un-normalized
  // equal candidate arrives as two near-zero handles - a direction that is
  // right and a magnitude that is meaningless.
  const fittedNorm = Math.hypot(startLength, endLength);
  const lengthsFor = (tensions) => {
    let rayStart = tensions.start * startReach;
    let rayEnd = tensions.end * endReach;
    const norm = Math.hypot(rayStart, rayEnd);
    if (norm > EPSILON && fittedNorm > EPSILON) {
      rayStart = (rayStart / norm) * fittedNorm;
      rayEnd = (rayEnd / norm) * fittedNorm;
    }
    const scale = solveHandleScale(
      [q0, ...samples, q3],
      [0, ...parameters, 1],
      u0,
      u1,
      rayStart,
      rayEnd
    );
    const bounded = Math.min(Math.max(scale, SCALE_BAND_LOW), SCALE_BAND_HIGH);
    return { startLength: rayStart * bounded, endLength: rayEnd * bounded };
  };
  const deviationOf = (lengths) =>
    offsetDeviation(
      q0,
      q3,
      u0,
      u1,
      lengths.startLength,
      lengths.endLength,
      samples,
      parameters
    );

  // Walk from the fitted split toward the equal one for as long as the
  // allowance holds. Symmetric geometry arrives here already equal, so the walk
  // has nowhere to go and costs nothing.
  //
  // The allowance is a FRACTION of what the fit itself achieves, plus a floor.
  // A flat quarter unit was room on a constant-width segment (they fit to
  // 0.11-0.49) and nothing at all on a tapered one (3.6-14.4), because handle
  // direction is skeleton-owned there and no length can absorb a direction
  // error. So the walk went quiet on precisely the segments whose fit comes out
  // lopsided, and the lopsided split stood - one handle on the tension ceiling,
  // its partner starved, from a skeleton whose own two tensions were equal to
  // three decimals. Sized against the fit's own error, the room to rebalance
  // appears where the error is.
  const fittedLengths = lengthsFor(fitted);
  const fittedDeviation = deviationOf(fittedLengths);
  const threshold =
    fittedDeviation * (1 + EQUALIZE_ALLOWANCE_RATIO) + EQUALIZE_ALLOWANCE;
  let affordable = 0;
  let excessive = 1;
  for (let step = 0; step < EQUALIZE_STEPS; step++) {
    const amount = (affordable + excessive) / 2;
    if (deviationOf(lengthsFor(equalizeTensions(fitted, amount))) <= threshold) {
      affordable = amount;
    } else {
      excessive = amount;
    }
  }
  const shaped = equalizeTensions(fitted, affordable);
  const equalized = lengthsFor(shaped);
  const adjusted = {
    startLength: startAdjustment?.detached
      ? equalized.startLength
      : adjustedHandleLength(equalized.startLength, q0, u0, startAdjustment),
    endLength: endAdjustment?.detached
      ? equalized.endLength
      : adjustedHandleLength(equalized.endLength, q3, u1, endAdjustment),
    pinned: false,
  };
  if (!Number.isFinite(pinnedTension)) {
    return adjusted;
  }

  // Attached adjustments own the split; the shared tension increment owns the
  // magnitude. Applying the pin after those offsets keeps both edits stable.
  const adjustedTensions = handleTensions(
    adjusted.startLength,
    adjusted.endLength,
    startReach,
    endReach
  );
  if (!adjustedTensions) {
    return adjusted;
  }
  const shifted = shiftTensionsToMean(adjustedTensions, pinnedTension, 1);
  return {
    startLength: shifted.start * startReach,
    endLength: shifted.end * endReach,
    pinned: true,
  };
}

// An attached adjustment with something in it is a length the designer placed.
// A zero one is not: every attached handle carries an adjustment object whether or
// not it has ever been touched, so testing for the object alone would hand the
// exact ceiling to the whole outline.
function isHandPlaced(adjustment) {
  return (
    !!adjustment && !adjustment.detached && !!(adjustment.x || 0 || adjustment.y || 0)
  );
}

function adjustedHandleLength(length, anchor, direction, adjustment) {
  if (!adjustment) {
    return length;
  }
  const base = adjustment.detached
    ? anchor
    : {
        x: anchor.x + direction.x * length,
        y: anchor.y + direction.y * length,
      };
  const adjusted = {
    x: Math.round(base.x + (adjustment.x || 0)),
    y: Math.round(base.y + (adjustment.y || 0)),
  };
  const along =
    (adjusted.x - anchor.x) * direction.x + (adjusted.y - anchor.y) * direction.y;
  return Math.max(along, MIN_HANDLE_LENGTH);
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
  const startHandle = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const endHandle = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const startLambda = smoothMax(
    1 + d0 * endpointCurvature(p0, p1, p2, p3, false),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );
  const endLambda = smoothMax(
    1 + d3 * endpointCurvature(p0, p1, p2, p3, true),
    CUSP_FLOOR,
    CUSP_FLOOR_WINDOW
  );
  const analyticStart = startHandle * startLambda;
  const analyticEnd = endHandle * endLambda;
  const samples = CORRECTION_SAMPLE_TS.map((t) =>
    offsetPointAt(p0, p1, p2, p3, d0, d3, t)
  );
  // A sample taken at parameter t does not belong at the generated curve's t.
  // An offset is stretched on the convex side and compressed on the concave one,
  // so the two parameterizations drift apart - and on an inflected segment they
  // drift in opposite directions either side of the inflection. Solving against
  // the source's own parameters therefore fits the wrong correspondence, and
  // returns lengths that are either indistinguishable from the analytic ones or
  // negative. Re-place each sample on the curve actually being solved for, then
  // solve again; the band keeps every iterate positive so the next pass has a
  // real curve to project onto.
  let correctedStart = analyticStart;
  let correctedEnd = analyticEnd;
  let parameters = CORRECTION_SAMPLE_TS;
  for (let pass = 0; pass < CORRECTION_PASSES; pass++) {
    parameters = parameterizeAgainstCubic(
      [
        q0,
        { x: q0.x + u0.x * correctedStart, y: q0.y + u0.y * correctedStart },
        { x: q3.x + u1.x * correctedEnd, y: q3.y + u1.y * correctedEnd },
        q3,
      ],
      samples,
      parameters
    );
    const { alphaL, alphaR } = solveHandleLengths(
      [q0, ...samples, q3],
      [0, ...parameters, 1],
      u0,
      u1
    );
    correctedStart = easeIntoBand(alphaL, analyticStart);
    correctedEnd = easeIntoBand(alphaR, analyticEnd);
  }
  const chord = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const { startLimit, endLimit } = tangentIntersectionDistances(q0, u0, q3, u1);
  // The reaches the bounds already use are the same reaches a tension is
  // measured against, so tension space costs nothing extra to enter here.
  const shaped = shapeTensions(correctedStart, correctedEnd, startLimit, endLimit, {
    q0,
    q3,
    u0,
    u1,
    samples,
    parameters,
    pinnedTension,
    startAdjustment,
    endAdjustment,
  });
  const pinned = shaped.pinned;
  // Which ceiling each end gets: none if the segment is pinned, since the pin
  // saturates its own tensions at 1; the exact one if the handle carries an
  // attached adjustment, because that length was chosen by hand; the smooth one
  // otherwise, because that length is the fit's and has to stay continuous.
  const boundsFor = (adjustment, limit) =>
    pinned
      ? [Infinity, Infinity]
      : isHandPlaced(adjustment)
        ? [Infinity, limit]
        : [limit, Infinity];
  const [startSmooth, startHard] = boundsFor(startAdjustment, startLimit);
  const [endSmooth, endHard] = boundsFor(endAdjustment, endLimit);
  return {
    startLength: startAdjustment?.detached
      ? adjustedHandleLength(0, q0, u0, startAdjustment)
      : boundLength(shaped.startLength, startSmooth, chord, startHard),
    endLength: endAdjustment?.detached
      ? adjustedHandleLength(0, q3, u1, endAdjustment)
      : boundLength(shaped.endLength, endSmooth, chord, endHard),
  };
}
