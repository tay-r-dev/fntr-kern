import {
  aimedCast,
  aimedDirection,
  markerIndicesChanged,
  nearestOnCurvePlace,
  resolveMarkerAnchor,
  resolveMarkerEnd,
} from "./marker-model.js";
import {
  getSkeletonContour,
  getSkeletonPoint,
  getSkeletonRibSidesForPoint,
} from "./skeleton-model.js";
import { round } from "./utils.ts";
import * as vector from "./vector.js";

// The winding walk, lifted out of the Power Ruler's recalcRulerFromLine so there is one
// copy of it (rail R-B). It is a pure function of a crossing list: accumulate winding
// across the crossings, and a span is inside the black wherever the running total is
// non-zero.
//
// Span i lies between intersections[i] and intersections[i + 1].

export function walkRayIntersections(intersections) {
  const measurePoints = [];
  let winding = 0;
  for (let i = 0; i < intersections.length - 1; i++) {
    winding += intersections[i].winding;
    const j = i + 1;
    const v = vector.subVectors(intersections[j], intersections[i]);
    const measurePoint = vector.addVectors(
      intersections[i],
      vector.mulVectorScalar(v, 0.5)
    );
    measurePoint.distance = round(Math.hypot(v.x, v.y), 1);
    measurePoint.inside = !!winding;
    measurePoints.push(measurePoint);
  }
  return measurePoints;
}

// A ray leaves its anchor along the normal and stops where the outline leaves the black.
// An overlapping contour's interior edge is crossed rather than stopped at, because the
// span beyond it is still inside; a counter stops it, because the span beyond it is not.
//
// Null is the honest answer where the ray never leaves the black — an open contour it
// never crosses. Every reader must handle it. Do not fabricate a distance.

export function measureRay(pathHitTester, origin, direction, extraLines = undefined) {
  // The hit tester returns crossings in its own order, not along the ray, so order them
  // before walking: the walk reads a sequence, and a sequence in the wrong order reports
  // the span behind the anchor as the one in front of it.
  const intersections = pathHitTester
    .rayIntersections(origin, direction, extraLines)
    .map((intersection) => ({
      ...intersection,
      along: vector.dotVector(vector.subVectors(intersection, origin), direction),
    }))
    .sort((a, b) => a.along - b.along);

  const spans = walkRayIntersections(intersections);
  const start = spanAtOrigin(intersections);
  if (start === undefined || !spans[start]?.inside) {
    return null;
  }
  // Walk on across consecutive inside spans: an overlapping contour's interior edge ends
  // a span without ending the black, and the ray must cross it rather than stop.
  let end = start;
  while (spans[end + 1]?.inside) {
    end++;
  }
  const farPoint = intersections[end + 1];
  const v = vector.subVectors(farPoint, origin);
  return { farPoint, distance: Math.hypot(v.x, v.y) };
}

export function measureDimension(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

const ALONG_RAY_EPSILON = 1e-6;

// The span the anchor sits in, which is the first one that does not end behind it. An
// anchor on an outline sits exactly on a span boundary; an anchor on a centerline sits
// in the middle of one.
function spanAtOrigin(intersections) {
  for (let i = 0; i < intersections.length - 1; i++) {
    if (intersections[i + 1].along > ALONG_RAY_EPSILON) {
      return i;
    }
  }
  return undefined;
}

// A skeleton anchor, in its three cases.
//
// On a generated contour it is an ordinary ray: the centerline is not outline geometry
// and casts no crossing, so the ray runs straight through it to the far generated edge.
//
// On a centerline it depends on how many sides the stroke has there. Double-sided, the
// ray runs both ways and reports the sum, which is the stroke's full width at that
// point. Single-sided, it runs one way only, because the other edge lies on the
// centerline itself.
//
// Which way is "left" is the skeleton generator's convention: the travel direction
// turned a quarter clockwise. The anchor normal is turned the other way, so left is its
// negation.
//
// An aimed ray passes its own `direction` and the normal is not read. On a single-sided
// centerline it runs the way it was aimed, because the designer chose that way. On a
// double-sided one it runs both ways along the aimed line, as a plain ray does along the
// normal, so it still measures the whole stroke.

export function measureSkeletonAnchor(
  pathHitTester,
  end,
  skeletonData,
  path,
  direction = undefined
) {
  const anchor = resolveMarkerAnchor(end, { path, skeletonData });
  if (anchor.verdict !== "ok" || !(direction || anchor.normal)) {
    return null;
  }
  if (end.kind !== "skeletonPoint") {
    return measureRay(pathHitTester, anchor.point, direction || anchor.normal);
  }

  const contour = getSkeletonContour(skeletonData, end.contourId);
  const point = getSkeletonPoint(skeletonData, end.contourId, end.pointId);
  const sides = getSkeletonRibSidesForPoint(contour, point);
  const right = direction || anchor.normal;
  const left = vector.mulVectorScalar(right, -1);

  if (sides.length === 1) {
    if (direction) {
      return measureRay(pathHitTester, anchor.point, direction);
    }
    return measureRay(pathHitTester, anchor.point, sides[0] === "left" ? left : right);
  }

  const leftMeasured = measureRay(pathHitTester, anchor.point, left);
  const rightMeasured = measureRay(pathHitTester, anchor.point, right);
  if (!leftMeasured || !rightMeasured) {
    return null;
  }
  return {
    farPoint: leftMeasured.farPoint,
    secondFarPoint: rightMeasured.farPoint,
    distance: leftMeasured.distance + rightMeasured.distance,
  };
}

// One derivation of what a marker looks like on screen, shared by the hit test and the
// drawing so the two can never disagree about where a marker is (rail R-B).
//
// A plain ray has one grip: the arrowhead and the tail are the same handle, because the
// far end is a cast and owns nothing. An aimed ray's arrow is a second grip, on the cast
// end, because there the cast owns the aim. A dimension has one grip per end.
//
// `distance` is null where the ray never leaves the black. That is not staleness and
// must not be drawn as though it were.

export function markerGeometry(glyphController, marker, skeletonData) {
  const path = glyphController.flattenedPath;
  const anchors = marker.ends.map((end) =>
    end.kind === "cast"
      ? null
      : resolveMarkerEnd(end, {
          path,
          skeletonData,
          indicesChanged: markerIndicesChanged(marker, path, end),
        })
  );

  // A stale marker keeps its place and its grips: it draws as a plain dot where it last
  // stood and is dragged somewhere useful to repair it. A broken marker you cannot touch
  // is a broken marker you cannot fix. It carries no measurement — the number is exactly
  // what must not be trusted.
  const isRay = marker.ends.some((end) => end.kind === "cast");
  // Only the ends that name something can fail. A ray's far end is a cast: it resolves
  // to nothing by design, and counting that as a failure stales every ray on sight.
  const stale =
    marker.broken || anchors.some((anchor) => anchor && anchor.verdict !== "ok");
  if (stale) {
    const points = anchors.filter((anchor) => anchor?.point).map((a) => a.point);
    return {
      stale: true,
      isRay,
      grips: points.map((point, i) => ({ point, endIndex: isRay ? undefined : i })),
      points,
      distance: null,
    };
  }

  // The addresses the ends resolved THROUGH, which after a repair are not the addresses
  // stored on the marker. Everything downstream measures against these.
  const resolvedEnds = marker.ends.map((end, i) => anchors[i]?.end || end);
  const hitTester = glyphController.flattenedPathHitTester;

  if (isRay) {
    // A ray has ONE grip whichever end is grabbed: the far end is a cast and owns
    // nothing, so there is only one thing to drag.
    const anchorIndex = anchors.findIndex((anchor) => anchor);
    const anchor = anchors[anchorIndex];
    const castIndex = marker.ends.findIndex((end) => end.kind === "cast");
    const aim = aimedDirection(marker.ends[castIndex]);
    const measured = measureSkeletonAnchor(
      hitTester,
      resolvedEnds[anchorIndex],
      skeletonData,
      path,
      aim || undefined
    );
    // An aimed ray's arrow is a grip of its own, on the cast end: dragging it re-aims
    // the ray. Where the aim measures nothing the arrow still stands, at a fixed length,
    // because a ray that cannot be re-aimed from where it points cannot be repaired.
    const tipIndex = aim ? castIndex : undefined;
    const farPoint =
      measured?.farPoint ||
      (aim
        ? vector.addVectors(
            anchor.point,
            vector.mulVectorScalar(aim, AIM_FALLBACK_LENGTH)
          )
        : null);
    const grips = [{ point: anchor.point }];
    if (farPoint) {
      grips.push({ point: farPoint, endIndex: tipIndex });
    }
    if (measured?.secondFarPoint) {
      grips.push({ point: measured.secondFarPoint, endIndex: tipIndex });
    }
    // The direction the ray is drawn in, which is the one it measures in. Where it
    // measures nothing a plain ray still has its normal.
    const direction = farPoint
      ? vector.subVectors(farPoint, anchor.point)
      : resolveMarkerAnchor(resolvedEnds[anchorIndex], { path, skeletonData }).normal;
    return {
      stale: false,
      isRay: true,
      isAimed: !!aim,
      angle: direction ? directionAngle(direction, 360) : null,
      grips,
      anchorPoint: anchor.point,
      farPoint,
      secondFarPoint: measured?.secondFarPoint || null,
      distance: measured ? measured.distance : null,
    };
  }

  // A dimension is grabbed by its ARROWS, not by the points it is attached to. The
  // points belong to the outline and are wanted for ordinary point editing; the arrows
  // are the marker's own, and they sit clear of the geometry where there is room to
  // aim at them.
  const points = anchors.map((anchor) => anchor.point);
  const along = vector.normalizeVector(vector.subVectors(points[1], points[0]));
  const out = vector.mulVectorScalar(
    { x: -along.y, y: along.x },
    DIMENSION_WITNESS_GAP
  );
  const arrows = points.map((point) => vector.addVectors(point, out));
  return {
    stale: false,
    isRay: false,
    grips: arrows.map((point, i) => ({ point, endIndex: i })),
    points,
    arrows,
    along,
    angle: directionAngle(along, 180),
    distance: measureDimension(points[0], points[1]),
  };
}

// A direction's angle in glyph space, in degrees: 0 to the right, counter-clockwise,
// folded into [0, period). A ray has a direction and reads 0 to 360; a dimension is a
// line with no direction and reads 0 to 180. Null where there is no direction at all.
function directionAngle(direction, period) {
  if (!(Math.hypot(direction.x, direction.y) > 1e-9)) {
    return null;
  }
  const degrees = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
  const folded = ((degrees % period) + period) % period;
  return folded > period - 1e-9 ? 0 : folded;
}

// How far a dimension's arrows sit off the line it measures, in font units. It is a font
// unit and not a screen parameter because the grip and the drawing must agree at every
// zoom: a grip that drifts from what is drawn is a grip you cannot hit.
export const DIMENSION_WITNESS_GAP = 40;

// How far out an aimed ray's arrow stands where the aim measures nothing, in font units.
// A font unit and not a screen length, for the same reason as the witness gap above.
export const AIM_FALLBACK_LENGTH = 60;

// A plain ray the normal cannot measure, turned into an aimed one. This is the corner
// under 90 degrees, where the normal of either arm points outside the black and the ray
// leaves the outline where it starts. The ray moves to the nearest on-curve point, which
// is the corner it was trying to measure, and takes the miter as its first aim: the
// average of the two arms' normals, which lies inside the corner at every turn. The
// designer then drags the arrow to aim it where it was meant.
//
// Returns the new ends, or null where there is nothing to turn: a ray that measures, a
// ray already aimed, or an anchor that is not on an outline.
export function aimCollapsedRay(ends, path, pathHitTester) {
  const anchorIndex = ends.findIndex((end) => end.kind !== "cast");
  const castIndex = ends.findIndex((end) => end.kind === "cast");
  const anchor = ends[anchorIndex];
  if (
    anchor?.kind !== "pathSegment" ||
    castIndex < 0 ||
    aimedDirection(ends[castIndex])
  ) {
    return null;
  }
  const resolved = resolveMarkerAnchor(anchor, { path });
  if (resolved.verdict !== "ok" || !resolved.normal) {
    return null;
  }
  if (measureRay(pathHitTester, resolved.point, resolved.normal)) {
    return null;
  }
  const place = nearestOnCurvePlace(path, resolved.point);
  if (!place) {
    return null;
  }
  const aim = cornerMiter(path, place.end);
  if (!aim) {
    return null;
  }
  const next = [...ends];
  next[anchorIndex] = place.end;
  next[castIndex] = aimedCast(aim);
  return next;
}

// The average of the normals of the two segments meeting at an on-curve place. At an
// open contour's end there is one segment, and its normal is the answer. A cusp folds
// the two arms onto each other, the normals cancel, and there is no miter.
function cornerMiter(path, end) {
  const own = resolveMarkerAnchor(end, { path });
  if (own.verdict !== "ok" || !own.normal) {
    return null;
  }
  const count = [...path.iterContourDecomposedSegments(end.contourIndex)].length;
  let index = end.segmentIndex + (end.t === 0 ? -1 : 1);
  if (index < 0 || index >= count) {
    if (!path.contourInfo[end.contourIndex].isClosed) {
      return own.normal;
    }
    index = (index + count) % count;
  }
  const other = resolveMarkerAnchor(
    { ...end, segmentIndex: index, t: end.t === 0 ? 1 : 0 },
    { path }
  );
  if (other.verdict !== "ok" || !other.normal) {
    return own.normal;
  }
  const sum = vector.addVectors(own.normal, other.normal);
  return Math.hypot(sum.x, sum.y) > 1e-9 ? vector.normalizeVector(sum) : null;
}
