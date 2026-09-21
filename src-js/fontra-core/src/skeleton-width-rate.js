// How the stroke width changes between two on-curve points, and the direction
// the stroke's edge takes because of it.
//
// A width is stored only on an on-curve. Between two on-curves the width eases
// from one to the other, and it passes each on-curve at a rate that point
// owns. Both segments at a smooth on-curve use that one rate, so the edge has
// one direction there and the two generated handles can turn to it together.
// Where the rates equal the segment's own change, the ease is the even change
// the generator always used, so a corner, an open end and a constant width
// draw exactly what they drew before.

// The width at parameter t of a segment whose on-curves carry w0 and w1, and
// which leaves at rate m0 and arrives at rate m1. Rates are per unit of t.
export function easedWidth(w0, w1, m0, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * w0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * w1 +
    (t3 - t2) * m1
  );
}

// The rate of easedWidth at t, per unit of t.
export function easedWidthRate(w0, w1, m0, m1, t) {
  const t2 = t * t;
  return (
    (6 * t2 - 6 * t) * w0 +
    (3 * t2 - 4 * t + 1) * m0 +
    (-6 * t2 + 6 * t) * w1 +
    (3 * t2 - 2 * t) * m1
  );
}

// The one rate a smooth on-curve owns, from the change per unit of length on
// the segment arriving and the segment leaving. The harmonic mean: it is zero
// where the width peaks, bottoms out or stops changing on either side, it never
// exceeds twice the smaller of the two, so the width cannot overshoot a value
// the designer typed, and it is continuous in both inputs.
export function jointWidthRate(arriving, leaving) {
  if (!(arriving * leaving > 0)) {
    return 0;
  }
  return (2 * arriving * leaving) / (arriving + leaving);
}

// How far the edge turns off the skeleton's direction at a place where the
// signed width is `signedWidth`, changing at `rate` per unit of length, on a
// skeleton of signed curvature `curvature` (the solver's own sign convention).
// The edge runs along T (1 + w k) + n w'. Where 1 + w k reaches zero the offset
// cusps, and the angle is held at the quarter turn rather than folding back.
export function edgeTiltAngle(rate, signedWidth, curvature) {
  if (!rate) {
    return 0;
  }
  return Math.atan2(rate, Math.max(1 + signedWidth * curvature, 0));
}
