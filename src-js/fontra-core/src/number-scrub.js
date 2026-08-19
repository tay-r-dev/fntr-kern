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
  // Shift is the fine adjust, which is what it means nearly everywhere else.
  // Shift also wins when both are held: overshooting is the expensive mistake,
  // so the tie goes to the slower of the two.
  if (modifiers.shiftKey) {
    return SCRUB_FINE_FACTOR;
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    return SCRUB_COARSE_FACTOR;
  }
  return 1;
}

// What one pointer move is worth. Charged per move rather than over the whole
// travel: changing modifier halfway through has to change the rest of the drag,
// where multiplying the accumulated travel would retroactively rescale what came
// before it and jump the value under the hand.
export function scrubIncrement(pixels, { step, ...modifiers } = {}) {
  return pixels * (step || 1) * scrubFactor(modifiers);
}

// Bring a scrubbed value inside its field's own bounds. Clamping only, with the
// rounding split out below it on purpose: the caller has to fold the clamp back
// into its accumulated travel and must NOT fold the rounding back with it. Doing
// both at once cancels each fine move before it can add up, and the fine modifier
// stops moving anything at all.
export function clampScrubValue(value, { minValue, maxValue } = {}) {
  let result = value;
  if (minValue != null) {
    result = Math.max(result, Number(minValue));
  }
  if (maxValue != null) {
    result = Math.min(result, Number(maxValue));
  }
  return result;
}

// What the field shows and what gets stored. Whole numbers by default: every
// number a scrub can reach is in font units, and the generator quantizes to the
// grid anyway, so a fraction only stores a value the outline never uses — and
// leaves the next drag starting from a number the panel is not showing. A field
// that genuinely wants fractions passes `integer: false`.
export function roundScrubValue(value, { integer = true, step = null } = {}) {
  if (integer) {
    return Math.round(value);
  }
  if (!(step > 0)) {
    return value;
  }
  // A drag of a tenth per pixel lands on 1.2000000000000002 without this, and
  // the box shows every one of those digits. Round onto the step's own grid,
  // then trim the binary residue the multiply leaves behind.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

// What a drag sends instead of a number when it is abandoned rather than
// finished.
//
// A stream carries the CHANGE from where the drag started, so zero would be the
// obvious way to say "put it back" — but zero is also a legal thing to arrive
// at by dragging, and the two want different endings. Landing on zero commits an
// edit that happens to change nothing, and takes an undo step to get past.
// Abandoning commits nothing at all.
//
// A unique object rather than a magic number: no amount of dragging can produce
// it by accident.
export const SCRUB_CANCELLED = Object.freeze({ scrubCancelled: true });

export function isScrubCancelled(value) {
  return value === SCRUB_CANCELLED;
}
