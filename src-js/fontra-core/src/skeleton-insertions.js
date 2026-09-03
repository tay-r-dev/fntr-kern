import { cubicPointAt, splitCubicAt } from "./offset-contour.js";
import { intersect } from "./vector.js";

// An insertion point's geometry, as a pure operation on a side's emitted point
// list. This module knows nothing about skeletons, ribs, contours or
// provenance: the generator owns all of that, the way it owns everything about
// attaching a serif terminal to a stroke. Keeping the geometry out of
// skeleton-generator.js is deliberate. That file is the fork's largest and is
// where defect P6 still bites.

// The parameter is clamped to 0 and 1 and no further in. Zero and one are legal
// settings: the emitted point lands on its neighbour and is emitted anyway,
// because points collapse and do not disappear. A pair of constants here once
// held the ends open by a billionth and was applied nowhere, which is the same
// rule stated twice and obeyed once.

// A handle that states nothing yet. It sits exactly on its own on-curve, so the
// piece it belongs to draws the straight line it was cut from and the joint at
// the emitted point is a plain angle. It is emitted rather than left out,
// because points collapse and do not disappear: the count must not change with
// the value of a setting.
export const INSERTION_STUB_LENGTH = 0;

// How many halvings the per-side parameter search takes. Fixed on purpose: a
// search that picks its own trip count cannot be continuous in its input, and
// this runs on every frame of a slide.
const NORMAL_SEARCH_TRIPS = 40;

/**
 * Where on one side the rib at a centerline point lands.
 *
 * Not the source parameter. The two sides of a segment are not the same length:
 * at a corner the outer side is carried on to the miter and the inner side is
 * cut back, so the same parameter reaches a different fraction of each. The rib
 * then leans, by eleven degrees on the stem of an F.
 *
 * The answer is the parameter at which the side crosses the line through the
 * centerline point at right angles to the centerline. That is what a rib is, so
 * the bar comes out normal to the centerline on both sides, at a corner as
 * anywhere else. On a plain parallel offset it is the source parameter exactly.
 *
 * @param {Array} sidePoints - the side's emitted points
 * @param {number} anchorIndex - index of the on-curve the piece starts at
 * @param {Object} center - the centerline point
 * @param {Object} tangent - the centerline direction there, any length
 * @returns {number|null} the parameter, or null where the side has no piece
 */
export function sideParameterOnNormal(sidePoints, anchorIndex, center, tangent) {
  const piece = sidePiece(sidePoints, anchorIndex);
  const direction = normalize(tangent);
  if (!piece || !direction || !center) {
    return null;
  }
  // How far along the centerline the side sits at this parameter. Zero is on
  // the rib. It runs from one sign to the other across a piece that spans the
  // rib, which is what makes the halving exact.
  const along = (u) => {
    const at = evaluatePiece(piece, u);
    return (at.x - center.x) * direction.x + (at.y - center.y) * direction.y;
  };
  let low = 0;
  let high = 1;
  const atLow = along(low);
  if (atLow * along(high) > 0) {
    // The rib does not cross this piece at all. The nearer end is the honest
    // answer: the point collapses onto it rather than disappearing.
    return Math.abs(atLow) <= Math.abs(along(high)) ? 0 : 1;
  }
  for (let trip = 0; trip < NORMAL_SEARCH_TRIPS; trip++) {
    const middle = (low + high) / 2;
    if (along(middle) * atLow <= 0) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return (low + high) / 2;
}

// The four or two points of the piece a side starts at an on-curve, or null.
function sidePiece(sidePoints, anchorIndex) {
  if (!Array.isArray(sidePoints) || !Number.isInteger(anchorIndex)) {
    return null;
  }
  const start = sidePoints[anchorIndex];
  if (!start || start.type) {
    return null;
  }
  for (let i = anchorIndex + 1; i < sidePoints.length; i++) {
    if (!sidePoints[i].type) {
      const handles = sidePoints.slice(anchorIndex + 1, i);
      if (handles.length !== 0 && handles.length !== 2) {
        return null;
      }
      return [start, ...handles, sidePoints[i]];
    }
  }
  return null;
}

function evaluatePiece(piece, u) {
  return piece.length === 2 ? lerp(piece[0], piece[1], u) : cubicPointAt(piece, u);
}

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
  // A straight of no length states no direction, and every one of the five
  // points then sits on the one place the straight occupies. They are still all
  // five emitted: the two sides of a stroke are cut by the same insertion, and a
  // side that answered with one point where its partner answered with five would
  // give the two edges of one stroke different point counts, which is the
  // interpolation contract broken by a degenerate input rather than by a
  // setting.
  const direction = normalize(span) ?? { x: 0, y: 0 };
  const back = { x: -direction.x, y: -direction.y };
  // An outer handle is only needed where the on-curve it belongs to is smooth:
  // there it holds the point's other handle colinear, which is the whole reason
  // a cut straight becomes a curve. At a corner there is nothing to hold, so it
  // collapses onto its on-curve and the piece draws a plain straight line.
  const firstThird = start.smooth ? Math.hypot(at.x - start.x, at.y - start.y) / 3 : 0;
  const secondThird = end.smooth ? Math.hypot(end.x - at.x, end.y - at.y) / 3 : 0;
  return [
    along(start, direction, firstThird),
    stub(at, back),
    { x: at.x, y: at.y },
    stub(at, direction),
    along(end, back, secondThird),
  ];
}

function along(anchor, direction, distance) {
  const handle = {
    x: anchor.x + direction.x * distance,
    y: anchor.y + direction.y * distance,
    type: "cubic",
  };
  // The direction this handle was built on. Without it the smoothing pass
  // estimates one from the handle's length and rotates it off the line, which
  // is the one thing this handle exists not to do.
  //
  // A straight of no length has no direction to state, and a zero axis is not
  // one: it would say "this way" and point nowhere. The handle is emitted
  // without an axis there, and the estimate it falls back to has nothing to
  // rotate.
  if (direction.x || direction.y) {
    handle._axis = { x: direction.x, y: direction.y };
  }
  return handle;
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
  const { first, second } = splitCubicAt([p0, p1, p2, p3], t);
  const [, a, d, at] = first;
  const [, e, c] = second;
  // De Casteljau leaves the two inner handles and the new on-curve on one line:
  // that is what makes the two pieces meet without a kink. The point is marked
  // smooth to say so, and the two handles are marked as its own so the ratio
  // move carries them with it and the line survives the move.
  return [
    { x: a.x, y: a.y, type: "cubic" },
    { x: d.x, y: d.y, type: "cubic", _insertionSmooth: true },
    { x: at.x, y: at.y, smooth: true },
    { x: e.x, y: e.y, type: "cubic", _insertionSmooth: true },
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
    // On a cut curve the two handles are on one line through the point. They
    // travel with it, so the point stays a smooth one however far the width
    // takes it. Leaving them behind turned every swell on a curve into a kink.
    if (handle?._insertionSmooth) {
      moved[index] = { ...handle, x: handle.x + shift.x, y: handle.y + shift.y };
      continue;
    }
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
    if (!aim) {
      moved[index] = { ...handle, x: handle.x + shift.x, y: handle.y + shift.y };
      continue;
    }
    // The aim is published, not only applied. A collapsed handle has no
    // direction of its own to recover, and easing needs one to grow along.
    moved[index] = {
      ...handle,
      _axis: { x: aim.x * step, y: aim.y * step },
      x: movedAt.x + aim.x * step * length,
      y: movedAt.y + aim.y * step * length,
    };
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
  for (const step of [-1, 1]) {
    const index = insertedIndex + step;
    const handle = points[index];
    // On a cut curve the two handles are already on one line: the split put
    // them there and the ratio move carried them. There is no corner to open,
    // so easing says how full the joint is instead, and it runs the handle out
    // toward the far end of what a smooth curve can take. Turning it as well
    // would move a curve the designer asked only to fill out.
    if (handle._insertionSmooth) {
      eased[index] = stretchToward(
        handle,
        at,
        Math.abs(easing),
        easing < 0 ? 0 : tensionLimit(points, insertedIndex, step)
      );
      continue;
    }
    // Below zero there is no corner to open, only a handle to pull in, so the
    // turn takes the positive part alone.
    eased[index] = turnToward(
      handle,
      at,
      step < 0 ? { x: -chord.x, y: -chord.y } : chord,
      Math.max(0, easing),
      Math.abs(easing),
      easing < 0 ? 0 : smoothHandleLength(points, insertedIndex, step)
    );
  }
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
    // The positive side only. Pulling a neighbour's handle to nothing would
    // take away the direction a smooth on-curve at the end of the piece is held
    // colinear with, which is the collinearity a cut straight exists to keep.
    eased[outerIndex] = stretchToward(
      outer,
      anchor,
      Math.max(0, easing),
      Math.hypot(anchor.x - at.x, anchor.y - at.y) / 3
    );
  }
  return eased;
}

// A handle moved along its own line toward a length, keeping its direction
// exactly. At zero it is left as it was.
function stretchToward(handle, anchor, fraction, smoothLength) {
  if (smoothLength === null) {
    return handle;
  }
  const current = { x: handle.x - anchor.x, y: handle.y - anchor.y };
  const length = Math.hypot(current.x, current.y);
  // A handle collapsed onto its on-curve states no direction, so it takes the
  // one it was built on. That is the case at a corner, where the handle starts
  // at nothing and easing is the only thing that gives it a length.
  const unit =
    length < 1e-9
      ? normalize(handle._axis)
      : { x: current.x / length, y: current.y / length };
  if (!unit) {
    return handle;
  }
  const eased = length + (smoothLength - length) * fraction;
  return {
    ...handle,
    x: anchor.x + unit.x * eased,
    y: anchor.y + unit.y * eased,
  };
}

// How long a handle at the emitted point would be if the joint were an ordinary
// smooth one: a third of the way to the on-curve on that side. The classical
// third, so an eased joint is as full as any other curve in the outline.
//
// Easing has to reach the length as well as the direction. On a cut straight the
// insertion point's handles start on the point itself, and turning a handle of
// no length moves nothing at all. The control would do nothing a designer could
// see.
function smoothHandleLength(points, insertedIndex, step) {
  const at = points[insertedIndex];
  const neighbour = neighbouringOnCurve(points, insertedIndex, step);
  return neighbour ? Math.hypot(neighbour.x - at.x, neighbour.y - at.y) / 3 : null;
}

// How long the handle at the emitted point could be before the joint stops
// being a curve a smooth point can draw: the distance from that point to where
// its own tangent meets the tangent at the far end of the piece. It is the
// Tunni point of that piece, and the fullest a handle goes.
//
// Null where the two tangents are parallel, which is a piece with no such
// limit. Easing then leaves the handle alone rather than sending it anywhere.
function tensionLimit(points, insertedIndex, step) {
  const at = points[insertedIndex];
  const near = points[insertedIndex + step];
  const far = points[insertedIndex + 2 * step];
  const end = neighbouringOnCurve(points, insertedIndex, step);
  if (!near?.type || !far?.type || !end) {
    return null;
  }
  const meeting = intersect(at, near, end, far);
  return meeting ? Math.hypot(meeting.x - at.x, meeting.y - at.y) : null;
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
function turnToward(handle, anchor, direction, turn, reach, smoothLength) {
  const fraction = turn;
  const current = { x: handle.x - anchor.x, y: handle.y - anchor.y };
  const length = Math.hypot(current.x, current.y);
  // A collapsed handle states no direction, so it takes the one it was built
  // on. Without this it could never grow: everything below scales a vector of
  // length zero, which is still zero however far easing is pushed.
  const unit =
    length < 1e-9
      ? normalize(handle._axis)
      : { x: current.x / length, y: current.y / length };
  if (!unit) {
    return handle;
  }
  const blended = normalize({
    x: unit.x + (direction.x - unit.x) * fraction,
    y: unit.y + (direction.y - unit.y) * fraction,
  });
  if (!blended) {
    return handle;
  }
  const eased =
    smoothLength === null ? length : length + (smoothLength - length) * reach;
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
