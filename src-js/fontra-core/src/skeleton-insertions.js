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

// How long the insertion point's own two handles are on a cut straight, in font
// units. One unit, not zero: the emitted point has to read as a corner, and a
// corner is what two handles of length one draw. They cannot be left out. The
// piece is a cubic now, and a cubic with no handles at one end is a cubic whose
// end tangent is whatever the far handle says, which is not a corner.
export const INSERTION_STUB_LENGTH = 1;

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
  // Read off the cut itself rather than counted from the input. A straight and
  // a cubic both put the new on-curve in the middle of what they return, but a
  // straight that states no direction falls back to a bare point, and counting
  // would then name a handle as the emitted point.
  return {
    points,
    insertedIndex: anchorIndex + 1 + cut.findIndex((point) => !point.type),
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

// A cut straight becomes two cubics, not two straights.
//
// The two on-curves at the ends of a straight are often smooth points whose
// other handle is held colinear with it. Cutting the straight into two straights
// aims the first one at the insertion point, and once the ratio moves that point
// off the line those ends are no longer smooth: the letter breaks where nothing
// was asked to change. Two cubics whose OUTER handles stay on the original line
// keep both ends pointing exactly where they pointed.
//
// At a ratio of one every one of the six points is on the line, so the two
// cubics draw the straight the one straight drew. The identity holds.
//
// The insertion point's own two handles are stubs, and they travel with it: they
// are what makes it a corner rather than a point with no tangent at all.
function splitLine(start, end, t) {
  const at = lerp(start, end, t);
  const span = { x: end.x - start.x, y: end.y - start.y };
  const direction = normalize(span);
  if (!direction) {
    return [{ x: at.x, y: at.y }];
  }
  const back = { x: -direction.x, y: -direction.y };
  const firstThird = Math.hypot(at.x - start.x, at.y - start.y) / 3;
  const secondThird = Math.hypot(end.x - at.x, end.y - at.y) / 3;
  return [
    along(start, direction, firstThird),
    stub(at, back),
    { x: at.x, y: at.y },
    stub(at, direction),
    along(end, back, secondThird),
  ];
}

function along(anchor, direction, distance) {
  return {
    x: anchor.x + direction.x * distance,
    y: anchor.y + direction.y * distance,
    type: "cubic",
    // The direction this handle was built on. Without it the smoothing pass
    // estimates one from the handle's length and rotates it off the line, which
    // is the one thing this handle exists not to do.
    _axis: { x: direction.x, y: direction.y },
  };
}

// A handle belonging to the insertion point rather than to either end. The flag
// is what tells the ratio move to carry it: the stub states the corner at the
// point, so it has to arrive wherever the point does.
function stub(anchor, direction) {
  return {
    ...along(anchor, direction, INSERTION_STUB_LENGTH),
    _insertionStub: true,
  };
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
  const shift = {
    x: centerPoint.x + (at.x - centerPoint.x) * ratio - at.x,
    y: centerPoint.y + (at.y - centerPoint.y) * ratio - at.y,
  };
  moved[insertedIndex] = { ...at, x: at.x + shift.x, y: at.y + shift.y };
  // A stub handle states the corner at the emitted point, so it travels with
  // the point AND re-aims along the chord to the on-curve it faces. Aiming
  // matters: a stub left parallel to the line it was built on stays colinear
  // with its partner however far the point moves, and two colinear handles are
  // a smooth pass, not the angle a corner is. A de Casteljau handle is left
  // alone: it belongs to the curve the split promised not to change.
  const movedAt = moved[insertedIndex];
  for (const step of [-1, 1]) {
    const index = insertedIndex + step;
    const handle = points[index];
    if (!handle?._insertionStub) {
      continue;
    }
    const length = Math.hypot(handle.x - at.x, handle.y - at.y);
    const neighbour = neighbouringOnCurve(points, insertedIndex, step);
    const aim = neighbour
      ? normalize({
          x: (neighbour.x - movedAt.x) * step,
          y: (neighbour.y - movedAt.y) * step,
        })
      : null;
    moved[index] = aim
      ? {
          ...handle,
          x: movedAt.x + aim.x * step * length,
          y: movedAt.y + aim.y * step * length,
        }
      : { ...handle, x: handle.x + shift.x, y: handle.y + shift.y };
  }
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
    easing,
    smoothHandleLength(points, insertedIndex, -1)
  );
  eased[insertedIndex + 1] = turnToward(
    after,
    at,
    chord,
    easing,
    smoothHandleLength(points, insertedIndex, 1)
  );
  // The two handles on the far side of the joint answer to easing as well: a
  // corner that opens on one side only is not a shape anybody asked for. They
  // are lengthened toward the same third and never turned. Turning one would
  // rotate the handle a smooth on-curve at the end of the piece is held colinear
  // with, and that is the collinearity a cut straight exists to keep.
  for (const step of [-1, 1]) {
    const outerIndex = insertedIndex + 2 * step;
    const anchor = neighbouringOnCurve(points, insertedIndex, step);
    const outer = points[outerIndex];
    if (!outer?.type || !anchor) {
      continue;
    }
    eased[outerIndex] = stretchToward(
      outer,
      anchor,
      easing,
      Math.hypot(anchor.x - at.x, anchor.y - at.y) / 3
    );
  }
  return eased;
}

// A handle moved along its own line toward a length, keeping its direction
// exactly. At zero it is left as it was.
function stretchToward(handle, anchor, fraction, smoothLength) {
  const current = { x: handle.x - anchor.x, y: handle.y - anchor.y };
  const length = Math.hypot(current.x, current.y);
  if (length < 1e-9 || smoothLength === null) {
    return handle;
  }
  const scale = (length + (smoothLength - length) * fraction) / length;
  return {
    ...handle,
    x: anchor.x + current.x * scale,
    y: anchor.y + current.y * scale,
  };
}

// How long a handle at the emitted point would be if the joint were an ordinary
// smooth one: a third of the way to the on-curve on that side. The classical
// third, so an eased joint is as full as any other curve in the outline.
//
// Easing has to reach the length as well as the direction. On a cut straight the
// insertion point's handles start one unit long, and turning a one-unit handle
// moves the drawn curve by less than the width of the line it is drawn with. The
// control would do nothing a designer could see.
function smoothHandleLength(points, insertedIndex, step) {
  const at = points[insertedIndex];
  const neighbour = neighbouringOnCurve(points, insertedIndex, step);
  return neighbour ? Math.hypot(neighbour.x - at.x, neighbour.y - at.y) / 3 : null;
}

// The first on-curve point on one side of an index. The one walker, so the
// handle that aims at a neighbour and the handle that measures against it
// cannot disagree about which neighbour that is.
function neighbouringOnCurve(points, index, step) {
  for (let i = index + step; i >= 0 && i < points.length; i += step) {
    if (!points[i].type) {
      return points[i];
    }
  }
  return null;
}

// A handle turned toward a direction by a fraction, and lengthened toward the
// length a smooth joint would give it by the same fraction. At zero it is left
// exactly as it was, which is the identity the whole feature rests on. At one it
// lies on the shared line at the length any other curve here would use.
function turnToward(handle, anchor, direction, fraction, smoothLength) {
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
  const eased =
    smoothLength === null ? length : length + (smoothLength - length) * fraction;
  return {
    ...handle,
    x: anchor.x + blended.x * eased,
    y: anchor.y + blended.y * eased,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length < 1e-9 ? null : { x: vector.x / length, y: vector.y / length };
}
