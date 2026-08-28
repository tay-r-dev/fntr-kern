import { Bezier } from "bezier-js";
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";
import {
  buildSkeletonTunniSegments,
  getSkeletonContour,
  getSkeletonPoint,
} from "./skeleton-model.js";
import * as vector from "./vector.js";

// A marker is a measurement the designer places on a contour and keeps. It stores an
// address and nothing else: every distance is derived on read.
//
//   marker = {id, ends: [End, End], signature, target?, groupId?}
//   group  = {id, name, visible}
//
// Ids are allocated once and never reused, so the copies of one marker that land in
// several sources are recognisably one marker. That is why the next id is held in the
// section rather than derived from the list: deleting a marker must not free its id
// while a twin in another source still carries it.

export function getMarkerData(layerGlyph) {
  return getFontraInternalSection(layerGlyph, FONTRA_INTERNAL_SECTIONS.MARKERS);
}

export function setMarkerData(layerGlyph, data) {
  setFontraInternalSection(layerGlyph, FONTRA_INTERNAL_SECTIONS.MARKERS, data);
}

export function getMarkers(layerGlyph) {
  return getMarkerData(layerGlyph)?.markers || [];
}

export function getMarkerGroups(layerGlyph) {
  return getMarkerData(layerGlyph)?.groups || [];
}

export function allocateMarkerId(layerGlyph) {
  const data = getMarkerData(layerGlyph) || { markers: [], groups: [] };
  const next = Math.max(data.nextId || 0, highestUsedId(data) + 1);
  setMarkerData(layerGlyph, { ...data, nextId: next + 1 });
  return `marker${next}`;
}

function highestUsedId(data) {
  let highest = -1;
  for (const marker of data.markers || []) {
    const number = parseInt(String(marker.id).replace(/^marker/, ""));
    if (Number.isFinite(number) && number > highest) {
      highest = number;
    }
  }
  return highest;
}

// The signature is a count, not a geometry. There is no tolerance in it: it verifies an
// address, it never searches for one. The rule it serves is the whole of the anchoring
// design — the point count under an anchor changes, the marker goes stale; anything
// else, the marker rides the geometry.
//
// The comparison runs on read and writes nothing, so undoing past a structural edit
// restores the count and the marker comes back to life on its own.

export function computeMarkerSignature(path) {
  const counts = [];
  const closed = [];
  for (let i = 0; i < path.contourInfo.length; i++) {
    counts.push(path.getNumPointsOfContour(i));
    closed.push(!!path.contourInfo[i].isClosed);
  }
  return { counts, closed };
}

export function markerIsStale(marker, path) {
  if (!marker.ends?.some(endIsPathAnchored)) {
    // Skeleton anchors carry stable ids and cast ends own nothing. Neither can shift.
    return false;
  }
  const now = computeMarkerSignature(path);
  const then = marker.signature;
  if (!then || then.counts?.length !== now.counts.length) {
    return true;
  }
  // Compared whole: an added or removed contour shifts every index after it, and
  // telling "shifted" from "resized" is the search this design refuses to do.
  return now.counts.some(
    (count, i) => count !== then.counts[i] || now.closed[i] !== then.closed[i]
  );
}

function endIsPathAnchored(end) {
  return end.kind === "pathSegment" || end.kind === "pathPoint";
}

// Resolving an address. The verdict is "ok" or "stale" and there is no third value:
// anything that cannot be resolved is stale, never guessed at and never thrown on.

export function resolveMarkerAnchor(end, { path, skeletonData } = {}) {
  switch (end?.kind) {
    case "pathSegment":
      return resolvePathSegment(end, path);
    case "pathPoint":
      return resolvePathPoint(end, path);
    case "skeletonPoint":
      return resolveSkeletonPoint(end, skeletonData);
    default:
      return STALE;
  }
}

const STALE = Object.freeze({ verdict: "stale" });

function resolvePathSegment(end, path) {
  const bezier = pathSegmentBezier(path, end.contourIndex, end.segmentIndex);
  if (!bezier) {
    return STALE;
  }
  return { verdict: "ok", point: bezier.get(end.t), normal: normalAt(bezier, end.t) };
}

function resolvePathPoint(end, path) {
  if (
    !path ||
    end.contourIndex < 0 ||
    end.contourIndex >= path.contourInfo.length ||
    end.pointIndex < 0 ||
    end.pointIndex >= path.getNumPointsOfContour(end.contourIndex)
  ) {
    return STALE;
  }
  const point = path.getContourPoint(end.contourIndex, end.pointIndex);
  return point ? { verdict: "ok", point } : STALE;
}

function resolveSkeletonPoint(end, skeletonData) {
  const contour = skeletonData
    ? getSkeletonContour(skeletonData, end.contourId)
    : undefined;
  if (!contour || !getSkeletonPoint(skeletonData, end.contourId, end.pointId)) {
    return STALE;
  }
  const segment = buildSkeletonTunniSegments(contour).find(
    (segment) => segment.startPointId === end.pointId
  );
  if (!segment) {
    return STALE;
  }
  const bezier = new Bezier(
    [segment.startPoint, ...segment.controlPoints, segment.endPoint].map((point) => ({
      x: point.x,
      y: point.y,
    }))
  );
  return { verdict: "ok", point: bezier.get(end.t), normal: normalAt(bezier, end.t) };
}

function pathSegmentBezier(path, contourIndex, segmentIndex) {
  if (!path || contourIndex < 0 || contourIndex >= path.contourInfo.length) {
    return undefined;
  }
  let i = 0;
  for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
    if (i++ === segmentIndex) {
      return new Bezier(segment.points);
    }
  }
  return undefined;
}

// The same quarter turn the Power Ruler takes at recalcRulerFromPoint.
function normalAt(bezier, t) {
  const derivative = bezier.derivative(t);
  return vector.normalizeVector({ x: -derivative.y, y: derivative.x });
}
