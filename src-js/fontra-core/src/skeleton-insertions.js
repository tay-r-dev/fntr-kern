// An insertion point's geometry, as a pure operation on a side's emitted point
// list. This module knows nothing about skeletons, ribs, contours or
// provenance: the generator owns all of that, the way it owns everything about
// attaching a serif terminal to a stroke. Keeping the geometry out of
// skeleton-generator.js is deliberate. That file is the fork's largest and is
// where defect P6 still bites.

// A parameter is never pushed off its own ends. Zero and one are legal
// settings: the emitted point lands on its neighbour and is emitted anyway,
// because points collapse and do not disappear.
export const SPLIT_MIN_PARAMETER = 1e-9;
export const SPLIT_MAX_PARAMETER = 1 - 1e-9;

/**
 * Cut one side's emitted geometry at a source parameter.
 *
 * The cut is exact. On a cubic it is a de Casteljau split, so the two pieces
 * draw the curve the one piece drew. On a straight it is a linear
 * interpolation, which is exact there. Nothing is refitted and nothing is
 * approximated, which is the whole promise of the feature: adding an insertion
 * point leaves the letter as it was.
 *
 * @param {Array} sidePoints - the side's emitted points, on-curves and handles
 * @param {number} anchorIndex - index of the on-curve the segment starts at
 * @param {number} t - the source parameter, 0 to 1
 * @returns {Object|null} {points, insertedIndex, start, end}
 */
export function splitSideAtParameter(sidePoints, anchorIndex, t) {
  if (!Array.isArray(sidePoints) || !Number.isInteger(anchorIndex)) {
    return null;
  }
  const start = sidePoints[anchorIndex];
  if (!start || start.type) {
    return null;
  }
  let endIndex = -1;
  for (let i = anchorIndex + 1; i < sidePoints.length; i++) {
    if (!sidePoints[i].type) {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    return null;
  }
  const handles = sidePoints.slice(anchorIndex + 1, endIndex);
  if (handles.length !== 0 && handles.length !== 2) {
    return null;
  }
  const end = sidePoints[endIndex];
  const parameter = Math.min(1, Math.max(0, t));

  const cut =
    handles.length === 2
      ? splitCubic(start, handles[0], handles[1], end, parameter)
      : splitLine(start, end, parameter);

  // The two OUTER pieces keep the originals' construction axis and provenance.
  // The smoothing pass runs after this split, and where it finds a handle with
  // no axis it estimates one from the handle's length, which rotates it.
  // Rotating a handle here would change the curve the split promised not to
  // change. De Casteljau puts the outer pieces on the same two lines as the
  // originals, so the axis they were stamped with is still the true one.
  if (handles.length === 2) {
    carryHandleMetadata(cut[0], handles[0]);
    carryHandleMetadata(cut[4], handles[1]);
  }

  const points = [
    ...sidePoints.slice(0, anchorIndex + 1),
    ...cut,
    ...sidePoints.slice(endIndex),
  ];
  return {
    points,
    insertedIndex: anchorIndex + 1 + (handles.length === 2 ? 2 : 0),
    start,
    end,
  };
}

// Everything a later stage reads off a handle and cannot re-derive: the axis it
// was constructed on, and who owns it. Copied by reference to the fields the
// generator publishes, so this module still knows nothing about what they mean.
function carryHandleMetadata(target, source) {
  for (const field of ["_axis", "_provenance", "_handleNudge", "_authoredAdjustment"]) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function splitLine(start, end, t) {
  const at = lerp(start, end, t);
  return [{ x: at.x, y: at.y }];
}

// De Casteljau. The five points it returns replace the two handles between the
// two on-curves: the first piece's two handles, the new on-curve, and the
// second piece's two handles.
function splitCubic(p0, p1, p2, p3, t) {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const at = lerp(d, e, t);
  return [
    { x: a.x, y: a.y, type: "cubic" },
    { x: d.x, y: d.y, type: "cubic" },
    { x: at.x, y: at.y },
    { x: e.x, y: e.y, type: "cubic" },
    { x: c.x, y: c.y, type: "cubic" },
  ];
}

/**
 * Move an emitted on-curve out from the centerline by a ratio.
 *
 * The reference is what the split already drew: the distance from the
 * centerline point at that parameter out to the emitted point. It is read off
 * the geometry rather than interpolated between the two neighbouring ribs,
 * because the generator states no width between ribs and inventing one would be
 * a second answer to a question the outline already answers.
 *
 * A ratio of exactly one returns the input array. That identity is the whole
 * promise of the feature and it is asserted rather than assumed.
 *
 * @param {Array} points - the side's points, after the split
 * @param {number} insertedIndex - the split point's index
 * @param {Object} centerPoint - the centerline point at the same parameter
 * @param {number} ratio - the stored multiplier
 * @returns {Array} a new array, or the input where the ratio is one
 */
export function applyInsertionRatio(points, insertedIndex, centerPoint, ratio) {
  if (ratio === 1 || !centerPoint || !points?.[insertedIndex]) {
    return points;
  }
  const at = points[insertedIndex];
  const moved = points.slice();
  moved[insertedIndex] = {
    ...at,
    x: centerPoint.x + (at.x - centerPoint.x) * ratio,
    y: centerPoint.y + (at.y - centerPoint.y) * ratio,
  };
  return moved;
}

/**
 * Open the joint at an emitted insertion point.
 *
 * The ratio move displaces one on-curve and leaves the four handles around it
 * pointing where the split put them, so the outline turns a corner there.
 * Easing turns the two handles either side of that point toward one shared
 * direction, by a fraction. At zero they keep the directions the split gave
 * them. At one they lie on one line through the point and the joint is smooth.
 *
 * The shared direction is the chord between the two on-curves that bracket the
 * pair. It is symmetric in the two sides, which a rounding has to be, and it
 * needs nothing the caller does not already have.
 *
 * This moves handles only. No on-curve moves at any value, and no neighbouring
 * rib's width is touched. A rib states a width, and a control that quietly
 * restated one would make the panel disagree with the shape.
 *
 * @param {Array} points - the side's points, after the split and the ratio
 * @param {number} insertedIndex - the emitted on-curve's index
 * @param {number} easing - 0 to 1
 * @returns {Array} a new array, or the input where easing is zero
 */
export function applyInsertionEasing(points, insertedIndex, easing) {
  const before = points?.[insertedIndex - 1];
  const after = points?.[insertedIndex + 1];
  if (!easing || !before?.type || !after?.type) {
    return points;
  }
  const outerBefore = points[insertedIndex - 2];
  const outerAfter = points[insertedIndex + 2];
  if (!outerBefore || !outerAfter) {
    return points;
  }
  const chord = normalize({
    x: outerAfter.x - outerBefore.x,
    y: outerAfter.y - outerBefore.y,
  });
  if (!chord) {
    return points;
  }
  const at = points[insertedIndex];
  const eased = points.slice();
  eased[insertedIndex - 1] = turnToward(
    before,
    at,
    { x: -chord.x, y: -chord.y },
    easing
  );
  eased[insertedIndex + 1] = turnToward(after, at, chord, easing);
  return eased;
}

// A handle turned toward a direction by a fraction, keeping its own length.
// Length is kept because easing is a statement about the joint's angle and not
// about how full the two curves are. Changing the length here would move the
// curve where the designer asked only for the corner to open.
function turnToward(handle, anchor, direction, fraction) {
  const current = { x: handle.x - anchor.x, y: handle.y - anchor.y };
  const length = Math.hypot(current.x, current.y);
  if (length < 1e-9) {
    return handle;
  }
  const unit = { x: current.x / length, y: current.y / length };
  const blended = normalize({
    x: unit.x + (direction.x - unit.x) * fraction,
    y: unit.y + (direction.y - unit.y) * fraction,
  });
  if (!blended) {
    return handle;
  }
  return {
    ...handle,
    x: anchor.x + blended.x * length,
    y: anchor.y + blended.y * length,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length < 1e-9 ? null : { x: vector.x / length, y: vector.y / length };
}
