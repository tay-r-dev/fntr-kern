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
  const intersections = pathHitTester.rayIntersections(origin, direction, extraLines);
  const spans = walkRayIntersections(intersections);
  const start = firstSpanAtOrAfter(intersections, origin, direction);
  if (start === undefined || !spans[start]?.inside) {
    return null;
  }
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

function firstSpanAtOrAfter(intersections, origin, direction) {
  for (let i = 0; i < intersections.length - 1; i++) {
    const along = vector.dotVector(
      vector.subVectors(intersections[i], origin),
      direction
    );
    if (along >= -ALONG_RAY_EPSILON) {
      return i;
    }
  }
  return undefined;
}
