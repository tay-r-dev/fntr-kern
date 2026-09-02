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
