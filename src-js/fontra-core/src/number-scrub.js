// Turning sideways pointer movement into a number, the way a design tool does.
// No DOM in here: the form component owns the pointer events, this owns what
// they are worth. That split is also the only way any of it gets tested, since
// the view packages carry no test harness.
//
// Linear, deliberately. An accelerating scrub returns a different number for the
// same hand movement depending on how fast the hand moved, so nothing about the
// control can be learned and no round value can be landed on without watching
// the readout. Precision comes from the modifiers instead.

// How far the pointer has to travel before a press counts as a drag rather than
// a click, so reaching for the field beside a label does not nudge its value.
export const SCRUB_THRESHOLD = 3;

export const SCRUB_COARSE_FACTOR = 10;
export const SCRUB_FINE_FACTOR = 0.1;

export function scrubFactor(modifiers = {}) {
  // Shift wins when both are held: shift already means "more" on the arrow keys
  // in these same fields, so a hand holding both gets the same answer it gets
  // there rather than an arbitrary one.
  if (modifiers.shiftKey) {
    return SCRUB_COARSE_FACTOR;
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    return SCRUB_FINE_FACTOR;
  }
  return 1;
}

// What one pointer move is worth. Charged per move rather than over the whole
// travel: pressing shift halfway through has to speed up the rest of the drag,
// where multiplying the accumulated travel would retroactively rescale what came
// before it and jump the value under the hand.
export function scrubIncrement(pixels, { step, ...modifiers } = {}) {
  return pixels * (step || 1) * scrubFactor(modifiers);
}

// Bring a scrubbed value inside its field's own bounds. The caller carries the
// travel unrounded and rounds only here, so ten fine moves under a whole-number
// field still add up to one instead of each rounding away to nothing.
export function clampScrubValue(value, { minValue, maxValue, integer } = {}) {
  let result = integer ? Math.round(value) : value;
  if (minValue != null) {
    result = Math.max(result, Number(minValue));
  }
  if (maxValue != null) {
    result = Math.min(result, Number(maxValue));
  }
  return result;
}
