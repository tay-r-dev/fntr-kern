// Turn a drawn contour into a centerline.
//
// This is the inverse of "Realize contours", which drops a skeleton and keeps
// the outline it made. Here an outline the designer drew by hand becomes the
// centerline of a stroke, and the generator builds a new outline around it.
//
// There is no geometry in this file. Every point keeps its position, its type
// and its smooth flag exactly as drawn. Nothing is fitted, nothing is searched
// for, and no shape is guessed at. Deriving a centerline from a filled letter
// shape — a medial axis — is a different feature and is not this one.
//
// The smooth flags are copied as drawn. A smooth point carrying one handle
// beside a straight has no direction of its own, so the straight sets it, and
// the ribs at that straight's two ends are tied to one shared offset. That is a
// property of the drawing rather than something the conversion introduces, so
// clearing the flag here would change the shape the designer drew. Untying is
// available per straight for anyone who does not want it. Contrast the
// centerline split, which does clear the flag on the two ends it creates: there
// the cut is what left those points holding a single handle.

import { appendSkeletonContour, appendSkeletonPoint } from "./skeleton-model.js";

// Why a contour cannot become a centerline. Both are reported to the designer
// rather than being skipped quietly.
export const SKELETON_CONVERSION_REFUSALS = Object.freeze({
  // A skeleton point is on-curve or cubic off-curve, and nothing else. A
  // quadratic off-curve copied as-is would be read as an on-curve and would
  // move the outline, so the contour is refused instead.
  QUADRATIC: "quadratic",
  // Nothing to stroke.
  NO_ON_CURVE_POINTS: "no-on-curve-points",
});

// Returns a refusal reason, or null when the contour can be converted.
export function skeletonConversionRefusal(contour) {
  const points = contour?.points || [];
  if (points.some((point) => point.type && point.type !== "cubic")) {
    return SKELETON_CONVERSION_REFUSALS.QUADRATIC;
  }
  if (!points.some((point) => !point.type)) {
    return SKELETON_CONVERSION_REFUSALS.NO_ON_CURVE_POINTS;
  }
  return null;
}

// Append `contour` — an unpacked path contour, `{ points, isClosed }` — to
// `skeletonData` as a new centerline. Returns the new contour, or null when the
// contour is refused.
//
// `width` is the whole stroke width, and it is written onto every on-curve
// point, split evenly between the two sides, as well as onto the contour. Every
// on-curve point carries its own width after normalization, so the contour's
// number is never read for geometry: set on the contour alone it would be a
// label the stroke did not obey. The skeleton pen seeds a new contour the same
// way, for the same reason.
//
// `singleSided` is null for a stroke either side of the drawn line, or "left"
// or "right" for one that sits wholly on that side. A single-sided stroke gives
// the named side the sum of the two stored half-widths and collapses the other
// onto the centerline, so the drawn contour stays exactly where it is and
// becomes one edge of the letter.
export function appendSkeletonContourFromPathContour(
  skeletonData,
  contour,
  { width, singleSided = null } = {}
) {
  if (!skeletonData || skeletonConversionRefusal(contour)) {
    return null;
  }
  const totalWidth = Math.max(0, Number(width));
  if (!Number.isFinite(totalWidth)) {
    return null;
  }
  const halfWidth = totalWidth / 2;

  const skeletonContour = appendSkeletonContour(skeletonData, {
    closed: contour.isClosed === true,
    defaultWidth: totalWidth,
    singleSided,
    points: [],
  });

  for (const point of contour.points) {
    const isOffCurve = !!point.type;
    appendSkeletonPoint(skeletonData, skeletonContour.id, {
      x: point.x,
      y: point.y,
      type: isOffCurve ? "cubic" : null,
      smooth: point.smooth === true,
      ...(isOffCurve ? {} : { width: { left: halfWidth, right: halfWidth } }),
    });
  }

  return skeletonContour;
}
