import { markerIsStale, resolveMarkerAnchor } from "./marker-model.js";
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

export function measureSkeletonAnchor(pathHitTester, end, skeletonData, path) {
  const anchor = resolveMarkerAnchor(end, { path, skeletonData });
  if (anchor.verdict !== "ok" || !anchor.normal) {
    return null;
  }
  if (end.kind !== "skeletonPoint") {
    return measureRay(pathHitTester, anchor.point, anchor.normal);
  }

  const contour = getSkeletonContour(skeletonData, end.contourId);
  const point = getSkeletonPoint(skeletonData, end.contourId, end.pointId);
  const sides = getSkeletonRibSidesForPoint(contour, point);
  const left = vector.mulVectorScalar(anchor.normal, -1);
  const right = anchor.normal;

  if (sides.length === 1) {
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
// A ray has one grip: the arrowhead and the tail are the same handle, because the far
// end is a cast and owns nothing. A dimension has one grip per end.
//
// `distance` is null where the ray never leaves the black. That is not staleness and
// must not be drawn as though it were.

export function markerGeometry(glyphController, marker, skeletonData) {
  const path = glyphController.flattenedPath;
  if (markerIsStale(marker, path)) {
    return { stale: true, grips: [], distance: null };
  }

  const anchors = marker.ends.map((end) =>
    end.kind === "cast" ? null : resolveMarkerAnchor(end, { path, skeletonData })
  );
  if (anchors.some((anchor) => anchor && anchor.verdict !== "ok")) {
    return { stale: true, grips: [], distance: null };
  }

  const hitTester = glyphController.flattenedPathHitTester;
  const isRay = marker.ends.some((end) => end.kind === "cast");

  if (isRay) {
    const anchorIndex = anchors.findIndex((anchor) => anchor);
    const anchor = anchors[anchorIndex];
    const measured = measureSkeletonAnchor(
      hitTester,
      marker.ends[anchorIndex],
      skeletonData,
      path
    );
    const grips = [anchor.point];
    if (measured?.farPoint) {
      grips.push(measured.farPoint);
    }
    return {
      stale: false,
      isRay: true,
      grips,
      anchorPoint: anchor.point,
      farPoint: measured?.farPoint || null,
      secondFarPoint: measured?.secondFarPoint || null,
      distance: measured ? measured.distance : null,
    };
  }

  const points = anchors.map((anchor) => anchor.point);
  return {
    stale: false,
    isRay: false,
    grips: points,
    points,
    distance: measureDimension(points[0], points[1]),
  };
}
